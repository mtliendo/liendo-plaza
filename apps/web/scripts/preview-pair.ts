import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.PREVIEW_URL ?? process.env.E2E_BASE_URL;
if (!BASE) throw new Error("PREVIEW_URL is required");

const artifacts = process.env.E2E_ARTIFACTS ?? "/opt/cursor/artifacts";

async function shot(page: import("playwright").Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, name), fullPage: false });
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  const notes: string[] = [];
  const browser = await chromium.launch();

  const frame = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const framePage = await frame.newPage();
  await framePage.goto(`${BASE}/display`, { waitUntil: "domcontentloaded" });
  await framePage.waitForSelector('[data-testid="pair-code"], [data-testid="clock"]', { timeout: 20000 });
  const alreadyPaired = Boolean(await framePage.locator('[data-testid="clock"]').count());
  let pairCode = "";
  if (alreadyPaired) {
    notes.push("Frame already had a display cookie in this browser context (unexpected for a fresh context).");
  } else {
    await framePage.waitForSelector('[data-testid="pair-code"]');
    pairCode = (await framePage.locator('[data-testid="pair-code"]').innerText()).trim();
    notes.push(`Frame unpaired QR code: ${pairCode}`);
  }
  await shot(framePage, "preview_frame_unpaired.png");

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${BASE}/family`, { waitUntil: "domcontentloaded" });
  await phonePage.waitForTimeout(600);
  await shot(phonePage, "preview_phone_unpaired.png");

  const bootstrapButton = phonePage.locator('[data-testid="bootstrap-focus"]');
  if (await bootstrapButton.count()) {
    await bootstrapButton.click();
    await phonePage.locator('[data-testid="bootstrap-pin"]').fill("123456");
    await phonePage.locator('[data-testid="bootstrap-open"]').click();
    await phonePage.waitForSelector("text=Today", { timeout: 15000 });
    notes.push("Bootstrap path: Focus + parent PIN signed in on the phone viewport.");
    await shot(phonePage, "preview_phone_bootstrap.png");
  } else {
    notes.push(
      "Bootstrap was closed (a parent device is already paired). Sign in on a paired parent phone, revoke leftover parent devices, or I could not finish the UI bootstrap path.",
    );
    await shot(phonePage, "preview_phone_bootstrap_closed.png");
  }

  const signedIn = await phonePage.locator("text=Add a device").count();
  if (signedIn && pairCode) {
    await phonePage.goto(`${BASE}/family/add-device`, { waitUntil: "domcontentloaded" });
    await phonePage.locator('[data-testid="approve-code"]').fill(pairCode);
    await phonePage.locator('[data-testid="approve-submit"]').click();
    await phonePage.waitForTimeout(800);
    await shot(phonePage, "preview_phone_approve.png");

    await framePage.waitForSelector('[data-testid="clock"]', { timeout: 20000 });
    await shot(framePage, "preview_frame_paired.png");
    notes.push("Full frame pairing: parent approved the short code; the board received its cookie and showed today.");

    await phonePage.locator('[data-testid="invite-phone"]').click();
    await phonePage.waitForSelector('[data-testid="invite-qr"]', { timeout: 10000 });
    await phonePage.locator('[data-testid="invite-qr"]').scrollIntoViewIfNeeded();
    await shot(phonePage, "preview_phone_invite.png");
    const inviteUrl = (await phonePage.locator('[data-testid="invite-url"]').innerText()).trim();

    const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const guestPage = await guest.newPage();
    await guestPage.goto(inviteUrl, { waitUntil: "domcontentloaded" });
    await guestPage.waitForTimeout(800);
    await shot(guestPage, "preview_phone_invite_redeem.png");
    notes.push("Invite QR opened a new phone viewport already paired to the family (name + PIN next).");
    await guest.close();

    await phonePage.goto(`${BASE}/family/devices`, { waitUntil: "domcontentloaded" });
    await phonePage.waitForSelector('[data-testid="device-row"]', { timeout: 15000 });
    await shot(phonePage, "preview_phone_devices.png");
  } else if (!signedIn) {
    notes.push("Could not approve the frame from the phone UI because this viewport never reached a signed-in parent.");
  }

  await browser.close();
  await writeFile(join(artifacts, "preview-pair-notes.txt"), `${notes.join("\n")}\n`);
  console.log(notes.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
