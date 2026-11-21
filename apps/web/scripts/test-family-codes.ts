import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { handleApi } from "../lib/api";
import { getDb, getPool, schema } from "../lib/db";
import { errorResponse } from "../lib/http";
import { hashPin, personFromSession } from "../lib/auth";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.match(database.pathname, /^\/liendo_codes_test_\d+$/);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const db = getDb();
let parentId: string;
let otherParentId: string;
let kidId: string;
let otherKidId: string;
async function api(path: string, body?: unknown, token?: string, ip = randomUUID()) {
  const response = await handleApi(new Request(`http://codes.test/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })).catch(errorResponse);
  return { status: response.status, body: await response.json() };
}
function setup(overrides = {}) {
  return api("auth/codes/setup", { code: "543210", confirmation: "543210", personId: parentId,
    kids: [{ personId: kidId, code: "0102" }], ...overrides });
}
before(async () => {
  await db.execute(sql`truncate people, family_codes cascade`);
  const people = await db.insert(schema.people).values([
    { slug: "parent", name: "Parent", role: "parent", color: "red", pinHash: await hashPin("111111") },
    { slug: "other-parent", name: "Other parent", role: "parent", color: "blue" },
    { slug: "kid", name: "Kid", role: "kid", color: "green", pinHash: await hashPin("1234") },
    { slug: "other-kid", name: "Other kid", role: "kid", color: "yellow" },
  ]).returning();
  [parentId, otherParentId, kidId, otherKidId] = people.map((p) => p.id);
});
beforeEach(async () => {
  await db.delete(schema.familyCodes);
  await db.update(schema.people).set({ pinLockedUntil: null });
});
after(async () => { await getPool().end(); });

test("fresh setup validates confirmation, lengths and kids without writing partial state", async () => {
  assert.equal((await api("auth/codes/status")).body.setupRequired, true);
  assert.equal((await setup({ confirmation: "543211" })).status, 400);
  assert.equal((await setup({ code: "1234", confirmation: "1234" })).status, 400);
  assert.equal((await setup({ personId: kidId })).status, 400);
  assert.equal((await setup({ kids: [{ personId: parentId, code: "0102" }] })).status, 400);
  assert.equal((await setup({ kids: [{ personId: kidId, code: "0102" }, { personId: otherKidId, code: "0102" }] })).status, 400);
  assert.equal((await db.select().from(schema.familyCodes)).length, 0);
});

test("setup is atomic under a race and stores only hashes; omitted kid codes remain unset", async () => {
  const results = await Promise.all([setup(), setup()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const rows = await db.select().from(schema.familyCodes);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.hash.startsWith("$2") && !["543210", "0102"].includes(r.hash)));
  const result = results.find((r) => r.status === 200)!;
  assert.equal((await personFromSession(result.body.token))?.id, parentId);
  assert.equal((await api("auth/codes/status")).body.setupRequired, false);
  assert.deepEqual((await api("auth/codes/status")).body.people, []);
  assert.equal((await api("auth/login", { code: "1234" })).status, 401);
});

test("shared parent code picks only a parent; kid code directly issues the same device-backed session", async () => {
  await setup();
  const choice = await api("auth/login", { code: "543210" });
  assert.equal(choice.status, 200);
  assert.deepEqual(new Set(choice.body.parents.map((p: { id: string }) => p.id)), new Set([parentId, otherParentId]));
  assert.equal(choice.body.token, undefined);
  const parent = await api("auth/login", { code: "543210", personId: otherParentId, deviceKind: "phone" });
  assert.equal(parent.body.person.id, otherParentId);
  const kid = await api("auth/login", { code: "0102", deviceKind: "phone" });
  assert.equal(kid.body.person.id, kidId);
  assert.equal((await personFromSession(kid.body.token))?.id, kidId);
  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.personId, kidId));
  const [device] = await db.select().from(schema.devices).where(eq(schema.devices.id, session.deviceId!));
  assert.equal(device.kind, "phone");
  assert.equal(device.sessionId, session.id);
  assert.equal((await api("auth/login", { code: "0102", personId: parentId })).status, 401);
  assert.equal((await api("auth/login", { code: "543210", personId: kidId })).status, 401);
});

test("a sole parent signs in directly", async () => {
  await setup();
  await db.update(schema.people).set({ role: "kid" }).where(eq(schema.people.id, otherParentId));
  try { assert.equal((await api("auth/login", { code: "543210" })).body.person.id, parentId); }
  finally { await db.update(schema.people).set({ role: "parent" }).where(eq(schema.people.id, otherParentId)); }
});

test("wrong codes are generic, reset on success, lock for five minutes after ten failures, and honor existing locks", async () => {
  await setup();
  for (const code of ["", "9999", "111111", "nonsense"]) {
    const wrong = await api("auth/login", { code });
    assert.equal(wrong.status, 401); assert.equal(wrong.body.error, "That code is not recognized.");
  }
  for (let i = 0; i < 5; i++) assert.equal((await api("auth/login", { code: "9999" })).status, 401);
  assert.equal((await api("auth/login", { code: "0102" })).status, 200);
  const [reset] = await db.select().from(schema.familyCodes).where(eq(schema.familyCodes.id, "parent"));
  assert.equal(reset.failedAttempts, 0);
  for (let i = 0; i < 9; i++) assert.equal((await api("auth/login", { code: "9999" })).status, 401);
  const before = Date.now();
  const locked = await api("auth/login", { code: "9999" });
  assert.equal(locked.status, 423);
  assert.equal(locked.body.error, "Too many tries. Try again in 5 minutes.");
  const [row] = await db.select().from(schema.familyCodes).where(eq(schema.familyCodes.id, "parent"));
  assert.equal(row.failedAttempts, 10);
  assert.ok(row.lockedUntil && row.lockedUntil.getTime() >= before + 5 * 60_000 && row.lockedUntil.getTime() <= Date.now() + 5 * 60_000);
  const blocked = await api("auth/login", { code: "0102" });
  assert.equal(blocked.status, 423);
  assert.equal(blocked.body.error, locked.body.error);
  await db.update(schema.familyCodes).set({ lockedUntil: new Date(Date.now() - 1) });
  assert.equal((await api("auth/login", { code: "0102" })).status, 200);
  await db.update(schema.people).set({ pinLockedUntil: new Date(Date.now() + 60_000) }).where(eq(schema.people.id, kidId));
  assert.equal((await api("auth/login", { code: "0102" })).status, 423);
});

test("login and setup enforce per-IP rate limits", async () => {
  await setup();
  const ip = randomUUID();
  for (let i = 0; i < 20; i++) assert.equal((await api("auth/login", { code: "543210" }, undefined, ip)).status, 200);
  assert.equal((await api("auth/login", { code: "543210" }, undefined, ip)).status, 429);
  const setupIp = randomUUID();
  for (let i = 0; i < 10; i++) assert.equal((await api("auth/codes/setup", {}, undefined, setupIp)).status, 400);
  assert.equal((await api("auth/codes/setup", {}, undefined, setupIp)).status, 429);
});

test("only parents manage codes; changes, duplicate rejection, clear and old-code rejection work", async () => {
  const parent = (await setup()).body.token;
  const kid = (await api("auth/login", { code: "0102" })).body.token;
  assert.equal((await api("auth/codes", { code: "654321", confirmation: "654321" }, kid)).status, 403);
  assert.equal((await api("pair/approve", { code: "ABCDEF" }, kid)).status, 403);
  assert.equal((await api("display/refresh", {}, kid)).status, 403);
  assert.equal((await api("auth/codes", undefined, kid)).status, 403);
  assert.equal((await api("auth/codes", { personId: otherKidId, code: "0102" }, parent)).status, 409);
  assert.equal((await api("auth/codes", { personId: kidId, code: "111111" }, parent)).status, 400);
  assert.equal((await api("auth/codes", { personId: parentId, code: "1234" }, parent)).status, 400);
  assert.equal((await api("auth/codes", { code: "654321", confirmation: "654321" }, parent)).status, 200);
  assert.equal((await api("auth/login", { code: "543210" })).status, 401);
  assert.equal((await api("auth/login", { code: "654321", personId: parentId })).body.person.id, parentId);
  assert.equal((await api("auth/codes", { personId: kidId, code: "1203" }, parent)).status, 200);
  assert.equal((await api("auth/login", { code: "0102" })).status, 401);
  assert.equal((await api("auth/login", { code: "1203" })).body.person.id, kidId);
  assert.equal((await api("auth/codes", { personId: kidId, code: "" }, parent)).status, 200);
  assert.equal((await api("auth/login", { code: "1203" })).status, 401);
  assert.equal((await personFromSession(parent))?.id, parentId);
});

test("concurrent duplicate kid changes cannot both succeed", async () => {
  const parent = (await setup()).body.token;
  const results = await Promise.all([kidId, otherKidId].map((personId) => api("auth/codes", { personId, code: "0304" }, parent)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});

test("legacy PIN/bootstrap and phone pairing cannot grant sessions; display claims still approve", async () => {
  const parent = (await setup()).body.token;
  assert.equal((await api("pair/bootstrap", { personId: parentId, pin: "111111" })).status, 410);
  assert.equal((await api("auth/login", { personId: parentId, pin: "111111", familyToken: "anything" })).status, 401);
  assert.equal((await api("pair/claim", { deviceKind: "phone" })).status, 410);
  assert.equal((await api("pair/invite", {}, parent)).status, 410);
  const claim = (await api("pair/claim", { deviceKind: "display" })).body;
  assert.equal((await api("pair/approve", { code: claim.displayCode }, parent)).status, 200);
  const [approved] = await db.select().from(schema.pairingRequests).where(eq(schema.pairingRequests.id, claim.id));
  assert.equal(approved.status, "approved");
  assert.equal(approved.deviceKind, "display");
});
