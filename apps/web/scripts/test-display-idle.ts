import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";

const base = new URL(process.env.E2E_BASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname) && base.port && base.port !== "3000");

async function visibility(page: Page, state: "visible" | "hidden") {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: next });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  await page.clock.runFor(1000);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    const page = await browser.newPage();
    const counts: Record<string, number> = {};
    const snapshotRanges: string[] = [];
    let paired = true;
    let finishPairing = false;
    let versionFails = false;
    await page.clock.install({ time: new Date("2026-01-15T12:00:00-06:00") });
    await page.route("**/api/**", async (route) => {
      const name = new URL(route.request().url()).pathname;
      if (name === "/api/snapshot") snapshotRanges.push(new URL(route.request().url()).search);
      counts[name] = (counts[name] ?? 0) + 1;
      let body: unknown = {};
      let status = 200;
      if (name === "/api/me") body = { actor: paired ? { kind: "display" } : null };
      if (name === "/api/snapshot") body = {
        now: new Date().toISOString(), timezone: "America/Chicago", weather: null, events: [],
        chores: [], meals: [], stars: [], people: [], settings: { choreReminderHour: 18, choreReminderMinute: 0 },
      };
      if (name === "/api/version") {
        body = { buildId: "idle-test", refreshRequestedAt: null };
        if (versionFails) status = 500;
      }
      if (name === "/api/chores") body = { chores: [] };
      if (name === "/api/rewards") body = { rewards: [] };
      if (name === "/api/rewards/requests") body = { requests: [] };
      if (name === "/api/pair/claim") body = {
        id: "idle-claim", displayCode: "ABC-DEF", qrDataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        pollSecret: "test-poll-secret", expiresAt: "2026-01-16T00:00:00Z",
      };
      if (name === "/api/pair/poll") body = { status: finishPairing ? "paired" : "pending" };
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(new URL("/display", base).href);
    await page.getByTestId("clock").waitFor();
    await page.clock.runFor(121_000);
    assert.equal(counts["/api/pair/claim"] ?? 0, 0);
    assert.equal(counts["/api/pair/poll"] ?? 0, 0);
    assert.ok(counts["/api/snapshot"] >= 2);
    assert.ok(counts["/api/version"] >= 2);
    console.log("PASS paired daytime board: minute refresh preserved; zero pairing requests");

    await visibility(page, "hidden");
    const hidden = { ...counts };
    await page.clock.runFor(601_000);
    assert.deepEqual(counts, hidden);
    await visibility(page, "visible");
    await page.clock.runFor(61_000);
    assert.ok(counts["/api/snapshot"] > hidden["/api/snapshot"]);
    console.log("PASS hidden board: no API traffic for ten minutes; visible board resumes");

    await page.clock.setSystemTime(new Date("2026-01-15T22:01:00-06:00"));
    await page.clock.runFor(16_000);
    const quiet = { ...counts };
    const dimmedTime = await page.locator("button.dim .clock").innerText();
    await page.clock.runFor(601_000);
    assert.deepEqual(counts, quiet);
    assert.notEqual(await page.locator("button.dim .clock").innerText(), dimmedTime);
    console.log("PASS dimmed clock advances locally without API traffic");
    await page.locator("button.dim").click();
    await page.clock.runFor(61_000);
    assert.ok(counts["/api/snapshot"] > quiet["/api/snapshot"]);
    await page.clock.runFor(301_000);
    const asleep = { ...counts };
    await page.clock.runFor(601_000);
    assert.deepEqual(counts, asleep);
    console.log("PASS quiet board: no API traffic; tap wakes it temporarily then polling stops again");

    const sleepingRange = snapshotRanges.at(-1);
    await page.clock.setSystemTime(new Date("2026-01-15T23:59:30-06:00"));
    await page.clock.runFor(61_000);
    assert.deepEqual(counts, asleep);
    await page.locator("button.dim .clock").waitFor();
    console.log("PASS visible midnight rollover keeps the sleeping range and makes no API requests");

    await visibility(page, "hidden");
    await page.clock.setSystemTime(new Date("2026-01-16T23:59:30-06:00"));
    await page.clock.runFor(61_000);
    assert.deepEqual(counts, asleep);
    await visibility(page, "visible");
    await page.clock.runFor(16_000);
    assert.deepEqual(counts, asleep);
    console.log("PASS hidden midnight rollover and nighttime visibility resume make no API requests");

    versionFails = true;
    await page.clock.setSystemTime(new Date("2026-01-17T06:00:00-06:00"));
    await page.clock.runFor(76_000);
    assert.ok(counts["/api/snapshot"] > asleep["/api/snapshot"]);
    assert.notEqual(snapshotRanges.at(-1), sleepingRange);
    await page.getByTestId("clock").waitFor();
    console.log("PASS morning refresh resumes and failed version requests preserve the board");

    paired = false;
    await page.clock.setSystemTime(new Date("2026-01-17T23:00:00-06:00"));
    await page.reload();
    await page.getByTestId("kitchen-pair").waitFor();
    await page.clock.runFor(4000);
    assert.ok(counts["/api/pair/poll"] >= 1);
    await visibility(page, "hidden");
    const waiting = counts["/api/pair/poll"];
    await page.clock.runFor(10_000);
    assert.equal(counts["/api/pair/poll"], waiting);
    await visibility(page, "visible");
    const pairedResponse = page.waitForResponse(async (response) =>
      new URL(response.url()).pathname === "/api/pair/poll" && (await response.json()).status === "paired");
    finishPairing = true;
    await page.clock.runFor(4000);
    await pairedResponse;
    await page.clock.runFor(1000);
    const finished = counts["/api/pair/poll"];
    await page.clock.runFor(10_000);
    assert.equal(counts["/api/pair/poll"], finished);
    console.log("PASS nighttime pairing: starts without a tap, pauses while hidden, stops after success");
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
