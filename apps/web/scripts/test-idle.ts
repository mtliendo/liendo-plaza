import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { Settings } from "luxon";
import { GET as reminders } from "../app/api/cron/reminders/route";
import { displayFromToken, pairDisplay, personFromSession } from "../lib/auth";
import { getDb, getPool, schema } from "../lib/db";
import { shouldPollDisplay } from "../lib/display-activity";
import { presenceIsStale, PRESENCE_INTERVAL_MS } from "../lib/presence";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.match(database.pathname, /^\/liendo_idle_test_\d+$/);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const db = getDb();
const token = randomUUID();
let deviceId: string;

before(async () => {
  const [person] = await db.insert(schema.people).values({
    slug: "idle-parent", name: "Parent", role: "parent", color: "#123456",
  }).returning();
  const [session] = await db.insert(schema.sessions).values({
    personId: person.id, tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 3600_000),
  }).returning();
  const [device] = await db.insert(schema.devices).values({
    kind: "browser", label: "Test", personId: person.id, sessionId: session.id,
    lastSeenAt: new Date(Date.now() - PRESENCE_INTERVAL_MS - 1),
  }).returning();
  deviceId = device.id;
  await db.update(schema.sessions).set({ deviceId }).where(eq(schema.sessions.id, session.id));
});
after(async () => { await getPool().end(); });

test("display polling uses Chicago quiet hours in winter and summer, including both boundaries", () => {
  for (const offset of ["-06:00", "-05:00"]) {
    const day = offset === "-06:00" ? "2026-01-15" : "2026-07-15";
    for (const [time, expected] of [["05:59", false], ["06:00", true], ["21:59", true], ["22:00", false]] as const) {
      assert.equal(shouldPollDisplay(Date.parse(`${day}T${time}:00${offset}`), true), expected);
    }
  }
});

test("hidden displays never poll; a night-time tap wakes a visible display for five minutes", () => {
  const night = Date.parse("2026-01-15T23:00:00-06:00");
  assert.equal(shouldPollDisplay(night, false, night + 300_000), false);
  assert.equal(shouldPollDisplay(night, true, night + 300_000), true);
  assert.equal(shouldPollDisplay(night + 300_000, true, night + 300_000), false);
});

test("presence handles missing values and only expires after fifteen minutes", () => {
  const now = new Date();
  assert.equal(presenceIsStale(null, now), true);
  assert.equal(presenceIsStale(now, now), false);
  assert.equal(presenceIsStale(new Date(now.getTime() - PRESENCE_INTERVAL_MS + 1), now), false);
  assert.equal(presenceIsStale(new Date(now.getTime() - PRESENCE_INTERVAL_MS), now), true);
});

test("quiet hours remain asleep across the Chicago midnight boundary", () => {
  for (const time of ["2026-01-15T23:59:59-06:00", "2026-01-16T00:00:00-06:00"]) {
    assert.equal(shouldPollDisplay(Date.parse(time), true), false);
    assert.equal(shouldPollDisplay(Date.parse(time), false), false);
  }
});

test("session presence is throttled without caching authorization or hiding revocation", async () => {
  assert.ok(await personFromSession(token));
  const [first] = await db.select().from(schema.devices).where(eq(schema.devices.id, deviceId));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(await personFromSession(token));
  const [second] = await db.select().from(schema.devices).where(eq(schema.devices.id, deviceId));
  assert.deepEqual(second.lastSeenAt, first.lastSeenAt);
  await db.update(schema.devices).set({ revokedAt: new Date() }).where(eq(schema.devices.id, deviceId));
  assert.equal(await personFromSession(token), null);
  assert.equal(await personFromSession("invalid"), null);
});

test("display presence is throttled and revoked display tokens fail immediately", async () => {
  const display = await pairDisplay("Idle test");
  await db.update(schema.displayPairings).set({ lastSeenAt: null });
  assert.equal(await displayFromToken(display), true);
  const [first] = await db.select().from(schema.displayPairings);
  const [device] = await db.select().from(schema.devices).where(eq(schema.devices.id, first.deviceId!));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await displayFromToken(display), true);
  const [second] = await db.select().from(schema.displayPairings);
  const [nextDevice] = await db.select().from(schema.devices).where(eq(schema.devices.id, first.deviceId!));
  assert.deepEqual(second.lastSeenAt, first.lastSeenAt);
  assert.deepEqual(nextDevice.lastSeenAt, device.lastSeenAt);
  await db.update(schema.displayPairings).set({ revokedAt: new Date() });
  assert.equal(await displayFromToken(display), false);
  assert.equal(await displayFromToken("invalid"), false);
});

test("reminder cron rejects invalid auth, skips off-minute calls before the DB and preserves due-hour behavior", async () => {
  const originalNow = Settings.now;
  const secret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "idle-test-cron";
  const request = () => new Request("http://idle.test/api/cron/reminders", {
    headers: { authorization: "Bearer idle-test-cron" },
  });
  try {
    assert.equal((await reminders(new Request("http://idle.test/api/cron/reminders"))).status, 401);
    Settings.now = () => Date.parse("2026-01-15T18:30:00-06:00");
    const pool = getPool();
    const query = pool.query;
    pool.query = (() => { throw new Error("Off-minute cron must not touch Postgres"); }) as typeof query;
    try {
      assert.deepEqual(await (await reminders(request())).json(), { skipped: true, reason: "past the first quarter hour" });
    } finally { pool.query = query; }
    Settings.now = () => Date.parse("2026-01-15T17:00:00-06:00");
    assert.deepEqual(await (await reminders(request())).json(), { skipped: true, reason: "not the reminder hour" });
    Settings.now = () => Date.parse("2026-01-15T18:00:00-06:00");
    assert.deepEqual(await (await reminders(request())).json(), { sent: 0, date: "2026-01-15" });
  } finally {
    Settings.now = originalNow;
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
  }
});

test("the pg pool closes idle connections instead of keeping a backend connected", async () => {
  await getPool().query("select 1");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(getPool().totalCount, 0);
});
