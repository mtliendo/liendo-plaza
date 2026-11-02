import { eq } from "drizzle-orm";
import { chromium, type BrowserContext, type Page } from "playwright";
import { issueFamilyToken } from "../lib/auth";
import { getDb, schema } from "../lib/db";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";

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

async function mintParentSession() {
  const db = getDb();
  const [focus] = await db.select().from(schema.people).where(eq(schema.people.slug, "focus")).limit(1);
  assert(focus, "focus person missing");
  const familyToken = issueFamilyToken();
  const login = await json("auth/login", "POST", {
    familyToken,
    personId: focus.id,
    pin: "123456",
    deviceKind: "browser",
    deviceLabel: "refresh e2e parent",
  });
  assert(login.res.ok, `parent login failed: ${JSON.stringify(login.data)}`);
  return String(login.data.token);
}

async function openWithSession(context: BrowserContext, token: string) {
  await context.addCookies([
    {
      name: "lp_session",
      value: token,
      url: BASE,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function signInParent(page: Page) {
  await page.goto(`${BASE}/family`, { waitUntil: "load" });
  await page.waitForSelector('a[href="/family/manage"], h1:has-text("Today")', { timeout: 20000 });
}

async function mintKidToken(auth: HeadersInit) {
  const invite = await json("pair/invite", "POST", { deviceKind: "phone" }, auth);
  assert(invite.res.ok, `invite failed: ${JSON.stringify(invite.data)}`);
  const inviteUrl = String(invite.data.webUrl);
  const inviteToken = new URL(inviteUrl).searchParams.get("invite");
  assert(inviteToken, "invite URL missing token");
  const redeemed = await json("pair/redeem", "POST", { invite: inviteToken });
  assert(redeemed.res.ok, `invite redeem failed: ${JSON.stringify(redeemed.data)}`);
  const familyToken = String(redeemed.data.familyToken);
  const peopleRes = await req("people", { headers: { "x-family-token": familyToken } });
  const people = (peopleRes.data.people as { id: string; slug: string }[]) ?? [];
  const sofia = people.find((p) => p.slug === "sofia");
  assert(sofia, "sofia missing");
  const kidLogin = await json("auth/login", "POST", {
    familyToken,
    personId: sofia.id,
    pin: "1234",
    deviceKind: "phone",
  });
  assert(kidLogin.res.ok, `kid login failed: ${JSON.stringify(kidLogin.data)}`);
  return String(kidLogin.data.token);
}

async function main() {
  const version = await req("version");
  assert(version.res.ok, "GET /api/version should be public");
  assert(typeof version.data.buildId === "string" && version.data.buildId.length > 0, "version missing buildId");
  assert(version.res.headers.get("cache-control")?.includes("no-store"), "version must be no-store");

  const browser = await chromium.launch();
  const frame = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const framePage = await frame.newPage();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const parentToken = await mintParentSession();
  await openWithSession(phone, parentToken);
  const phonePage = await phone.newPage();

  await signInParent(phonePage);
  const parentAuth = { authorization: `Bearer ${parentToken}` };
  const kidToken = await mintKidToken(parentAuth);

  const blocked = await json("display/refresh", "POST", {}, { authorization: `Bearer ${kidToken}` });
  assert(blocked.res.status === 403, `kid refresh should be 403, got ${blocked.res.status}`);

  await phonePage.goto(`${BASE}/family`, { waitUntil: "load" });
  await phonePage.waitForSelector("h1:has-text('Today'), a[href='/family/manage']", { timeout: 20000 });
  if (await phonePage.locator('[data-testid="refresh-frame"]').count()) {
    throw new Error("Today view showed Refresh kitchen frame");
  }

  await phonePage.goto(`${BASE}/family/manage`, { waitUntil: "load" });
  await phonePage.waitForSelector('[data-testid="refresh-frame"]', { timeout: 20000 });

  const kidPhone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await kidPhone.addCookies([
    {
      name: "lp_session",
      value: kidToken,
      url: BASE,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const kidPage = await kidPhone.newPage();
  await kidPage.goto(`${BASE}/family`, { waitUntil: "load" });
  await kidPage.waitForSelector("h1:has-text('Today')", { timeout: 20000 });
  if (await kidPage.locator('[data-testid="refresh-frame"]').count()) {
    throw new Error("Kid session showed Refresh kitchen frame");
  }
  if (await kidPage.getByText("Refresh kitchen frame").count()) {
    throw new Error("Kid session showed refresh copy");
  }
  await kidPage.goto(`${BASE}/family/manage`, { waitUntil: "load" });
  await kidPage.waitForTimeout(600);
  if (await kidPage.locator('[data-testid="refresh-frame"]').count()) {
    throw new Error("Kid manage view showed Refresh kitchen frame");
  }
  await kidPhone.close();

  let buildId = "v1";
  await framePage.route("**/api/version", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ buildId, refreshRequestedAt: null }),
    });
  });

  await framePage.goto(`${BASE}/display?pollMs=250&idleMs=800`, { waitUntil: "domcontentloaded" });
  await framePage.waitForSelector('[data-testid="pair-code"], [data-testid="clock"]', { timeout: 20000 });
  await framePage.waitForFunction(() => Boolean((window as Window & { __liendoKitchenReady?: number }).__liendoKitchenReady));
  const boot = await framePage.evaluate(() => (window as Window & { __liendoKitchenReady?: number }).__liendoKitchenReady);
  await framePage.mouse.click(40, 40);
  const sawV2 = framePage.waitForResponse((response) => response.url().includes("/api/version") && response.ok());
  buildId = "v2";
  await sawV2;
  await framePage.mouse.click(80, 80);
  await framePage.waitForTimeout(300);
  const stillBoot = await framePage.evaluate(() => (window as Window & { __liendoKitchenReady?: number }).__liendoKitchenReady);
  if (stillBoot !== boot) throw new Error("Frame reloaded while still being touched");
  await framePage.mouse.click(120, 120);
  await framePage.waitForFunction(
    (started) => (window as Window & { __liendoKitchenReady?: number }).__liendoKitchenReady !== started,
    boot,
    { timeout: 4000 },
  );
  console.log("idle version change reloaded after touch stopped");

  await framePage.unroute("**/api/version");
  await framePage.goto(`${BASE}/display?pollMs=250&idleMs=150`, { waitUntil: "domcontentloaded" });
  await framePage.waitForSelector('[data-testid="pair-code"], [data-testid="clock"]', { timeout: 20000 });
  await framePage.waitForFunction(() => Boolean((window as Window & { __liendoKitchenReady?: number }).__liendoKitchenReady));
  const refreshBoot = await framePage.evaluate(
    () => (window as Window & { __liendoKitchenReady?: number }).__liendoKitchenReady,
  );
  await phonePage.goto(`${BASE}/family/manage`, { waitUntil: "load" });
  await phonePage.waitForSelector('[data-testid="refresh-frame"]', { timeout: 20000 });
  await phonePage.locator('[data-testid="refresh-frame"]').click();
  await phonePage.waitForSelector('[data-testid="toast"]', { timeout: 8000 });
  const toast = (await phonePage.locator('[data-testid="toast"]').innerText()).trim();
  assert(toast.includes("Frame will refresh in a moment"), `unexpected toast: ${toast}`);
  await framePage.waitForFunction(
    (started) => (window as Window & { __liendoKitchenReady?: number }).__liendoKitchenReady !== started,
    refreshBoot,
    { timeout: 4000 },
  );
  console.log("parent refresh reloaded the frame");

  await browser.close();
  console.log("display-refresh passed: idle reload, parent trigger, kids blocked");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
