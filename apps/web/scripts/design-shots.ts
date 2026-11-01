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
    const clock = document.querySelector("[data-testid='clock'], [data-testid='pair-code'], h1");
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
    await shot(framePage, "unpaired_qr");
  } else {
    await shot(framePage, "unpaired_qr");
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

  await phonePage.goto(`${BASE}/family/chores`, { waitUntil: "load" });
  await phonePage.waitForSelector("text=Add chore", { timeout: 20000 });
  await shot(phonePage, "phone_chores");

  if (pairCode) {
    await phonePage.goto(`${BASE}/family/add-device`, { waitUntil: "domcontentloaded" });
    await phonePage.waitForSelector('[data-testid="approve-code"]', { timeout: 20000 });
    await phonePage.locator('[data-testid="approve-code"]').fill(pairCode);
    await phonePage.locator('[data-testid="approve-submit"]').click();
    await framePage.waitForSelector('[data-testid="clock"]', { timeout: 20000 });
  }

  if (alreadyPaired || pairCode) {
    await framePage.goto(`${BASE}/display`, { waitUntil: "load" });
    await framePage.waitForSelector('[data-testid="clock"]', { timeout: 20000 });
    await shot(framePage, "kitchen_board");
  }

  await browser.close();
  console.log(`wrote ${prefix} shots to ${artifacts}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
