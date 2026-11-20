import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { EventEmitter } from "node:events";
import http2 from "node:http2";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";
import { eq } from "drizzle-orm";
import { apnsConfig, apnsJWT, sendAPNs } from "../lib/apns";
import { handleApi } from "../lib/api";
import { getDb, getPool, schema } from "../lib/db";
import { errorResponse } from "../lib/http";
import { notifyParents, notifyPerson, registerPushToken, sendPush, tokensFor } from "../lib/push";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.match(database.pathname, /^\/liendo_push_test_\d+$/);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const db = getDb();
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const key = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const variables = ["APNS_KEY_P8", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID"] as const;
const original = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
const config = { key, keyId: "TESTKEY", teamId: "TESTTEAM", bundleId: "test.family" };
const native = { token: "ab".repeat(32), kind: "apns", environment: "sandbox" } as const;
let parentId: string;
let kidId: string;
const sessions = { parent: randomUUID(), kid: randomUUID() };
const requests: { origin: string; headers: http2.OutgoingHttpHeaders; payload: string; closed: boolean }[] = [];
let response = { status: 200, reason: "" };
let transportFailure = false;
let expoBodies: unknown[] = [];

before(async () => {
  const [parent, kid] = await db.insert(schema.people).values([
    { slug: "push-parent", name: "Parent", role: "parent", color: "#123456" },
    { slug: "push-kid", name: "Kid", role: "kid", color: "#123456" },
  ]).returning();
  parentId = parent.id;
  kidId = kid.id;
  for (const [personId, token] of [[parentId, sessions.parent], [kidId, sessions.kid]]) {
    await db.insert(schema.sessions).values({
      personId, tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
  }
});

beforeEach(async () => {
  await db.delete(schema.pushTokens);
  process.env.APNS_KEY_P8 = key;
  process.env.APNS_KEY_ID = config.keyId;
  process.env.APNS_TEAM_ID = config.teamId;
  process.env.APNS_BUNDLE_ID = config.bundleId;
  requests.length = 0;
  expoBodies = [];
  response = { status: 200, reason: "" };
  transportFailure = false;
  mock.method(http2, "connect", (origin: string) => {
    const client = new EventEmitter();
    const record = { origin, headers: {}, payload: "", closed: false };
    requests.push(record);
    Object.assign(client, {
      close() { record.closed = true; },
      destroy() { record.closed = true; },
      request(headers: http2.OutgoingHttpHeaders) {
        record.headers = headers;
        const stream = new EventEmitter();
        Object.assign(stream, {
          setEncoding() {},
          end(payload: string) {
            record.payload = payload;
            queueMicrotask(() => {
              if (transportFailure) { stream.emit("error", new Error("Test network error")); return; }
              stream.emit("response", { ":status": response.status });
              if (response.reason) stream.emit("data", JSON.stringify({ reason: response.reason }));
              stream.emit("end");
            });
          },
        });
        return stream;
      },
    });
    return client;
  });
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://exp.host/--/api/v2/push/send");
    expoBodies.push(JSON.parse(init.body as string));
    return new Response("{}");
  });
});

afterEach(() => { mock.restoreAll(); });
after(async () => {
  for (const name of variables) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
  await getPool().end();
});

async function api(body: unknown, token?: string, action = "register") {
  try {
    return await handleApi(new Request(`http://push.test/api/push/${action}`, {
      method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }));
  } catch (error) { return errorResponse(error); }
}

test("ES256 JWT verifies with generated P-256 key; caches 50 minutes and rotates", () => {
  const jwt = apnsJWT(config, 10000);
  const [header, claims, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "ES256", kid: "TESTKEY" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), { iss: "TESTTEAM", iat: 10000 });
  assert.equal(Buffer.from(signature, "base64url").length, 64);
  assert.ok(verify("sha256", Buffer.from(`${header}.${claims}`),
    { key: keys.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
  assert.equal(apnsJWT(config, 12999), jwt);
  assert.notEqual(apnsJWT(config, 13000), jwt);
  assert.notEqual(apnsJWT({ ...config, keyId: "ROTATED" }, 13000), jwt);
  const otherKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const rotated = { ...config, key: otherKey.privateKey.export({ format: "pem", type: "pkcs8" }).toString() };
  assert.notEqual(apnsJWT(rotated, 13000), jwt);
  assert.equal(apnsConfig()?.key, key);
  process.env.APNS_KEY_P8 = key.replace(/\n/g, "\\n");
  assert.equal(apnsConfig()?.key, key);
});

test("APNs uses HTTP/2 endpoints, JWT headers and alert payload, closing connections", async () => {
  for (const environment of ["sandbox", "production"] as const) {
    assert.equal((await sendAPNs(native.token, environment, {
      title: "Photo waiting", body: "Review a chore", sound: "default", data: { choreId: "123", aps: "cannot override" },
    }, config)).status, 200);
  }
  assert.deepEqual(requests.map((request) => request.origin), [
    "https://api.sandbox.push.apple.com", "https://api.push.apple.com",
  ]);
  for (const request of requests) {
    assert.deepEqual(request.headers, {
      ":method": "POST", ":path": `/3/device/${native.token}`,
      authorization: `bearer ${apnsJWT(config)}`, "apns-topic": config.bundleId,
      "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json",
    });
    assert.deepEqual(JSON.parse(request.payload), {
      choreId: "123", aps: { alert: { title: "Photo waiting", body: "Review a chore" }, sound: "default" },
    });
    assert.ok(request.closed);
  }
});

test("mixed dispatch keeps legacy Expo payloads and routes APNs separately; empty is a no-op", async () => {
  await sendPush([]);
  assert.equal(requests.length, 0);
  assert.equal(expoBodies.length, 0);
  await sendPush([
    { to: "ExponentPushToken[old]", title: "Expo", body: "Existing" },
    { to: native.token, kind: "apns", environment: "sandbox", title: "Native", body: "New" },
  ]);
  assert.deepEqual(expoBodies, [[{ to: "ExponentPushToken[old]", title: "Expo", body: "Existing" }]]);
  assert.equal(requests.length, 1);
});

test("registration is authenticated, validated and backward compatible", async () => {
  assert.equal((await api(native)).status, 401);
  for (const body of [null, [], "invalid", {}, { token: 3 }, { ...native, kind: "bad" }, { ...native, environment: undefined },
    { ...native, environment: "bad" }, { ...native, token: "odd" }, { ...native, token: "a" }]) {
    assert.equal((await api(body, sessions.kid)).status, 400);
  }
  assert.equal((await api({ token: "ExponentPushToken[existing]" }, sessions.kid)).status, 200);
  assert.equal((await api({ token: "ExponentPushToken[existing]" }, sessions.kid)).status, 200);
  const [row] = await tokensFor([kidId]);
  assert.equal(row.kind, "expo");
  assert.equal(row.environment, "production");
  assert.equal((await tokensFor([kidId])).length, 1);
  assert.deepEqual(await tokensFor([]), []);
});

test("main's two-column conflict target survives migration and registrations update metadata", async () => {
  const pool = getPool();
  const insert = "INSERT INTO push_tokens (person_id, token) VALUES ($1, $2) ON CONFLICT (person_id, token) DO NOTHING";
  await pool.query(insert, [kidId, native.token]);
  await pool.query(insert, [kidId, native.token]);
  const [legacy] = await tokensFor([kidId]);
  assert.equal((await tokensFor([kidId])).length, 1);
  assert.equal(legacy.kind, "expo");
  assert.equal(legacy.environment, "production");
  await registerPushToken(kidId, native);
  const [updated] = await tokensFor([kidId]);
  assert.equal(updated.id, legacy.id);
  assert.equal(updated.kind, "apns");
  assert.equal(updated.environment, "sandbox");
  await pool.query(insert, [kidId, native.token]);
  assert.equal((await tokensFor([kidId]))[0].kind, "apns");
  await registerPushToken(kidId, { ...native, kind: "expo", environment: "production" });
  assert.equal((await tokensFor([kidId]))[0].kind, "expo");
});

test("native registration transfers ownership and updates the active environment without cross-actor unregister", async () => {
  assert.equal((await api(native, sessions.parent)).status, 200);
  assert.equal((await api({ ...native, token: native.token.toUpperCase() }, sessions.kid)).status, 200);
  assert.equal((await tokensFor([parentId])).length, 0);
  assert.equal((await tokensFor([kidId])).length, 1);
  await api({ ...native, environment: "production" }, sessions.kid);
  await api(native, sessions.parent, "unregister");
  assert.equal((await tokensFor([kidId])).length, 1);
  assert.equal((await tokensFor([kidId]))[0].environment, "production");
  await api(native, sessions.parent);
  await api(native, sessions.kid, "unregister");
  await api({ ...native, environment: "production" }, sessions.parent, "unregister");
  assert.equal((await tokensFor([parentId]))[0].environment, "sandbox");
  assert.equal((await tokensFor([kidId]))[0].environment, "production");
  await api(native, sessions.parent, "unregister");
  await api({ ...native, environment: "production" }, sessions.kid, "unregister");
  assert.equal((await tokensFor([kidId, parentId])).length, 0);
});

test("concurrent native registrations leave one owner without unique-index failures", async () => {
  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    registerPushToken(index % 2 ? kidId : parentId, native)));
  const rows = await tokensFor([kidId, parentId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token, native.token);
});

test("failed native ownership transfers preserve the previous registration", async () => {
  await registerPushToken(parentId, native);
  await assert.rejects(registerPushToken(randomUUID(), native));
  const rows = await tokensFor([kidId, parentId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].personId, parentId);
});

test("APNs Unregistered (410) and BadDeviceToken (400) delete only matching native environment", async () => {
  for (const failure of [{ status: 410, reason: "Unregistered" }, { status: 400, reason: "BadDeviceToken" }]) {
    await registerPushToken(kidId, native);
    await registerPushToken(parentId, { ...native, environment: "production" });
    await registerPushToken(kidId, { token: "ExponentPushToken[retained]", kind: "expo", environment: "production" });
    response = failure;
    await sendPush([{ to: native.token, kind: "apns", environment: "sandbox", title: "Hi", body: "Test" }]);
    const rows = await tokensFor([kidId, parentId]);
    assert.equal(rows.filter((row) => row.kind === "apns" && row.environment === "sandbox").length, 0);
    assert.equal(rows.filter((row) => row.kind === "apns" && row.environment === "production").length, 1);
    assert.equal(rows.length, 2);
    await db.delete(schema.pushTokens);
  }
});

test("transient failures and misconfiguration retain tokens and do not break callers or Expo", async () => {
  await registerPushToken(kidId, native);
  response = { status: 503, reason: "ServiceUnavailable" };
  await notifyPerson(kidId, "Hi", "Retry later");
  response = { status: 400, reason: "DeviceTokenNotForTopic" };
  await notifyPerson(kidId, "Hi", "Keep token for corrected config");
  transportFailure = true;
  await notifyPerson(kidId, "Hi", "Offline");
  assert.equal((await tokensFor([kidId])).length, 1);
  assert.ok(requests.every((request) => request.closed));
  const count = requests.length;
  delete process.env.APNS_KEY_P8;
  await registerPushToken(kidId, { token: "ExponentPushToken[still works]", kind: "expo", environment: "production" });
  await notifyPerson(kidId, "Hi", "No APNs config");
  assert.equal(requests.length, count);
  assert.equal(expoBodies.length, 1);
  process.env.APNS_KEY_P8 = "invalid test key";
  await notifyPerson(kidId, "Hi", "Invalid signing key");
  assert.equal((await tokensFor([kidId])).length, 2);
});

test("parents get proof/reward notifications; cron Expo-only delivery avoids duplicate native local reminders", async () => {
  await registerPushToken(parentId, native);
  await notifyParents("Photo waiting", "A chore");
  assert.equal(requests.length, 1);
  await registerPushToken(kidId, { ...native, token: "cd".repeat(32) });
  await registerPushToken(kidId, { token: "ExponentPushToken[kid]", kind: "expo", environment: "production" });
  await notifyPerson(kidId, "Chores still open", "One chore", "expo");
  assert.equal(requests.length, 1);
  assert.equal(expoBodies.length, 1);
  await notifyPerson(kidId, "Chore approved", "Stars are in");
  assert.equal(requests.length, 2);
  assert.equal((await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.personId, parentId))).length, 1);
});
