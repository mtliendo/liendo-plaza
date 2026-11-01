import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

type Json = Record<string, unknown>;

async function req(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}/api/${path}`, init);
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Json) : {};
  return { res, data };
}

async function json(path: string, method: string, body?: unknown, headers?: HeadersInit) {
  return req(path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const artifacts = process.env.E2E_ARTIFACTS ?? "/opt/cursor/artifacts";

  const retired = await json("auth/family", "POST", { secret: "nope" });
  assert(retired.res.status === 410, "family secret route should be retired");

  const status = await req("pair/status");
  const parents = (status.data.parents as { id: string; slug: string }[]) ?? [];
  const focus = parents.find((p) => p.slug === "focus");
  assert(status.data.available === true && focus, "bootstrap should be open on a fresh database");

  const bootstrap = await json("pair/bootstrap", "POST", {
    personId: focus.id,
    pin: "123456",
    deviceKind: "browser",
    deviceLabel: "e2e parent",
  });
  assert(bootstrap.res.ok, `bootstrap failed: ${JSON.stringify(bootstrap.data)}`);
  const parentToken = String(bootstrap.data.token);
  const auth = { authorization: `Bearer ${parentToken}` };

  const peopleRes = await req("people", { headers: auth });
  const people = (peopleRes.data.people as { id: string; slug: string; role: string }[]) ?? [];
  const sofia = people.find((p) => p.slug === "sofia");
  const xavier = people.find((p) => p.slug === "xavier");
  const noah = people.find((p) => p.slug === "noah");
  assert(sofia && xavier && noah, "seed people missing");

  const invite = await json("pair/invite", "POST", { deviceKind: "phone" }, auth);
  assert(invite.res.ok, `invite failed: ${JSON.stringify(invite.data)}`);
  const inviteUrl = String(invite.data.webUrl);
  const inviteToken = new URL(inviteUrl).searchParams.get("invite");
  assert(inviteToken, "invite URL missing token");
  const redeemed = await json("pair/redeem", "POST", { invite: inviteToken });
  assert(redeemed.res.ok, `invite redeem failed: ${JSON.stringify(redeemed.data)}`);
  const familyToken = String(redeemed.data.familyToken);

  const kidLogin = await json("auth/login", "POST", { familyToken, personId: sofia.id, pin: "1234", deviceKind: "phone" });
  assert(kidLogin.res.ok, "kid login failed");
  const kidToken = String(kidLogin.data.token);
  const xavierLogin = await json("auth/login", "POST", { familyToken, personId: xavier.id, pin: "1234", deviceKind: "phone" });
  assert(xavierLogin.res.ok, "xavier login failed");
  const xavierToken = String(xavierLogin.data.token);

  const chore = await json(
    "chores",
    "POST",
    {
      title: "Set the table",
      assignedPersonId: sofia.id,
      stars: 2,
      requiresPhoto: false,
      repeatType: "daily",
    },
    auth,
  );
  assert(chore.res.ok, `create chore failed: ${JSON.stringify(chore.data)}`);

  const photoChore = await json(
    "chores",
    "POST",
    {
      title: "Clean the sink",
      assignedPersonId: xavier.id,
      stars: 3,
      requiresPhoto: true,
      repeatType: "daily",
    },
    auth,
  );
  assert(photoChore.res.ok, "photo chore create failed");

  const cal = await req("calendar", { headers: auth });
  const events = (cal.data.events as { start: string }[]) ?? [];
  const from = String(cal.data.from);
  const to = String(cal.data.to);
  assert(events.every((event) => event.start.slice(0, 10) >= from && event.start.slice(0, 10) <= to), "calendar leaked events outside the window");

  const snap = await req("snapshot", { headers: auth });
  const today = String((snap.data.now as string).slice(0, 10));
  const instances = (snap.data.chores as { id: string; title: string; personId: string; date: string; requiresPhoto: boolean; starsAwarded: number; status: string }[]) ?? [];
  const table = instances.find((item) => item.title === "Set the table" && item.date === today);
  const sink = instances.find((item) => item.title === "Clean the sink" && item.date === today);
  assert(table && sink, "today instances missing");

  const claim = await json("pair/claim", "POST", { deviceKind: "display", label: "e2e frame" });
  assert(claim.res.ok, `claim failed: ${JSON.stringify(claim.data)}`);
  const approve = await json("pair/approve", "POST", { code: claim.data.displayCode }, auth);
  assert(approve.res.ok, `approve failed: ${JSON.stringify(approve.data)}`);
  const poll = await json("pair/poll", "POST", { id: claim.data.id, pollSecret: claim.data.pollSecret });
  assert(poll.res.ok && poll.data.status === "paired", `poll failed: ${JSON.stringify(poll.data)}`);
  const displayToken = String(poll.data.token);

  const done = await json(`chores/instances/${table.id}/complete`, "POST", {}, { "x-display-token": displayToken });
  assert(done.res.ok, `display complete failed: ${JSON.stringify(done.data)}`);
  assert((done.data.instance as { status: string }).status === "done", "chore not marked done");

  const jpeg = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 196, g: 74, b: 42 } },
  })
    .jpeg()
    .toBuffer();
  const upload = await fetch(`${BASE}/api/chores/instances/${sink.id}/photo`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${xavierToken}`,
      "content-type": "image/jpeg",
    },
    body: new Uint8Array(jpeg),
  });
  assert(upload.ok, `photo upload failed: ${await upload.text()}`);

  const photoApprove = await json(`chores/instances/${sink.id}/review`, "POST", { action: "approve" }, auth);
  assert(photoApprove.res.ok, "photo approve failed");
  assert((photoApprove.data.instance as { starsAwarded: number }).starsAwarded === 3, "stars not awarded");

  const reward = await json("rewards", "POST", { name: "Pick the playlist", starCost: 2 }, auth);
  const rewardId = String((reward.data.reward as { id: string }).id);
  const request = await json("rewards/requests", "POST", { rewardId }, { authorization: `Bearer ${kidToken}` });
  assert(request.res.ok, `reward request failed: ${JSON.stringify(request.data)}`);
  const requestId = String((request.data.request as { id: string }).id);
  const rewardApprove = await json(`rewards/requests/${requestId}/review`, "POST", { action: "approve" }, auth);
  assert(rewardApprove.res.ok, "reward approve failed");

  const meal = await json("meals", "PUT", { date: today, name: "Roast chicken" }, auth);
  assert(meal.res.ok, "meal write failed");

  let locked = false;
  for (let i = 0; i < 6; i += 1) {
    const attempt = await json("auth/login", "POST", { familyToken, personId: noah.id, pin: "0000" });
    if (attempt.res.status === 423) locked = true;
  }
  assert(locked, "PIN lockout did not trigger");

  const devices = await req("devices", { headers: auth });
  assert(Array.isArray(devices.data.devices), "devices list missing");

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addCookies([
    { name: "lp_display", value: displayToken, url: BASE },
    { name: "lp_session", value: parentToken, url: BASE },
  ]);
  const page = await context.newPage();
  const shots = [
    ["display_home.png", "/display"],
    ["display_home_dimmed.png", "/display?dim=1"],
    ["display_week.png", "/display/week"],
    ["display_chores.png", "/display/chores"],
    ["display_meals.png", "/display/meals"],
  ] as const;
  for (const [name, path] of shots) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(artifacts, name), fullPage: false });
  }

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await phone.addCookies([{ name: "lp_session", value: parentToken, url: BASE }]);
  const phonePage = await phone.newPage();
  const phoneShots = [
    ["mobile_today.png", "/family"],
    ["mobile_calendar.png", "/family/calendar"],
    ["mobile_meals.png", "/family/meals"],
    ["mobile_stars.png", "/family/stars"],
    ["mobile_approvals.png", "/family/approvals"],
    ["mobile_chores.png", "/family/chores"],
    ["mobile_add_device.png", "/family/add-device"],
    ["mobile_devices.png", "/family/devices"],
  ] as const;
  for (const [name, path] of phoneShots) {
    await phonePage.goto(`${BASE}${path}`, { waitUntil: "load" });
    await phonePage.waitForTimeout(400);
    await phonePage.screenshot({ path: join(artifacts, name), fullPage: false });
  }

  await browser.close();
  await writeFile(join(artifacts, "e2e-summary.txt"), "e2e passed: bootstrap, QR pair, chore, display done, photo approve, reward, meal, pin lockout\n");
  console.log("e2e passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
