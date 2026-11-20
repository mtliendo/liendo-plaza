import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { addDays, type ChoreInstance } from "@liendo/shared";
import { handleApi } from "../lib/api";
import { getDb, getPool, schema } from "../lib/db";
import { errorResponse } from "../lib/http";
import { todayIso } from "../lib/time";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.match(database.pathname, /^\/liendo_pending_proofs_test_\d+$/,
  "Use a dedicated pending-proofs test database, never the app database");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));

const db = getDb();
const parentToken = randomUUID();
const kidToken = randomUUID();
const today = todayIso();
const yesterday = addDays(today, -1);
let choreId: string;
let kidId: string;
let yesterdayId: string;

async function request(token?: string) {
  try {
    return await handleApi(new Request("http://pending-proofs.test/api/chores/instances/pending", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

async function state() {
  return JSON.stringify(await Promise.all([
    db.select().from(schema.choreInstances).orderBy(schema.choreInstances.id),
    db.select().from(schema.chores).orderBy(schema.chores.id),
    db.select().from(schema.sessions).orderBy(schema.sessions.id),
    db.select().from(schema.devices).orderBy(schema.devices.id),
    db.select().from(schema.people).orderBy(schema.people.id),
  ]));
}

before(async () => {
  const [parent, kid] = await db.insert(schema.people).values([
    { slug: "proof-parent", name: "Parent", role: "parent", color: "#123456" },
    { slug: "proof-kid", name: "Kid", role: "kid", color: "#123456" },
  ]).returning();
  kidId = kid.id;
  for (const [person, token] of [[parent, parentToken], [kid, kidToken]] as const) {
    const [session] = await db.insert(schema.sessions).values({
      personId: person.id, tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600_000),
    }).returning();
    const [device] = await db.insert(schema.devices).values({
      kind: "phone", label: "Test phone", personId: person.id, sessionId: session.id,
      lastSeenAt: new Date("2020-01-01T00:00:00Z"),
    }).returning();
    await db.update(schema.sessions).set({ deviceId: device.id }).where(eq(schema.sessions.id, session.id));
  }
  const [chore] = await db.insert(schema.chores).values({
    title: "Proof chore", assignedPersonId: kid.id, stars: 3,
    requiresPhoto: true, repeatType: "daily", steps: ["Take a photo"],
  }).returning();
  choreId = chore.id;
  const rows = await db.insert(schema.choreInstances).values([
    { choreId, personId: kidId, date: yesterday, status: "pending", photoPath: "local:yesterday.jpg" },
    { choreId, personId: kidId, date: today, status: "pending", photoPath: "local:today.jpg" },
    { choreId, personId: kidId, date: addDays(today, -2), status: "done" },
    { choreId, personId: kidId, date: addDays(today, -3), status: "open" },
    { choreId, personId: kidId, date: addDays(today, -4), status: "rejected" },
  ]).returning();
  yesterdayId = rows[0].id;
});

after(async () => { await getPool().end(); });

test("parent sees yesterday's pending proof in snapshot shape, oldest first", async () => {
  const response = await request(parentToken);
  assert.equal(response.status, 200);
  const { instances } = await response.json() as { instances: ChoreInstance[] };
  assert.deepEqual(instances.map((item) => item.date), [yesterday, today]);
  assert.equal(instances[0].id, yesterdayId);
  assert.equal(instances[0].photoPath, "local:yesterday.jpg");
  assert.equal(instances[0].title, "Proof chore");
  assert.deepEqual(instances[0].steps, ["Take a photo"]);
  assert.ok(instances.every((item) => item.status === "pending"));
});

test("kids get 403 and unauthenticated callers get 401", async () => {
  assert.equal((await request(kidToken)).status, 403);
  assert.equal((await request()).status, 401);
});

test("reading pending proofs leaves row counts and all stored values unchanged", async () => {
  const before = await state();
  assert.equal((await request(parentToken)).status, 200);
  assert.equal((await request(kidToken)).status, 403);
  assert.equal(await state(), before);
});

test("empty queue returns an empty array", async () => {
  await db.update(schema.choreInstances).set({ status: "done" })
    .where(eq(schema.choreInstances.status, "pending"));
  const response = await request(parentToken);
  assert.deepEqual(await response.json(), { instances: [] });
});

test("pending queue is capped at 100 oldest instances", async () => {
  const dates = Array.from({ length: 105 }, (_, index) => addDays(today, index - 200));
  await db.insert(schema.choreInstances).values(dates.map((date) => ({
    choreId, personId: kidId, date, status: "pending", photoPath: "local:old.jpg",
  })));
  const response = await request(parentToken);
  const { instances } = await response.json() as { instances: ChoreInstance[] };
  assert.equal(instances.length, 100);
  assert.deepEqual(instances.map((item) => item.date), dates.slice(0, 100));
});
