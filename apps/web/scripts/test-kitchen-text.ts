import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

async function main() {
  const base = new URL(process.env.E2E_BASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(base.hostname) && base.port && base.port !== "3000");
  const sessionFile = process.env.LP_GUIDE_SESSION_FILE;
  const artifacts = process.env.E2E_ARTIFACTS;
  assert.ok(sessionFile && artifacts, "Set LP_GUIDE_SESSION_FILE and E2E_ARTIFACTS for the isolated fixture");
  const tokens = JSON.parse(await readFile(sessionFile, "utf8")) as { display: string };
  await mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    for (const [width, height] of [[1920, 1080], [1366, 768]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addCookies([{ name: "lp_display", value: tokens.display, url: base.origin }]);
      const page = await context.newPage();
      for (const [name, route] of [["home", "/display"], ["chores", "/display/chores"]]) {
        await page.goto(new URL(route, base).href, { waitUntil: "domcontentloaded" });
        await page.getByTestId("clock").waitFor({ timeout: 60000 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images, image => image.decode().catch(() => undefined)));
        });
        if (await page.locator(".dim").count()) await page.locator(".dim").click();
        const issues = await page.evaluate(() => {
          const failures: string[] = [];
          for (const card of document.querySelectorAll<HTMLElement>(".chore-btn,.board-chore")) {
            if (card.scrollHeight > card.clientHeight + 1) failures.push(`Overflowing card: ${card.textContent}`);
          }
          for (const heading of document.querySelectorAll<HTMLElement>(".kid h3")) {
            if (heading.clientHeight > parseFloat(getComputedStyle(heading).lineHeight) * 1.5) {
              failures.push(`Split kid name: ${heading.textContent}`);
            }
          }
          const top = document.querySelector(".kitchen-top")?.getBoundingClientRect();
          if (top) {
            for (const link of document.querySelectorAll(".kitchen-nav a")) {
              if (link.getBoundingClientRect().bottom > top.bottom + 1) failures.push(`Clipped navigation: ${link.textContent}`);
            }
          }
          return failures;
        });
        await page.screenshot({ path: join(artifacts, `kitchen-${name}-${width}x${height}-after.png`) });
        assert.deepEqual(issues, [], `${name} at ${width}x${height}`);
        console.log(`PASS kitchen ${name} ${width}x${height}: cards, names and navigation fit`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
