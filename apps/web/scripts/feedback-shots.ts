import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.PREVIEW_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const artifacts = process.env.E2E_ARTIFACTS ?? "/opt/cursor/artifacts";

async function shot(page: import("playwright").Page, name: string) {
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, name), fullPage: false });
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  const beforeDir = "/home/ubuntu/.cursor/projects/agent-repos-liendo-plaza/assets";
  await copyFile(join(beforeDir, "phone-today.png"), join(artifacts, "before_phone_today.png")).catch(() => undefined);
  await copyFile(join(beforeDir, "phone-week.png"), join(artifacts, "before_phone_week.png")).catch(() => undefined);
  await copyFile(join(beforeDir, "phone-dinner.png"), join(artifacts, "before_phone_dinner.png")).catch(() => undefined);
  await copyFile(join(beforeDir, "frame-chores.jpg"), join(artifacts, "before_frame_chores.jpg")).catch(() => undefined);

  const browser = await chromium.launch();
  const frame = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const framePage = await frame.newPage();
  await framePage.goto(`${BASE}/display`, { waitUntil: "load" });
  await framePage.waitForSelector('[data-testid="pair-code"], [data-testid="clock"]', { timeout: 20000 });
  let pairCode = "";
  if (!(await framePage.locator('[data-testid="clock"]').count())) {
    pairCode = (await framePage.locator('[data-testid="pair-code"]').innerText()).trim();
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
  await phonePage.waitForSelector("h1:has-text(\"Today\")", { timeout: 20000 });

  if (pairCode) {
    await phonePage.goto(`${BASE}/family/add-device`, { waitUntil: "domcontentloaded" });
    await phonePage.waitForSelector('[data-testid="approve-code"]', { timeout: 20000 });
    await phonePage.locator('[data-testid="approve-code"]').fill(pairCode);
    await phonePage.locator('[data-testid="approve-submit"]').click();
    await framePage.waitForSelector('[data-testid="clock"]', { timeout: 20000 });
  }

  await phonePage.goto(`${BASE}/family`, { waitUntil: "load" });
  await phonePage.waitForSelector("h1:has-text(\"Today\")", { timeout: 20000 });
  await shot(phonePage, "after_phone_today.png");
  await phonePage.locator(".chore-card").first().click();
  await phonePage.waitForSelector('[data-testid="chore-detail"]', { timeout: 10000 });
  await shot(phonePage, "after_phone_chore_detail.png");
  await phonePage.locator('[data-testid="chore-detail"] button:has-text("Close")').click();

  await phonePage.goto(`${BASE}/family/calendar`, { waitUntil: "load" });
  await phonePage.waitForSelector('[data-testid="week-glance"]', { timeout: 20000 });
  await shot(phonePage, "after_phone_week.png");

  await phonePage.goto(`${BASE}/family/meals`, { waitUntil: "load" });
  await phonePage.waitForSelector('[data-testid="dinner-list"]', { timeout: 20000 });
  await shot(phonePage, "after_phone_dinner.png");

  await phonePage.goto(`${BASE}/family/chores`, { waitUntil: "load" });
  await phonePage.waitForSelector('[data-testid="chore-manage"]', { timeout: 20000 });
  const jpegBytes = await fetch(`${BASE}/meals/tacos.jpg`).then((res) => res.arrayBuffer());
  const choresRes = await phonePage.evaluate(async () => {
    const res = await fetch("/api/chores");
    return (await res.json()) as { chores: { id: string; title: string }[] };
  });
  const firstChore = choresRes.chores.find((chore) => chore.title === "Make your bed") ?? choresRes.chores[0];
  if (firstChore) {
    await phonePage.evaluate(async ({ id, bytes }) => {
      const file = new File([new Uint8Array(bytes)], "chore.jpg", { type: "image/jpeg" });
      const form = new FormData();
      form.append("photo", file);
      await fetch(`/api/chores/${id}/guide-photo`, { method: "POST", body: form });
    }, { id: firstChore.id, bytes: Array.from(new Uint8Array(jpegBytes)) });
    await phonePage.reload({ waitUntil: "load" });
    await phonePage.waitForSelector('[data-testid="chore-manage"]', { timeout: 20000 });
  }
  await phonePage.locator(".chore-manage-row:has-text(\"Make your bed\") button:has-text(\"Edit\")").click();
  const photoField = phonePage.locator('[data-testid="photo-field"]').first();
  await photoField.locator("img").waitFor({ timeout: 10000 });
  await photoField.scrollIntoViewIfNeeded();
  await shot(phonePage, "after_phone_chore_edit.png");
  await shot(phonePage, "phone_edit_photo.png");

  async function assertFrameFills() {
    const report = await framePage.evaluate(() => {
      const kitchen = document.querySelector(".kitchen");
      const board = document.querySelector(".board-week");
      if (!kitchen || !board) return { ok: false, reason: "missing board" };
      const kit = kitchen.getBoundingClientRect();
      const fill = board.getBoundingClientRect();
      const overflow = kitchen.scrollHeight > kitchen.clientHeight + 8;
      const gap = kit.bottom - fill.bottom;
      return { ok: !overflow && gap < 48 && fill.height > 520, overflow, gap, height: fill.height };
    });
    if (!report.ok) throw new Error(`frame board does not fill: ${JSON.stringify(report)}`);
  }

  if (await framePage.locator('[data-testid="clock"]').count()) {
    await framePage.goto(`${BASE}/display/chores`, { waitUntil: "load" });
    await framePage.waitForSelector('[data-testid="board-chores"]', { timeout: 20000 });
    await assertFrameFills();
    await shot(framePage, "after_frame_chores.png");
    await framePage.locator(".board-chore").first().click();
    await framePage.waitForSelector('[data-testid="chore-detail"]', { timeout: 10000 });
    await shot(framePage, "after_frame_chore_detail.png");
    await framePage.locator('[data-testid="chore-detail"] button:has-text("Close")').click();
    await framePage.goto(`${BASE}/display/week`, { waitUntil: "load" });
    await framePage.waitForSelector('[data-testid="board-week"]', { timeout: 20000 });
    await assertFrameFills();
    await shot(framePage, "after_frame_week.png");
    await framePage.goto(`${BASE}/display/meals`, { waitUntil: "load" });
    await framePage.waitForSelector('[data-testid="board-meals"]', { timeout: 20000 });
    await assertFrameFills();
    await shot(framePage, "after_frame_dinners.png");
    await shot(framePage, "frame_dinners_photos.png");
  }

  await browser.close();
  console.log(`wrote feedback shots to ${artifacts}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
