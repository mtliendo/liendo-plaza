import assert from "node:assert/strict";
import { chromium } from "playwright";
import { inArray } from "drizzle-orm";
import { getDb, getPool, schema } from "../lib/db";

async function main() {
  const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const artifacts = process.env.E2E_ARTIFACTS ?? "/Users/devin";
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.match(database.pathname, /^\/liendo_plaza_test_\d+$/);
  const db = getDb();
  const people = await db.select().from(schema.people);
  const sofia = people.find((p) => p.slug === "sofia")!;
  const noah = people.find((p) => p.slug === "noah")!;
  const rewards = await db.insert(schema.rewards).values([
    { name: "Sofia's movie night", starCost: 0 },
    { name: "Noah's pizza night", starCost: 0 },
  ]).returning();
  const rows = await db.insert(schema.rewardRequests).values([
    { personId: sofia.id, rewardId: rewards[0].id },
    { personId: noah.id, rewardId: rewards[1].id },
  ]).returning();
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 },
    recordVideo: { dir: artifacts, size: { width: 1100, height: 850 } } });
  const page = await context.newPage();
  const video = page.video()!;
  try {
    await page.goto(`${base}/family`);
    await page.getByLabel("Enter your code", { exact: true }).fill("0101");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.locator(".phone-who").filter({ hasText: "Sofia" }).waitFor();
    await page.waitForTimeout(3000);
    await page.goto(`${base}/api/rewards/requests`);
    const kid = JSON.parse(await page.locator("body").innerText());
    assert.ok(kid.requests.some((r: { id: string }) => r.id === rows[0].id));
    assert.ok(kid.requests.every((r: { personId: string }) => r.personId === sofia.id));
    await page.screenshot({ path: `${artifacts}/reward-kid.png` });
    await page.waitForTimeout(10000);
    await context.clearCookies();
    await page.goto(`${base}/family`);
    await page.getByLabel("Enter your code", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.locator(".phone-who").filter({ hasText: "Focus" }).waitFor();
    await page.goto(`${base}/family/approvals`);
    await page.getByText("Sofia: Sofia's movie night", { exact: true }).waitFor();
    await page.getByText("Noah: Noah's pizza night", { exact: true }).waitFor();
    await page.screenshot({ path: `${artifacts}/reward-parent.png` });
    await page.waitForTimeout(8000);
    await page.goto(`${base}/api/rewards/requests`);
    const parent = JSON.parse(await page.locator("body").innerText());
    assert.ok(rows.every((row) => parent.requests.some((r: { id: string }) => r.id === row.id)));
    await page.waitForTimeout(8000);
    console.log("PASS Chrome video: real Sofia sign-in -> own API rows only -> Focus sign-in -> both kids in approvals and API");
  } finally {
    await context.close();
    console.log(`Video: ${await video.path()}`);
    await browser.close();
    await db.delete(schema.rewardRequests).where(inArray(schema.rewardRequests.rewardId, rewards.map((r) => r.id)));
    await db.delete(schema.rewards).where(inArray(schema.rewards.id, rewards.map((r) => r.id)));
    await getPool().end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
