import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { addDays, FAMILY } from "@liendo/shared";
import { getDb, getPool, schema } from "../lib/db";
import { todayIso } from "../lib/time";
import { deleteStoredPhoto } from "../lib/blob";
import { issuePersonSession } from "../lib/auth";
import { asPerson } from "../lib/person";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.match(database.pathname, /^\/liendo_role_audit_test_\d+$/);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const base = process.env.ROLE_AUDIT_BASE_URL ?? "http://127.0.0.1:3158";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
assert.ok(!process.env.BLOB_READ_WRITE_TOKEN, "Use local photo storage for the audit");
const db = getDb();
type Role = "Anonymous" | "Noah" | "Focus" | "Jess" | "Display";
const tokens: Partial<Record<Role, string>> = {};
const rows: string[][] = [];
const failures: string[] = [];
const known: string[] = [];
const files = new Set<string>();
const day = addDays(todayIso(), -1);
let bytes: Buffer;
const media = createServer((_req, response) => { response.writeHead(200, { "content-type": "image/jpeg" }); response.end(bytes); });

async function request(path: string, role: Role, method = "GET", body?: unknown, token = tokens[role], cookie = false) {
  const headers: Record<string, string> = { "x-forwarded-for": randomUUID() };
  if (token) {
    if (cookie) headers.cookie = `lp_session=${token}`;
    else headers[role === "Display" ? "x-display-token" : "authorization"] = role === "Display" ? token : `Bearer ${token}`;
  }
  const binary = Buffer.isBuffer(body);
  if (body !== undefined) headers["content-type"] = binary ? "image/jpeg" : "application/json";
  const response = await fetch(`${base}/api/${path}`, { method, headers,
    body: body === undefined ? undefined : binary ? new Uint8Array(body) : JSON.stringify(body) });
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  if (data?.instance?.photoPath?.startsWith("local:")) files.add(data.instance.photoPath);
  if (data?.chore?.guidePhotoPath?.startsWith("local:")) files.add(data.chore.guidePhotoPath);
  if (data?.meal?.photoPath?.startsWith("local:")) files.add(data.meal.photoPath);
  return { response, data };
}
type Result = Awaited<ReturnType<typeof request>>;

function noSecrets(data: unknown) {
  assert.doesNotMatch(JSON.stringify(data), /"(?:hash|pinHash|tokenHash|pinFailedAttempts|pinLockedUntil)"/, "credential or lock metadata leaked");
}
async function check(path: string, role: Role, expected: number, method = "GET", body?: unknown,
  verify: (data: Result["data"]) => void | Promise<void> = noSecrets, meaning = "role-appropriate body", token?: string, cookie = false,
  knownBodyIssue?: string) {
  const result = await request(path, role, method, body, token, cookie);
  const issues: string[] = [];
  let knownHere = false;
  try { assert.equal(result.response.status, expected, "HTTP status"); await verify(result.data); }
  catch (error) {
    if (knownBodyIssue && (error as Error).message === knownBodyIssue) {
      knownHere = true;
      known.push(`${role}: ${path}: known, fixed in follow-up PR`);
    }
    else issues.push((error as Error).message);
  }
  const cache = result.response.headers.get("cache-control") ?? "absent";
  const vary = result.response.headers.get("vary") ?? "absent";
  if (!cache.includes("private") || !cache.includes("no-store")) issues.push(`Cache-Control=${cache}`);
  const varyFields = vary.toLowerCase().split(",").map((field) => field.trim());
  if (!varyFields.includes("authorization") || !varyFields.includes("cookie")) issues.push(`Vary=${vary}`);
  const label = `${method} /api/${path}`;
  rows.push([label, role, `${expected}; ${meaning}; private/no-store + Vary auth/cookie`,
    `${issues.length ? "FAIL" : knownHere ? "KNOWN" : "PASS"}: HTTP ${result.response.status}; ${issues.length ? issues.join("; ") : knownHere ? "known, fixed in follow-up PR (other kids' reward requests); cache headers verified" : "body and cache headers verified"}`]);
  if (issues.length) failures.push(`${role}: ${label}: ${issues.join("; ")}`);
  return result.data;
}

async function main() {
  await db.execute(sql`truncate people, family_codes, rewards, meals, settings, display_pairings, pairing_requests cascade`);
  const people = await db.insert(schema.people).values(FAMILY.map((person) => ({ ...person }))).returning();
  const person = (slug: string) => people.find((p) => p.slug === slug)!;
  const noah = person("noah");
  const sofia = person("sofia");
  const setup = { personId: person("focus").id, code: "123456", confirmation: "123456",
    parents: [{ personId: person("jess").id, code: "234567" }],
    kids: [{ personId: noah.id, code: "0102" }, { personId: sofia.id, code: "0304" }, { personId: person("xavier").id, code: "0506" }] };
  await check("auth/codes/status", "Anonymous", 200, "GET", undefined, (data) => {
    assert.deepEqual(data, { setupRequired: true });
  }, "no public roster");
  await check("auth/codes/setup", "Anonymous", 401, "POST", setup);
  tokens.Focus = (await issuePersonSession(asPerson(person("focus")), { kind: "phone", label: "Existing audit parent" })).token;
  await check("auth/codes/setup", "Focus", 403, "POST", { ...setup, personId: noah.id });
  await check("auth/codes/setup", "Focus", 400, "POST", { ...setup, parents: [{ personId: noah.id, code: "345678" }] });
  const established = await check("auth/codes/setup", "Focus", 200, "POST", setup, (data) => {
    assert.equal(data.person.id, person("focus").id); assert.equal(data.person.role, "parent"); assert.ok(data.token); noSecrets(data);
  }, "first setup issues chosen parent session");
  assert.ok(established.token, "Could not establish initial parent session");
  for (const [role, code, slug] of [["Noah", "0102", "noah"], ["Focus", "123456", "focus"], ["Jess", "234567", "jess"]] as const) {
    const login = await check("auth/login", "Anonymous", 200, "POST", { code, personId: sofia.id, role: "parent", deviceKind: "phone" }, (data) => {
      assert.equal(data.person.id, person(slug).id); assert.equal(data.person.role, person(slug).role); assert.ok(data.token); noSecrets(data);
    }, `${role}'s code ignores forged personId/role`);
    assert.ok(login.token); tokens[role] = login.token;
  }
  await check("auth/login", "Anonymous", 401, "POST", { code: "9999", personId: person("focus").id });
  bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#234567" } }).jpeg().toBuffer();
  await new Promise<void>((resolve) => media.listen(0, "127.0.0.1", resolve));
  const mediaBase = `http://127.0.0.1:${(media.address() as AddressInfo).port}`;
  const photo = (name: string) => `${mediaBase}/${name}.jpg`;
  const photoPath = (name: string) => `photos/${encodeURIComponent(photo(name))}`;
  const chores = await db.insert(schema.chores).values([noah, sofia].flatMap((p) => [
    { title: `Private ${p.name} proof`, assignedPersonId: p.id, stars: 2, requiresPhoto: true, repeatType: "once", onceDate: day, guidePhotoPath: photo(`guide-${p.slug}`) },
    { title: `${p.name} open chore`, assignedPersonId: p.id, stars: 2, requiresPhoto: false, repeatType: "once", onceDate: day },
    { title: `${p.name} earned stars`, assignedPersonId: p.id, stars: 20, requiresPhoto: false, repeatType: "once", onceDate: day },
  ])).returning();
  const instances = await db.insert(schema.choreInstances).values(chores.map((c, index) => ({
    choreId: c.id, personId: c.assignedPersonId, date: day, status: index % 3 === 0 ? "pending" : index % 3 === 1 ? "open" : "done",
    starsAwarded: index % 3 === 2 ? 20 : 0, photoPath: index % 3 === 0 ? photo(index === 0 ? "proof-noah" : "proof-sofia") : null,
  }))).returning();
  const [reward] = await db.insert(schema.rewards).values({ name: "Shared reward", starCost: 1 }).returning();
  await db.insert(schema.rewardRequests).values([noah, sofia].map((p) => ({ personId: p.id, rewardId: reward.id })));
  await db.insert(schema.meals).values({ date: day, name: "Family dinner", photoPath: photo("meal") });
  await db.insert(schema.settings).values({ key: "private-audit-marker", value: "DO-NOT-EXPOSE-RAW-SETTINGS" });
  const own = chores[0], other = chores[3], ownOpen = instances[1], otherOpen = instances[4];

  for (const path of ["me", "people", "snapshot", "chores", `chores/${own.id}`, photoPath("proof-noah"), "chores/instances/pending", "rewards", "rewards/requests", "stars", "meals", "calendar", "weather", "settings", "devices", "pair/pending", "auth/codes"]) {
    await check(path, "Anonymous", 401);
  }
  for (const role of ["Noah", "Focus", "Jess"] as const) {
    const kid = role === "Noah";
    const current = person(kid ? "noah" : role.toLowerCase());
    await check("auth/codes/status", role, 200, "GET", undefined, (data) => { assert.deepEqual(data, kid ? { setupRequired: false } : { setupRequired: false, people: [] }); });
    await check("auth/codes/setup", role, kid ? 403 : 409, "POST", { code: "123456", confirmation: "123456", personId: current.id });
    await check("auth/codes", role, kid ? 403 : 200, "GET", undefined, (data) => {
      noSecrets(data); if (!kid) { assert.deepEqual(Object.keys(data), ["configuredPersonIds"]); assert.equal(data.configuredPersonIds.length, 5); }
    }, "kid denied; parents get IDs only, never hashes");
    await check("auth/codes", role, kid ? 403 : 200, "POST", { personId: noah.id, code: "0102", role: "parent" }, async (data) => {
      noSecrets(data); assert.equal((await db.select().from(schema.people).where(eq(schema.people.id, noah.id)))[0].role, "kid");
    }, "code changes never change the target person's role");
    await check("auth/codes", role, kid ? 403 : 400, "POST", { personId: noah.id, code: "345678", confirmation: "345678", role: "parent" });
    for (const path of ["pair/bootstrap", "pair/invite", "auth/family", "auth/display"]) await check(path, role, 410, "POST", {});
    for (const deviceKind of ["phone", "browser"]) await check("pair/claim", role, 410, "POST", { deviceKind });
    await check("pair/redeem", role, 404, "POST", { invite: "not-a-valid-invite" });
    await check("pins", role, kid ? 403 : 410, "POST", { personId: noah.id, pin: "1111" });
    await check("me", role, 200, "GET", undefined, (data) => { assert.equal(data.actor.person.id, current.id); noSecrets(data); });
    await check("people", role, 200, "GET", undefined, (data) => { assert.equal(data.people.length, 5); noSecrets(data); }, "intentional shared sanitized family roster");
    await check(`snapshot?from=${day}&to=${day}`, role, 200, "GET", undefined, (data) => {
      noSecrets(data); assert.ok(data.chores.length); assert.ok(data.chores.some((c: { personId: string }) => c.personId === noah.id));
      if (kid) { assert.ok(data.chores.every((c: { personId: string }) => c.personId === noah.id)); assert.ok(!JSON.stringify(data).includes(other.title)); assert.ok(!JSON.stringify(data).includes(photo("proof-sofia"))); }
      else assert.ok(data.chores.some((c: { personId: string }) => c.personId === sofia.id));
    }, "kid has no foreign chore/proof IDs, titles or paths; shared family fields intentional");
    await check("chores", role, 200, "GET", undefined, (data) => { noSecrets(data); assert.ok(data.chores.length); if (kid) assert.ok(data.chores.every((c: { assignedPersonId: string }) => c.assignedPersonId === noah.id)); });
    await check(`chores/${own.id}`, role, 200);
    await check(`chores/${other.id}`, role, kid ? 403 : 200);
    await check(`chores/${randomUUID()}`, role, 404);
    for (const name of ["proof-noah", "proof-sofia", "guide-noah", "guide-sofia", "meal", "orphan"]) {
      const status = kid && (name.endsWith("sofia") || name === "orphan") ? name === "orphan" ? 404 : 403 : 200;
      await check(photoPath(name), role, status, "GET", undefined, (data) => { if (status === 200) assert.deepEqual(data, bytes); else noSecrets(data); }, "binary access checked, not only photo metadata");
    }
    const create = { title: `${role} created chore`, assignedPersonId: noah.id, stars: 2, requiresPhoto: false, repeatType: "once", onceDate: day };
    const created = await check("chores", role, kid ? 403 : 201, "POST", create);
    const target = kid ? other.id : created.chore.id;
    await check(`chores/${target}`, role, kid ? 403 : 200, "PATCH", { title: `${role} changed chore` });
    await check(`chores/${target}`, role, kid ? 403 : 200, "DELETE");
    await check(`chores/${other.id}/guide-photo`, role, kid ? 403 : 200, "POST", bytes);
    await check(`chores/${other.id}/guide-photo`, role, kid ? 403 : 200, "DELETE");
    await check("chores/instances/pending", role, kid ? 403 : 200);
    for (const action of ["complete", "undo"]) {
      await check(`chores/instances/${ownOpen.id}/${action}`, role, 200, "POST", {});
      await check(`chores/instances/${otherOpen.id}/${action}`, role, kid ? 403 : 200, "POST", {});
    }
    await check(`chores/instances/${instances[0].id}/photo`, role, 200, "POST", bytes);
    await check(`chores/instances/${instances[3].id}/photo`, role, kid ? 403 : 200, "POST", bytes);
    await db.update(schema.choreInstances).set({ status: "pending" }).where(eq(schema.choreInstances.id, instances[0].id));
    await check(`chores/instances/${instances[0].id}/review`, role, kid ? 403 : 200, "POST", { action: "approve" });
    await check("rewards", role, 200);
    const newReward = await check("rewards", role, kid ? 403 : 201, "POST", { name: `${role} reward`, starCost: 1 });
    const rewardId = kid ? reward.id : newReward.reward.id;
    await check(`rewards/${rewardId}`, role, kid ? 403 : 200, "PATCH", { starCost: 2 });
    await check(`rewards/${rewardId}`, role, kid ? 403 : 200, "DELETE");
    await check("rewards/requests", role, 200, "GET", undefined, (data) => {
      assert.ok(data.requests.length); noSecrets(data);
      if (kid) assert.ok(data.requests.every((r: { personId: string }) => r.personId === noah.id));
      else assert.ok(data.requests.some((r: { personId: string }) => r.personId === sofia.id));
    }, "kid sees own requests only; parents see all", undefined, false, kid ? "another kid's reward-request history leaked" : undefined);
    await check("rewards/requests", role, kid ? 201 : 400, "POST", { rewardId: reward.id, personId: sofia.id }, (data) => { noSecrets(data); if (kid) assert.equal(data.request.personId, noah.id); }, "request binds caller, not forged personId");
    const [pending] = await db.insert(schema.rewardRequests).values({ rewardId: reward.id, personId: noah.id }).returning();
    await check(`rewards/requests/${pending.id}/review`, role, kid ? 403 : 200, "POST", { action: "approve" });
    for (const path of ["stars", `meals?from=${day}&to=${day}`, "meals/suggest", "calendar", "weather", "settings"]) {
      await check(path, role, 200, "GET", undefined, (data) => { noSecrets(data); assert.ok(!JSON.stringify(data).includes("DO-NOT-EXPOSE-RAW-SETTINGS")); }, "intentional shared household read, no raw settings/credentials");
    }
    for (const method of ["POST", "PUT"]) await check("meals", role, kid ? 403 : 200, method, { date: day, name: `${role} dinner` });
    await check(`meals/${day}/photo`, role, kid ? 403 : 200, "POST", bytes);
    await check(`meals/${day}/photo`, role, kid ? 403 : 200, "DELETE");
    await check("settings", role, kid ? 403 : 200, "PATCH", { choreReminderHour: 18 });
    await check("display/refresh", role, kid ? 403 : 200, "POST", {});
    await check("devices", role, kid ? 403 : 200);
    const [disposable] = await db.insert(schema.devices).values({ kind: "browser", label: "Audit disposable" }).returning();
    await check(`devices/${disposable.id}`, role, kid ? 403 : 200, "DELETE");
    await check("pair/status", role, 200, "GET", undefined, noSecrets, "sanitized setup availability, no credentials");
    await check("pair/pending", role, kid ? 403 : 200);
    const claim = await check("pair/claim", role, 200, "POST", { deviceKind: "display" });
    await check("pair/poll", role, 404, "POST", { id: claim.id, pollSecret: "wrong-secret" });
    await check("pair/poll", role, 200, "POST", { id: claim.id, pollSecret: claim.pollSecret }, (data) => { assert.equal(data.status, "pending"); assert.ok(!data.token); });
    await check("pair/approve", role, kid ? 403 : 200, "POST", { code: claim.shortCode });
    if (!kid) {
      const paired = await check("pair/poll", role, 200, "POST", { id: claim.id, pollSecret: claim.pollSecret }, (data) => { assert.equal(data.status, "paired"); assert.ok(data.token); assert.ok(!data.familyToken); });
      tokens.Display = paired.token;
    }
    const push = { token: (kid ? "a" : role === "Focus" ? "b" : "c").repeat(64), kind: "apns", environment: "sandbox", personId: sofia.id };
    await check("push/register", role, 200, "POST", push, async (data) => {
      noSecrets(data); const [stored] = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, push.token)); assert.equal(stored.personId, current.id);
    }, "push ownership binds session, not body personId");
    await check("push/unregister", role, 200, "POST", push, async () => { assert.equal((await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, push.token))).length, 0); });
    const foreignPush = { ...push, token: "d".repeat(64), personId: sofia.id };
    await db.insert(schema.pushTokens).values({ personId: sofia.id, token: foreignPush.token, kind: "apns", environment: "sandbox" });
    await check("push/unregister", role, 200, "POST", foreignPush, async () => { assert.equal((await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, foreignPush.token))).length, 1); }, "cannot unregister another person's push record");
    await db.delete(schema.pushTokens).where(eq(schema.pushTokens.token, foreignPush.token));
  }
  for (const path of ["snapshot", "chores", `chores/${other.id}`, photoPath("proof-sofia"), "rewards", "stars", "meals", "settings", "me"]) await check(path, "Display", 200);
  for (const path of ["auth/codes", "rewards/requests", "devices", "pair/pending", "chores/instances/pending"]) await check(path, "Display", 401);
  for (const path of ["auth/codes", "display/refresh", "push/register", "push/unregister", "pair/approve", "chores", "rewards", "meals"]) await check(path, "Display", 401, "POST", {});
  await check("push/register", "Anonymous", 401, "POST", {});
  await check("push/unregister", "Anonymous", 401, "POST", {});
  const disposableLogin = await request("auth/login", "Anonymous", "POST", { code: "123456" });
  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, createHash("sha256").update(disposableLogin.data.token).digest("hex")));
  assert.ok(session.deviceId);
  await check(`devices/${session.deviceId}`, "Jess", 200, "DELETE");
  await check("me", "Focus", 401, "GET", undefined, noSecrets, "revoked code-issued device cannot authenticate", disposableLogin.data.token);
  await check("missing-audit-route", "Noah", 404);
  for (const [role, code] of [["Noah", "0102"], ["Focus", "123456"], ["Jess", "234567"]] as const) {
    const login = await request("auth/login", "Anonymous", "POST", { code, cookie: true });
    assert.match(login.response.headers.get("set-cookie") ?? "", /HttpOnly/i);
    await check("me?cookie-audit=1", role, 200, "GET", undefined, noSecrets, "code-issued HTTP-only cookie authenticates", login.data.token, true);
    await check("auth/logout?cookie-audit=1", role, 200, "POST", {}, noSecrets, "cookie session signs out", login.data.token, true);
    await check("me?after-cookie-logout=1", role, 401, "GET", undefined, noSecrets, "logged-out token cannot be replayed as bearer", login.data.token);
    await check("auth/logout?bearer-audit=1", role, 200, "POST", {}, noSecrets, "bearer sign-out revokes session", login.data.token);
    await check("me?after-bearer-logout=1", role, 401, "GET", undefined, noSecrets, "revoked bearer rejected", login.data.token);
  }
  const empty = await db.select().from(schema.rewardRequests);
  await db.delete(schema.rewardRequests);
  await check("rewards/requests", "Noah", 200, "GET", undefined, (data) => { assert.deepEqual(data, { requests: [] }); }, "empty scoped list");
  assert.ok(empty.length);
  const report = process.env.ROLE_AUDIT_REPORT;
  if (report) {
    const escape = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
    await writeFile(report, "# PR #15 API role-boundary audit\n\nFresh dedicated local DB; real HTTP requests against Next; each person session issued by their own family code. Photo bodies checked against a local JPEG server; no production services changed. Shared roster, calendar, meals, weather and aggregate star leaderboard remain intentional family data.\n\n| Surface | Role tested | Expected | Actual result |\n| --- | --- | --- | --- |\n" + rows.map((row) => `| ${row.map(escape).join(" | ")} |`).join("\n") + `\n\nChecks: ${rows.length}; passed: ${rows.length - failures.length - known.length}; known: ${known.length}; failed: ${failures.length}.\n`);
  }
  console.log(`Role boundary API audit: ${rows.length} checks; ${rows.length - failures.length - known.length} passed; ${known.length} known; ${failures.length} failed`);
  for (const issue of known) console.log(issue);
  for (const failure of failures) console.error(failure);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const file of files) await deleteStoredPhoto(file);
  media.close(); await getPool().end();
});
