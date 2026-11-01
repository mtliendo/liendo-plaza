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
    await framePage.waitForSelector('[data-testid="pair-code"]');
    pairCode = (await framePage.locator('[data-testid="pair-code"]').innerText()).trim();
  }

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${BASE}/family`, { waitUntil: "load" });
  await phonePage.waitForSelector('[data-testid="bootstrap-focus"], a[href="/family/add-device"]', { timeout: 20000 });

  const bootstrap = phonePage.locator('[data-testid="bootstrap-focus"]');
  if (await bootstrap.count()) {
    await bootstrap.click();
    await phonePage.locator('[data-testid="bootstrap-pin"]').fill("123456");
    await phonePage.locator('[data-testid="bootstrap-open"]').click();
  }

  await phonePage.waitForSelector('a[href="/family/add-device"]', { timeout: 20000 });
  await shot(phonePage, "phone_today");

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
    await fetch("/api/meals", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, name: "Tacos" }),
    });
    const file = await fetch("/meals/tacos.jpg");
    const blob = await file.blob();
    const form = new FormData();
    form.append("photo", blob, "tacos.jpg");
    await fetch(`/api/meals/${date}/photo`, { method: "POST", body: form });
  }, today);

  if (alreadyPaired || pairCode) {
    await framePage.goto(`${BASE}/display?fixture=events-0`, { waitUntil: "load" });
    await framePage.waitForSelector('[data-testid="events"][data-count="0"]', { timeout: 20000 });
    await shot(framePage, "kitchen_events_0");

    await framePage.goto(`${BASE}/display?fixture=events-3`, { waitUntil: "load" });
    await framePage.waitForSelector('[data-testid="events"][data-count="few"]', { timeout: 20000 });
    await shot(framePage, "kitchen_events_3");

    await framePage.goto(`${BASE}/display?fixture=events-12`, { waitUntil: "load" });
    await framePage.waitForSelector('[data-testid="events"][data-count="many"]', { timeout: 20000 });
    await shot(framePage, "kitchen_events_12");

    await framePage.goto(`${BASE}/display`, { waitUntil: "load" });
    await framePage.waitForSelector('[data-testid="clock"]', { timeout: 20000 });
    await shot(framePage, "kitchen_board_photo");

    await phonePage.evaluate(async (date) => {
      await fetch(`/api/meals/${date}/photo`, { method: "DELETE" });
    }, today);
    await framePage.reload({ waitUntil: "load" });
    await framePage.waitForSelector('[data-testid="clock"]', { timeout: 20000 });
    await shot(framePage, "kitchen_board");
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
