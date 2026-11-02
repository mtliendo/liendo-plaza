import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.PREVIEW_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const prefix = process.env.SHOT_PREFIX ?? "before";
const artifacts = process.env.E2E_ARTIFACTS ?? "/opt/cursor/artifacts";

async function shot(page: import("playwright").Page, name: string) {
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(400);
  const fonts = await page.evaluate(() => {
    const clock = document.querySelector("[data-testid='clock'], [data-testid='name-picker'] h1, [data-testid='pair-code'], h1");
    const body = document.body;
    return {
      body: getComputedStyle(body).fontFamily,
      sample: clock ? getComputedStyle(clock).fontFamily : "",
    };
  });
  console.log(`fonts ${name}`, fonts);
  await page.screenshot({ path: join(artifacts, `${prefix}_${name}.png`), fullPage: false });
}

async function assertKitchenFits(page: import("playwright").Page, name: string) {
  const metrics = await page.evaluate(() => {
    const more = document.querySelector<HTMLElement>("[data-testid='events-more'], [data-testid='chores-more']");
    const moreBox = more?.getBoundingClientRect();
    return {
      scrollHeight: document.documentElement.scrollHeight,
      bodyScroll: document.body.scrollHeight,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      moreHeight: moreBox ? Math.round(moreBox.height) : null,
      moreWidth: moreBox ? Math.round(moreBox.width) : null,
    };
  });
  console.log(`fit ${name}`, metrics);
  if (metrics.scrollHeight > metrics.innerHeight) {
    throw new Error(
      `${name} overflows 1920x1080: document.scrollHeight ${metrics.scrollHeight} > innerHeight ${metrics.innerHeight}`,
    );
  }
  if (metrics.moreHeight != null && metrics.moreHeight < 64) {
    throw new Error(`${name} +N more tap is ${metrics.moreHeight}px, need 64px+`);
  }
}

async function setDinnerPhoto(page: import("playwright").Page, date: string, on: boolean) {
  if (on) {
    await page.evaluate(async (iso) => {
      await fetch("/api/meals", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: iso, name: "Tacos" }),
      });
      const file = await fetch("/meals/tacos.jpg");
      const blob = await file.blob();
      const form = new FormData();
      form.append("photo", blob, "tacos.jpg");
      await fetch(`/api/meals/${iso}/photo`, { method: "POST", body: form });
    }, date);
    return;
  }
  await page.evaluate(async (iso) => {
    await fetch(`/api/meals/${iso}/photo`, { method: "DELETE" });
  }, date);
}

async function shootKitchen(
  page: import("playwright").Page,
  name: string,
  fixture: "events-0" | "events-3" | "events-12",
) {
  const count = fixture === "events-0" ? "0" : fixture === "events-3" ? "few" : "many";
  await page.goto(`${BASE}/display?fixture=${fixture}`, { waitUntil: "load" });
  await page.waitForSelector(`[data-testid="events"][data-count="${count}"]`, { timeout: 20000 });
  await assertKitchenFits(page, name);
  await shot(page, name);
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch();

  const frame = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const framePage = await frame.newPage();
  await framePage.goto(`${BASE}/display`, { waitUntil: "load" });
  await framePage.waitForSelector('[data-testid="pair-code"], [data-testid="clock"]', { timeout: 20000 });
  const alreadyPaired = Boolean(await framePage.locator('[data-testid="clock"]').count());
  let pairCode = "";
  if (!alreadyPaired) {
    await framePage.waitForSelector('[data-testid="kitchen-pair"] [data-testid="pair-code"]');
    pairCode = (await framePage.locator('[data-testid="pair-code"]').innerText()).trim();
    await assertKitchenFits(framePage, "kitchen_pair");
    await shot(framePage, "kitchen_pair");
  }

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${BASE}/family`, { waitUntil: "load" });
  await phonePage.waitForSelector('[data-testid="bootstrap-focus"], a[href="/family/manage"]', { timeout: 20000 });

  const bootstrap = phonePage.locator('[data-testid="bootstrap-focus"]');
  if (await bootstrap.count()) {
    await bootstrap.click();
    await phonePage.locator('[data-testid="bootstrap-pin"]').fill("123456");
    await phonePage.locator('[data-testid="bootstrap-open"]').click();
  }

  await phonePage.waitForSelector('a[href="/family/manage"], h1:has-text("Today")', { timeout: 20000 });
  await shot(phonePage, "phone_today");
  await phonePage.goto(`${BASE}/family/manage`, { waitUntil: "load" });
  await phonePage.waitForSelector("text=Manage", { timeout: 20000 });
  await shot(phonePage, "phone_manage");
  await phonePage.goto(`${BASE}/family`, { waitUntil: "load" });
  await phonePage.waitForSelector("text=Today", { timeout: 20000 });

  if (pairCode) {
    await phonePage.goto(`${BASE}/family/add-device`, { waitUntil: "domcontentloaded" });
    await phonePage.waitForSelector('[data-testid="approve-code"]', { timeout: 20000 });
    await phonePage.locator('[data-testid="approve-code"]').fill(pairCode);
    await phonePage.locator('[data-testid="approve-submit"]').click();
    await framePage.waitForSelector('[data-testid="clock"]', { timeout: 20000 });
  }

  const today = await phonePage.evaluate(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
  );

  await phonePage.evaluate(async (date) => {
    const res = await fetch(`/api/snapshot?from=${date}&to=${date}`, { cache: "no-store" });
    const snap = (await res.json()) as {
      people: { id: string; slug: string }[];
      chores: { title: string; personId: string }[];
    };
    const sofia = snap.people.find((person) => person.slug === "sofia");
    if (!sofia) return;
    const extras = ["Water plants", "Set the table", "Wipe counters", "Pack backpack", "Feed the cat"];
    const have = new Set(snap.chores.filter((chore) => chore.personId === sofia.id).map((chore) => chore.title));
    for (const title of extras) {
      if (have.has(title)) continue;
      await fetch("/api/chores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          assignedPersonId: sofia.id,
          stars: 1,
          requiresPhoto: false,
          repeatType: "once",
          onceDate: date,
        }),
      });
    }
  }, today);

  if (alreadyPaired || pairCode) {
    await setDinnerPhoto(phonePage, today, true);
    await shootKitchen(framePage, "kitchen_photo_events_0", "events-0");
    await shootKitchen(framePage, "kitchen_photo_events_3", "events-3");
    await shootKitchen(framePage, "kitchen_photo_events_12", "events-12");
    await shootKitchen(framePage, "kitchen_board_photo", "events-3");
    await shootKitchen(framePage, "kitchen_events_0", "events-0");
    await shootKitchen(framePage, "kitchen_events_3", "events-3");
    await shootKitchen(framePage, "kitchen_events_12", "events-12");

    await setDinnerPhoto(phonePage, today, false);
    await shootKitchen(framePage, "kitchen_nophoto_events_0", "events-0");
    await shootKitchen(framePage, "kitchen_nophoto_events_3", "events-3");
    await shootKitchen(framePage, "kitchen_nophoto_events_12", "events-12");
    await shootKitchen(framePage, "kitchen_board", "events-3");

    await setDinnerPhoto(phonePage, today, true);
  }

  await phonePage.goto(`${BASE}/family?fixture=events-12`, { waitUntil: "load" });
  await phonePage.waitForSelector('[data-testid="events"][data-count="many"]', { timeout: 20000 });
  await shot(phonePage, "phone_today_events_12");

  const invite = (await phonePage.evaluate(async () => {
    const res = await fetch("/api/pair/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceKind: "browser" }),
    });
    return res.json();
  })) as { webUrl?: string };
  const inviteToken = invite.webUrl ? new URL(invite.webUrl).searchParams.get("invite") : null;
  if (inviteToken) {
    const picker = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pickerPage = await picker.newPage();
    await pickerPage.goto(`${BASE}/family?invite=${inviteToken}`, { waitUntil: "load" });
    await pickerPage.waitForSelector('[data-testid="name-picker"]', { timeout: 20000 });
    await shot(pickerPage, "name_picker");
    await picker.close();
  }

  await browser.close();
  console.log(`wrote ${prefix} shots to ${artifacts}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
