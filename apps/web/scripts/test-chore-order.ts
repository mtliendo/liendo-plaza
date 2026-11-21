import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";
import { handleApi } from "../lib/api";
import { createChore, ensureInstances, listChores, updateChore } from "../lib/chores";
import { getDb, getPool, schema } from "../lib/db";
import { errorResponse } from "../lib/http";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.match(database.pathname, /^\/liendo_chore_order_test_\d+$/);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const db = getDb();
const sessions = { parent: randomUUID(), kid: randomUUID() };
let parentId: string;
let kidId: string;
let otherId: string;
let ids: string[];
let sent: { to: string; title: string; body: string; data: unknown }[] = [];

before(async () => {
  const people = await db.insert(schema.people).values([
    { slug: "order-parent", name: "Alex Parent", role: "parent", color: "#123456" },
    { slug: "order-kid", name: "Kid", role: "kid", color: "#123456" },
    { slug: "order-other", name: "Other", role: "kid", color: "#123456" },
  ]).returning();
  [parentId, kidId, otherId] = people.map((p) => p.id);
  for (const [personId, token] of [[parentId, sessions.parent], [kidId, sessions.kid]]) {
    await db.insert(schema.sessions).values({
      personId, tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
  }
  await db.insert(schema.pushTokens).values(people.map((p) => ({
    personId: p.id, token: `expo-${p.id}`, kind: "expo" as const,
  })));
});

beforeEach(async () => {
  await db.delete(schema.chores);
  const rows = await db.insert(schema.chores).values([0, 1, 2].map((i) => ({
    title: `Chore ${i}`, assignedPersonId: kidId, stars: 1, requiresPhoto: false, repeatType: "daily",
    createdAt: new Date(`2026-01-0${i + 1}T00:00:00Z`), sortOrder: i,
  }))).returning();
  ids = rows.map((row) => row.id);
  sent = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://exp.host/--/api/v2/push/send");
    sent.push(...JSON.parse(init.body as string));
    return new Response("{}");
  });
});
after(async () => { mock.restoreAll(); await getPool().end(); });
afterEach(() => { mock.restoreAll(); });

async function api(body: unknown, token = sessions.parent) {
  try {
    return await handleApi(new Request("http://order.test/api/chores/reorder", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }));
  } catch (error) { return errorResponse(error); }
}

test("migration backfills by creation date/id and preserves reordered rows on rerun", async () => {
  await db.update(schema.chores).set({ sortOrder: 0 });
  const migration = await readFile(new URL("../drizzle/0006_chore_order.sql", import.meta.url), "utf8");
  await getPool().query(migration);
  assert.deepEqual((await listChores()).map((c) => [c.id, c.sortOrder]), ids.map((id, i) => [id, i]));
  const reversed = [...ids].reverse();
  assert.equal((await api({ personId: kidId, choreIds: reversed })).status, 200);
  await getPool().query(migration);
  assert.deepEqual((await listChores()).map((c) => c.id), reversed);
});

test("create appends and reassignment appends to new person's list", async () => {
  const input = { title: "New", assignedPersonId: kidId, stars: 1, requiresPhoto: false,
    repeatType: "daily" as const, weekdays: null, weeklyWeekday: null, onceDate: null,
    description: null, steps: [], guidePhotoPath: null };
  const created = await createChore(input);
  assert.equal(created.sortOrder, 3);
  const other = await createChore({ ...input, assignedPersonId: otherId });
  assert.equal(other.sortOrder, 0);
  const reassigned = await updateChore(created.id, { assignedPersonId: otherId });
  assert.equal(reassigned.sortOrder, 1);
  assert.deepEqual((await listChores()).filter((c) => c.assignedPersonId === otherId).map((c) => c.id),
    [other.id, created.id]);
});

test("transaction-scoped writes append and roll back with their caller", async () => {
  const before = await listChores();
  await assert.rejects(() => db.transaction(async (tx) => {
    const reassigned = await updateChore(ids[0], { assignedPersonId: otherId }, tx);
    assert.equal(reassigned.sortOrder, 0);
    const created = await createChore({ ...before[0], title: "Transaction chore", assignedPersonId: otherId }, tx);
    assert.equal(created.sortOrder, 1);
    throw new Error("Roll back caller");
  }), /Roll back caller/);
  assert.deepEqual(await listChores(), before);
});

test("reorder persists order in definitions and joined instances without deleting open instances", async () => {
  const before = await ensureInstances("2026-07-01", "2026-07-01");
  const reversed = [...ids].reverse();
  const response = await api({ personId: kidId, choreIds: reversed });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).chores.map((c: { id: string }) => c.id), reversed);
  const after = await ensureInstances("2026-07-01", "2026-07-01");
  assert.deepEqual(after.map((c) => c.choreId), reversed);
  assert.deepEqual(after.map((c) => c.sortOrder), [0, 1, 2]);
  assert.deepEqual(after.map((c) => c.id).sort(), before.map((c) => c.id).sort());
});

test("kid cannot reorder", async () => {
  assert.equal((await api({ personId: kidId, choreIds: [...ids].reverse() }, sessions.kid)).status, 403);
  assert.equal(sent.length, 0);
});

test("invalid schema, missing, duplicate, inactive, and foreign chore sets return 400 atomically", async () => {
  const [foreign] = await db.insert(schema.chores).values({
    title: "Other", assignedPersonId: otherId, stars: 1, repeatType: "daily",
  }).returning();
  const [inactive] = await db.insert(schema.chores).values({
    title: "Inactive", assignedPersonId: kidId, stars: 1, repeatType: "daily", active: false,
  }).returning();
  for (const body of [null, {}, { personId: "bad", choreIds: ids },
    { personId: kidId, choreIds: ["bad"] },
    ...[[], ids.slice(1), [ids[0], ids[0], ids[2]], [...ids, foreign.id], [...ids, inactive.id]]
      .map((choreIds) => ({ personId: kidId, choreIds }))]) {
    assert.equal((await api(body)).status, 400);
  }
  assert.deepEqual((await listChores()).filter((c) => c.assignedPersonId === kidId && c.active).map((c) => c.id), ids);
  assert.equal(sent.length, 0);
});

test("empty and unchanged lists succeed without a push", async () => {
  assert.equal((await api({ personId: kidId, choreIds: ids })).status, 200);
  const empty = await api({ personId: otherId, choreIds: [] });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).chores, []);
  assert.equal(sent.length, 0);
});

test("changed order sends only the affected kid a chore navigation payload", async () => {
  const reversed = [...ids].reverse();
  assert.equal((await api({ personId: kidId, choreIds: reversed })).status, 200);
  assert.deepEqual(sent.map(({ to, title, body, data }) => ({ to, title, body, data })), [{
    to: `expo-${kidId}`, title: "Chore order changed", body: "Alex rearranged your chores.", data: { type: "chores" },
  }]);
  assert.equal((await api({ personId: kidId, choreIds: reversed })).status, 200);
  assert.equal(sent.length, 1);
});
