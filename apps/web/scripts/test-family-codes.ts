import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { handleApi } from "../lib/api";
import { getDb, getPool, schema } from "../lib/db";
import { errorResponse } from "../lib/http";
import { hashPin, issuePersonSession, personFromSession, pairDisplay } from "../lib/auth";
import { asPerson } from "../lib/person";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.match(database.pathname, /^\/liendo_codes_test_\d+$/);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const db = getDb();
let parentId: string;
let otherParentId: string;
let kidId: string;
let otherKidId: string;
let parentToken: string;
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
    kids: [{ personId: kidId, code: "0102" }], ...overrides }, parentToken);
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
  parentToken = (await issuePersonSession(asPerson(people[0]), { kind: "phone", label: "Existing parent" })).token;
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
  assert.equal((await setup({ personId: kidId })).status, 403);
  assert.equal((await setup({ parents: [{ personId: otherParentId, code: "543210" }] })).status, 400);
  assert.equal((await setup({ parents: [{ personId: kidId, code: "654321" }] })).status, 400);
  assert.equal((await setup({ parents: [{ personId: parentId, code: "654321" }] })).status, 400);
  assert.equal((await setup({ kids: [{ personId: parentId, code: "0102" }] })).status, 400);
  assert.equal((await setup({ kids: [{ personId: kidId, code: "0102" }, { personId: otherKidId, code: "0102" }] })).status, 400);
  assert.equal((await db.select().from(schema.familyCodes)).length, 0);
});

test("setup and status require a live parent, bind identity and protect the roster for every role", async () => {
  const people = await db.select().from(schema.people);
  const roles = await Promise.all([parentId, otherParentId, kidId].map(async (id) => {
    const person = people.find((p) => p.id === id)!;
    return { person, token: (await issuePersonSession(asPerson(person), { kind: "phone", label: "Existing session" })).token };
  }));
  const display = await pairDisplay("Setup audit display", parentId);
  const callers: { headers: Record<string, string>; parent?: typeof people[number]; expected: number }[] = [
    { headers: {}, parent: undefined, expected: 401 },
    { headers: { "x-display-token": display }, parent: undefined, expected: 401 },
    ...roles.flatMap(({ person, token }) => ["authorization", "cookie"].map((name) => ({
      headers: { [name]: name === "cookie" ? `lp_session=${token}` : `Bearer ${token}` },
      parent: person.role === "parent" ? person : undefined, expected: person.role === "parent" ? 200 : 403,
    }))),
  ];
  for (const caller of callers) {
    await db.delete(schema.familyCodes);
    const send = async (path: string, body?: unknown) => {
      const response = await handleApi(new Request(`http://codes.test/api/${path}`, {
        method: body ? "POST" : "GET",
        headers: { ...caller.headers, "content-type": "application/json", "x-forwarded-for": randomUUID() },
        body: body ? JSON.stringify(body) : undefined,
      }));
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(response.headers.get("vary")!, /Authorization, Cookie/);
      return { status: response.status, body: await response.json() };
    };
    const status = await send("auth/codes/status");
    assert.equal(status.status, 200);
    if (caller.parent) {
      assert.equal(status.body.people.length, 4);
      assert.doesNotMatch(JSON.stringify(status.body), /pinHash|failedAttempts|lockedUntil/);
      const wrong = await send("auth/codes/setup", { personId: caller.parent.id === parentId ? otherParentId : parentId,
        code: "543210", confirmation: "543210" });
      assert.equal(wrong.status, 403);
    } else assert.deepEqual(status.body, { setupRequired: true });
    const result = await send("auth/codes/setup", { personId: caller.parent?.id ?? parentId, code: "543210", confirmation: "543210" });
    assert.equal(result.status, caller.expected);
    if (caller.parent) {
      assert.equal(result.body.person.id, caller.parent.id);
      assert.equal((await personFromSession(result.body.token))?.id, caller.parent.id);
      assert.equal((await send("auth/codes/setup", { personId: caller.parent.id, code: "543210", confirmation: "543210" })).status, 409);
    } else assert.equal((await db.select().from(schema.familyCodes)).length, 0);
    if (!caller.parent) await setup();
    const established = await send("auth/codes/status");
    assert.deepEqual(established.body, caller.parent ? { setupRequired: false, people: [] } : { setupRequired: false });
  }
});

test("revoked and expired parent sessions cannot obtain a setup roster or write codes", async () => {
  const parent = (await db.select().from(schema.people)).find((p) => p.id === parentId)!;
  for (const state of ["revoked", "expired"] as const) {
    const session = await issuePersonSession(asPerson(parent), { kind: "phone", label: state });
    if (state === "revoked") await api("auth/logout", {}, session.token);
    if (state === "expired") {
      await db.update(schema.sessions).set({ expiresAt: new Date(0) }).where(eq(schema.sessions.tokenHash, createHash("sha256").update(session.token).digest("hex")));
    }
    assert.deepEqual((await api("auth/codes/status", undefined, session.token)).body, { setupRequired: true });
    assert.equal((await api("auth/codes/setup", { personId: parentId, code: "543210", confirmation: "543210" }, session.token)).status, 401);
    assert.equal((await db.select().from(schema.familyCodes)).length, 0);
  }
});

test("setup is atomic under a race and stores only hashes; omitted kid codes remain unset", async () => {
  const results = await Promise.all([setup(), setup()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const rows = await db.select().from(schema.familyCodes);
  assert.equal(rows.length, 4);
  assert.ok(rows.filter((r) => !r.id.startsWith("household-")).every((r) => r.hash.startsWith("$2") && !["543210", "0102"].includes(r.hash)));
  assert.deepEqual(new Set((await api("auth/codes", undefined, results.find((r) => r.status === 200)!.body.token)).body.configuredPersonIds), new Set([parentId, kidId]));
  const result = results.find((r) => r.status === 200)!;
  assert.equal((await personFromSession(result.body.token))?.id, parentId);
  assert.equal((await api("auth/codes/status")).body.setupRequired, false);
  assert.deepEqual((await api("auth/codes/status")).body, { setupRequired: false });
  assert.equal((await api("auth/login", { code: "1234" })).status, 401);
});

test("each parent and kid code directly issues only its owner's device-backed session", async () => {
  await setup({ parents: [{ personId: otherParentId, code: "654321" }] });
  const first = await api("auth/login", { code: "543210" });
  assert.equal(first.status, 200);
  assert.equal(first.body.person.id, parentId);
  assert.ok(first.body.token);
  const parent = await api("auth/login", { code: "654321", deviceKind: "phone" });
  assert.equal(parent.body.person.id, otherParentId);
  const kid = await api("auth/login", { code: "0102", deviceKind: "phone" });
  assert.equal(kid.body.person.id, kidId);
  assert.equal((await personFromSession(kid.body.token))?.id, kidId);
  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.personId, kidId));
  const [device] = await db.select().from(schema.devices).where(eq(schema.devices.id, session.deviceId!));
  assert.equal(device.kind, "phone");
  assert.equal(device.sessionId, session.id);
  assert.equal((await api("auth/login", { code: "0102", personId: parentId })).body.person.id, kidId);
  assert.equal((await api("auth/login", { code: "543210", personId: otherParentId })).body.person.id, parentId);
});

test("a legacy-locked parent cannot sign in but does not block another parent or kid", async () => {
  await setup({ parents: [{ personId: otherParentId, code: "654321" }] });
  await db.update(schema.people).set({ pinLockedUntil: new Date(Date.now() + 60_000) }).where(eq(schema.people.id, otherParentId));
  assert.equal((await api("auth/login", { code: "654321" })).status, 423);
  const parent = await api("auth/login", { code: "543210" });
  assert.equal(parent.status, 200);
  assert.equal(parent.body.person.id, parentId);
  assert.equal((await api("auth/login", { code: "0102" })).status, 200);
});

test("a sole parent signs in directly", async () => {
  await setup();
  await db.update(schema.people).set({ role: "kid" }).where(eq(schema.people.id, otherParentId));
  try {
    assert.equal((await api("auth/login", { code: "543210" })).body.person.id, parentId);
    await db.update(schema.people).set({ pinLockedUntil: new Date(Date.now() + 60_000) }).where(eq(schema.people.id, parentId));
    assert.equal((await api("auth/login", { code: "543210" })).status, 423);
  }
  finally { await db.update(schema.people).set({ role: "parent" }).where(eq(schema.people.id, otherParentId)); }
});

for (const kind of ["kids", "parents"] as const) {
  test(`${kind} lock after ten failures across IPs without blocking or resetting the other type`, async () => {
    await setup({ parents: [{ personId: otherParentId, code: "654321" }], kids: [{ personId: kidId, code: "0102" }, { personId: otherKidId, code: "0304" }] });
    const ownId = `household-${kind}`;
    const otherId = kind === "kids" ? "household-parents" : "household-kids";
    const wrongCode = kind === "kids" ? "9999" : "999999";
    const ownCode = kind === "kids" ? "0102" : "543210";
    const ownPerson = kind === "kids" ? kidId : parentId;
    for (let i = 0; i < 9; i++) {
      const wrong = await api("auth/login", { code: wrongCode });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.error, "That code is not recognized.");
    }
    const before = Date.now();
    const locked = await api("auth/login", { code: wrongCode });
    assert.equal(locked.status, 423);
    assert.equal(locked.body.error, "Too many tries. Try again in 5 minutes.");
    const [row] = await db.select().from(schema.familyCodes).where(eq(schema.familyCodes.id, ownId));
    assert.equal(row.failedAttempts, 10);
    assert.ok(row.lockedUntil && row.lockedUntil.getTime() >= before + 5 * 60_000 && row.lockedUntil.getTime() <= Date.now() + 5 * 60_000);
    for (const code of kind === "kids" ? ["543210", "654321"] : ["0102", "0304"]) {
      assert.equal((await api("auth/login", { code })).status, 200);
    }
    assert.equal((await api("auth/login", { code: ownCode })).status, 423);
    const [unchanged] = await db.select().from(schema.familyCodes).where(eq(schema.familyCodes.id, ownId));
    assert.equal(unchanged.failedAttempts, 10);
    assert.equal(unchanged.lockedUntil?.getTime(), row.lockedUntil?.getTime());
    await db.update(schema.familyCodes).set({ failedAttempts: 3 }).where(eq(schema.familyCodes.id, otherId));
    await db.update(schema.familyCodes).set({ lockedUntil: new Date(Date.now() - 1) }).where(eq(schema.familyCodes.id, ownId));
    assert.equal((await api("auth/login", { code: ownCode })).status, 200);
    const [reset] = await db.select().from(schema.familyCodes).where(eq(schema.familyCodes.id, ownId));
    assert.equal(reset.failedAttempts, 0);
    assert.equal(reset.lockedUntil, null);
    const [other] = await db.select().from(schema.familyCodes).where(eq(schema.familyCodes.id, otherId));
    assert.equal(other.failedAttempts, 3);
    await db.update(schema.familyCodes).set({ failedAttempts: 2 }).where(eq(schema.familyCodes.id, ownId));
    await db.update(schema.people).set({ pinLockedUntil: new Date(Date.now() + 60_000) }).where(eq(schema.people.id, ownPerson));
    assert.equal((await api("auth/login", { code: ownCode })).status, 423);
    const [legacyLocked] = await db.select().from(schema.familyCodes).where(eq(schema.familyCodes.id, ownId));
    assert.equal(legacyLocked.failedAttempts, 2);
  });
}

test("malformed codes are generic and do not increment either type; empty setup cannot sign in", async () => {
  assert.equal((await api("auth/login", { code: "0102" })).status, 401);
  assert.equal((await db.select().from(schema.familyCodes)).length, 0);
  await setup();
  for (const code of ["", "12345", "nonsense", "1".repeat(73)]) {
    const wrong = await api("auth/login", { code });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, "That code is not recognized.");
  }
  const rows = await db.select().from(schema.familyCodes);
  assert.ok(rows.every((row) => row.failedAttempts === 0 && row.lockedUntil === null));
});

test("existing installations lazily initialize separate counters and ignore the old combined lockout", async () => {
  const parent = (await setup()).body.token;
  for (const id of ["household-kids", "household-parents"]) await db.delete(schema.familyCodes).where(eq(schema.familyCodes.id, id));
  await db.insert(schema.familyCodes).values({ id: "household", hash: "", failedAttempts: 10, lockedUntil: new Date(Date.now() + 60_000) });
  assert.equal((await api("auth/login", { code: "9999" })).status, 401);
  assert.equal((await api("auth/login", { code: "543210" })).status, 200);
  const rows = await db.select().from(schema.familyCodes);
  assert.equal(rows.find((r) => r.id === "household-kids")?.failedAttempts, 1);
  assert.equal(rows.find((r) => r.id === "household-parents")?.failedAttempts, 0);
  assert.deepEqual(new Set((await api("auth/codes", undefined, parent)).body.configuredPersonIds), new Set([parentId, kidId]));
});

test("login and setup enforce per-IP rate limits", async () => {
  await setup();
  const ip = randomUUID();
  for (let i = 0; i < 20; i++) assert.equal((await api("auth/login", { code: "543210" }, undefined, ip)).status, 200);
  assert.equal((await api("auth/login", { code: "543210" }, undefined, ip)).status, 429);
  const setupIp = randomUUID();
  for (let i = 0; i < 10; i++) assert.equal((await api("auth/codes/setup", { personId: parentId }, parentToken, setupIp)).status, 400);
  assert.equal((await api("auth/codes/setup", { personId: parentId }, parentToken, setupIp)).status, 429);
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
  assert.equal((await api("auth/codes", { personId: parentId, code: "654321", confirmation: "654321" }, parent)).status, 200);
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

test("parents manage each other's codes but cannot clear the final parent or reopen setup", async () => {
  const parent = (await setup()).body.token;
  assert.equal((await api("auth/codes", { personId: otherParentId, code: "543210", confirmation: "543210" }, parent)).status, 409);
  assert.equal((await api("auth/codes", { personId: otherParentId, code: "654321", confirmation: "bad" }, parent)).status, 400);
  assert.equal((await api("auth/codes", { personId: otherParentId, code: "654321", confirmation: "654321" }, parent)).status, 200);
  const other = (await api("auth/login", { code: "654321" })).body.token;
  assert.equal((await api("auth/codes", { personId: parentId, code: "987654", confirmation: "987654" }, other)).status, 200);
  assert.equal((await api("auth/codes", { personId: parentId, code: "" }, other)).status, 200);
  assert.equal((await api("auth/login", { code: "987654" })).status, 401);
  assert.equal((await api("auth/codes/status")).body.setupRequired, false);
  const blocked = await api("auth/codes", { personId: otherParentId, code: "" }, other);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "Keep at least one parent code. Set a new code instead.");
  assert.equal((await api("auth/codes/status")).body.setupRequired, false);
  assert.equal((await setup()).status, 409);
  assert.equal((await api("auth/login", { code: "654321" })).body.person.id, otherParentId);
  assert.equal((await api("auth/codes", { personId: kidId, code: "0304" }, other)).status, 200);
});

test("concurrent parent clears keep at least one parent code", async () => {
  const parent = (await setup({ parents: [{ personId: otherParentId, code: "654321" }] })).body.token;
  const results = await Promise.all([parentId, otherParentId].map((personId) => api("auth/codes", { personId, code: "" }, parent)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const settings = (await api("auth/codes", undefined, parent)).body;
  assert.equal(settings.configuredPersonIds.filter((id: string) => [parentId, otherParentId].includes(id)).length, 1);
  assert.equal((await api("auth/codes/status")).body.setupRequired, false);
});

test("setup rejects a code already held by a different kid without writing partial state", async () => {
  const hash = await hashPin("0102");
  await db.insert(schema.familyCodes).values({ id: otherKidId, hash });
  assert.equal((await api("auth/codes/status")).body.setupRequired, true);
  assert.equal((await setup()).status, 409);
  assert.deepEqual(await db.select().from(schema.familyCodes), [{ id: otherKidId, hash, failedAttempts: 0, lockedUntil: null }]);
  assert.equal((await setup({ kids: [{ personId: kidId, code: "0304" }] })).status, 200);
  assert.equal((await api("auth/login", { code: "0102" })).body.person.id, otherKidId);
  assert.equal((await api("auth/login", { code: "0304" })).body.person.id, kidId);
});

test("concurrent duplicate parent changes cannot both succeed or reset household failures", async () => {
  const parent = (await setup()).body.token;
  await api("auth/login", { code: "9999" });
  const results = await Promise.all([parentId, otherParentId].map((personId) => api("auth/codes", { personId, code: "987654", confirmation: "987654" }, parent)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const [household] = await db.select().from(schema.familyCodes).where(eq(schema.familyCodes.id, "household-kids"));
  assert.equal(household.failedAttempts, 1);
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
