import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";

async function main() {
  const browser = await chromium.launch();
  const frame = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const framePage = await frame.newPage();
  const docs: string[] = [];
  framePage.on("request", (request) => {
    if (request.resourceType() === "document") docs.push(request.url());
  });

  await framePage.goto(`${BASE}/display`, { waitUntil: "load" });
  await framePage.waitForSelector('[data-testid="pair-code"], [data-testid="clock"]', { timeout: 20000 });
  const alreadyPaired = Boolean(await framePage.locator('[data-testid="clock"]').count());
  let pairCode = "";
  if (!alreadyPaired) {
    pairCode = (await framePage.locator('[data-testid="pair-code"]').innerText()).trim();
  }

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phonePage = await phone.newPage();
  const phoneDocs: string[] = [];
  phonePage.on("request", (request) => {
    if (request.resourceType() === "document") phoneDocs.push(request.url());
  });
  await phonePage.goto(`${BASE}/family`, { waitUntil: "load" });
  await phonePage.waitForSelector('[data-testid="bootstrap-focus"], a[href="/family/manage"]', { timeout: 20000 });
  const bootstrap = phonePage.locator('[data-testid="bootstrap-focus"]');
  if (await bootstrap.count()) {
    await bootstrap.click();
    await phonePage.locator('[data-testid="bootstrap-pin"]').fill("123456");
    await phonePage.locator('[data-testid="bootstrap-open"]').click();
  }
  await phonePage.waitForSelector('a[href="/family/manage"], h1:has-text("Today")', { timeout: 20000 });

  if (pairCode) {
    await phonePage.goto(`${BASE}/family/add-device`, { waitUntil: "domcontentloaded" });
    await phonePage.waitForSelector('[data-testid="approve-code"]', { timeout: 20000 });
    await phonePage.locator('[data-testid="approve-code"]').fill(pairCode);
    await phonePage.locator('[data-testid="approve-submit"]').click();
    await framePage.waitForSelector('[data-testid="clock"]', { timeout: 20000 });
  }

  await framePage.goto(`${BASE}/display`, { waitUntil: "load" });
  await framePage.waitForSelector('[data-testid="clock"]', { timeout: 20000 });
  docs.length = 0;

  for (const label of ["Week", "Chores", "Dinners", "Today"]) {
    await framePage.getByRole("navigation", { name: "Board" }).getByText(label, { exact: true }).click();
    await framePage.waitForTimeout(200);
  }
  if (docs.length > 0) {
    throw new Error(`Kitchen tab switch made document requests: ${docs.join(", ")}`);
  }
  if (await framePage.getByText("Getting today ready.").count()) {
    throw new Error("Kitchen showed a loading state after the initial load.");
  }
  const kitchenView = await framePage.getAttribute("main", "data-testid");
  if (kitchenView !== "view-home") throw new Error(`Kitchen ended on ${kitchenView}, expected view-home`);

  phoneDocs.length = 0;
  await phonePage.goto(`${BASE}/family`, { waitUntil: "load" });
  await phonePage.waitForSelector("text=Today", { timeout: 20000 });
  phoneDocs.length = 0;
  for (const label of ["Week", "Dinner", "Stars", "Today"]) {
    await phonePage.locator("nav.tabs").getByText(label, { exact: true }).click();
    await phonePage.waitForTimeout(200);
  }
  if (phoneDocs.length > 0) {
    throw new Error(`Phone tab switch made document requests: ${phoneDocs.join(", ")}`);
  }

  await framePage.route("**/api/chores/instances/**/complete", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  const bed = framePage.locator('[data-testid="chore-Make your bed"]');
  if (await bed.count()) {
    const before = Date.now();
    await bed.click();
    await framePage.waitForFunction(() => {
      const button = document.querySelector('[data-testid="chore-Make your bed"]');
      return button?.getAttribute("data-status") === "done";
    }, null, { timeout: 800 });
    const elapsed = Date.now() - before;
    if (elapsed >= 1800) {
      throw new Error(`Optimistic chore tap waited ${elapsed}ms; expected UI before the throttled response`);
    }
    console.log(`optimistic chore tap updated in ${elapsed}ms`);
  } else {
    console.log("skipped optimistic tap; Make your bed was not on the board");
  }

  await browser.close();
  console.log("query-nav passed: soft tabs, no document reloads, optimistic chore tap");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
