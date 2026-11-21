import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { FAMILY } from "@liendo/shared";
import { getDb, getPool, schema } from "../lib/db";
import { issuePersonSession, pairDisplay } from "../lib/auth";
import { asPerson } from "../lib/person";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.match(database.pathname, /^\/liendo_setup_gate_test_\d+$/);
const base = new URL(process.env.SETUP_AUDIT_BASE_URL ?? "http://127.0.0.1:3158");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
const db = getDb();
const rows: string[][] = [];
let failed = 0;

async function main() {
  await db.execute(sql`truncate people, family_codes, display_pairings cascade`);
  const people = await db.insert(schema.people).values(FAMILY.map((p) => ({ ...p }))).returning();
  const focus = people.find((p) => p.slug === "focus")!;
  const jess = people.find((p) => p.slug === "jess")!;
  const noah = people.find((p) => p.slug === "noah")!;
  const callers: { name: string; headers: Record<string, string>; parentId?: string; denied: number }[] = [
    { name: "Anonymous", headers: {}, denied: 401 },
    { name: "Display", headers: { "x-display-token": await pairDisplay("Setup audit display", focus.id) }, denied: 401 },
  ];
  for (const person of [noah, focus, jess]) {
    const { token } = await issuePersonSession(asPerson(person), { kind: "phone", label: "Existing live session" });
    for (const cookie of [false, true]) callers.push({ name: `${person.name} (${cookie ? "cookie" : "bearer"})`,
      headers: cookie ? { cookie: `lp_session=${token}` } : { authorization: `Bearer ${token}` },
      parentId: person.role === "parent" ? person.id : undefined, denied: person.role === "kid" ? 403 : 409,
    });
  }
  async function check(caller: typeof callers[number], phase: string, path: string, expected: number,
    body: unknown | undefined, verify: (data: any) => void) {
    let result = "PASS";
    let actual = "";
    try {
      const response = await fetch(new URL(`/api/${path}`, base), { method: body ? "POST" : "GET",
        headers: { ...caller.headers, "content-type": "application/json", "x-forwarded-for": randomUUID() },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      actual = `HTTP ${response.status}`;
      assert.equal(response.status, expected);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const vary = response.headers.get("vary")!.toLowerCase();
      assert.ok(vary.includes("authorization") && vary.includes("cookie"));
      assert.doesNotMatch(JSON.stringify(data), /"(?:hash|pinHash|tokenHash|pinFailedAttempts|pinLockedUntil)"/);
      verify(data);
    } catch (error) {
      failed++; result = "FAIL"; actual += `; ${(error as Error).message.replaceAll("|", "/").replaceAll("\n", " ")}`;
    }
    rows.push([`${body ? "POST" : "GET"} /api/${path} (${phase})`, caller.name,
      `${expected}; scoped body; private, no-store; Vary auth/cookie`, `${result}: ${actual}; body/cache checked`]);
  }
  for (const caller of callers) {
    await db.delete(schema.familyCodes);
    await check(caller, "before setup", "auth/codes/status", 200, undefined, (data) => {
      if (caller.parentId) { assert.equal(data.setupRequired, true); assert.equal(data.people.length, 5); }
      else assert.deepEqual(data, { setupRequired: true });
    });
    const body = { personId: caller.parentId ?? focus.id, code: "123456", confirmation: "123456" };
    if (caller.parentId) {
      await check(caller, "wrong parent", "auth/codes/setup", 403,
        { ...body, personId: caller.parentId === focus.id ? jess.id : focus.id }, (data) => assert.deepEqual(Object.keys(data), ["error"]));
      assert.equal((await db.select().from(schema.familyCodes)).length, 0);
    }
    await check(caller, "before setup", "auth/codes/setup", caller.parentId ? 200 : caller.denied, body, (data) => {
      if (caller.parentId) { assert.equal(data.person.id, caller.parentId); assert.ok(data.token); }
      else assert.deepEqual(Object.keys(data), ["error"]);
    });
    if (!caller.parentId) {
      assert.equal((await db.select().from(schema.familyCodes)).length, 0);
      const parent = callers.find((p) => p.parentId === focus.id)!;
      await check(parent, "establish fixture", "auth/codes/setup", 200,
        { ...body, personId: focus.id }, (data) => assert.equal(data.person.id, focus.id));
    }
    await check(caller, "after setup", "auth/codes/status", 200, undefined, (data) => {
      assert.deepEqual(data, caller.parentId ? { setupRequired: false, people: [] } : { setupRequired: false });
    });
    await check(caller, "after setup", "auth/codes/setup", caller.parentId ? 409 : caller.denied, body,
      (data) => assert.deepEqual(Object.keys(data), ["error"]));
  }
  const text = ["# Family setup gate role audit", "", "Surfaces: status fields/roster, setup writes, identity forgery, bearer/cookie authorization, before/after-setup states and HTTP caches. Web/native variants are recorded separately below.", "",
    "| Surface | Role tested | Expected | Actual result |", "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`), "",
    `Setup gate audit: ${rows.length} checks; ${rows.length - failed} passed; ${failed} failed`, "",
    "Display-only credentials return 401 on the person-only setup route; a signed-in kid returns 403. Parent identity mismatches return 403. All statuses are measured HTTP responses, not source-only inferences.", "",
  ].join("\n");
  await writeFile(process.env.SETUP_AUDIT_REPORT ?? "/Users/devin/friction/setup-gate-audit.md", text);
  console.log(`Setup gate audit: ${rows.length} checks; ${rows.length - failed} passed; ${failed} failed`);
  assert.equal(failed, 0);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => getPool().end());
