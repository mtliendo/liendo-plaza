import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { loginWithPin } from "../lib/auth";
import { getPool } from "../lib/db";
import { peopleList } from "../lib/snapshot";
import { storePhoto } from "../lib/blob";

export async function auditChoreAgentRoles(base: string) {
  const records: unknown[] = [];
  const people = await peopleList();
  const parent = people.find(p => p.slug === "focus" && p.role === "parent")!;
  const kid = people.find(p => p.slug === "noah" && p.role === "kid")!;
  const other = people.find(p => p.role === "kid" && p.id !== kid.id)!;
  const approver = (await loginWithPin(parent.id, "123456")).token;
  async function call(path: string, token?: string, body?: unknown, method = "POST", headers: HeadersInit = {}) {
    return fetch(`${base}/api/${path}`, {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  }
  async function json(path: string, token?: string, body?: unknown, method = "POST") {
    const response = await call(path, token, body, method);
    assert.ok(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
    return response.json();
  }
  async function pair(deviceKind: string, token: string) {
    const claim = await json("pair/claim", undefined, { deviceKind, label: "Chore agent role audit" });
    await json("pair/approve", token, { code: claim.displayCode });
    return json("pair/poll", undefined, { id: claim.id, pollSecret: claim.pollSecret });
  }
  const status = await json("auth/codes/status", approver, undefined, "GET");
  if (status.setupRequired) {
    await json("auth/codes/setup", approver, {
      personId: parent.id, code: "123456", confirmation: "123456",
      kids: people.filter(p => p.role === "kid").map(p => ({
        personId: p.id, code: ({ noah: "1234", sofia: "0101", xavier: "0303" } as Record<string, string>)[p.slug],
      })),
    });
  }
  const parentLogin = await json("auth/login", undefined, {
    code: "123456", deviceKind: "phone",
  });
  const kidLogin = await json("auth/login", undefined, {
    code: "1234", deviceKind: "phone",
  });
  assert.equal(kidLogin.person.role, "kid");
  assert.equal(parentLogin.person.role, "parent");
  assert.equal(kidLogin.person.id, kid.id);
  assert.equal(parentLogin.person.id, parent.id);
  console.log("PASS HTTP family-code auth/login: real kid and parent credentials");
  const pt = parentLogin.token as string;
  const kt = kidLogin.token as string;
  const display = await pair("display", pt);
  const privateHeaders = (response: Response) => {
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("vary") ?? "", /Authorization/i);
    assert.match(response.headers.get("vary") ?? "", /Cookie/i);
  };
  async function record(surface: string, role: string, response: Response, status: number, privateResponse = true) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const body = response.headers.get("content-type")?.includes("json") ? JSON.parse(bytes.toString()) : { base64: bytes.toString("base64") };
    records.push({ surface, role, status: response.status, body,
      cacheControl: response.headers.get("cache-control"), vary: response.headers.get("vary") });
    console.log(`AUDIT ${role} ${surface}: ${response.status} ${status === 200 || status === 201 ? "(body saved)" : JSON.stringify(body)}`);
    assert.equal(response.status, status, `${role} ${surface}: ${JSON.stringify(body)}`);
    if (privateResponse) privateHeaders(response);
    if (status === 403 && surface.includes("agent/")) assert.deepEqual(body, { error: "Only a parent can do that." });
    if (status === 401) assert.deepEqual(body, { error: "Sign in first." });
    return body;
  }
  const fixtures: string[] = [];
  try {
    const chore = { title: `Role audit ${Date.now()}`, assignedPersonId: kid.id, stars: 1,
      requiresPhoto: false, repeatType: "daily" };
    for (const assignedPersonId of [kid.id, other.id]) {
      const result = await json("chores", pt, { ...chore, assignedPersonId,
        title: `${chore.title} ${assignedPersonId === kid.id ? "own" : "foreign"}` });
      fixtures.push(result.chore.id);
    }
    const own = fixtures[0], foreign = fixtures[1];
    const parentQuota = async () => (await getPool().query(
      "SELECT count FROM rate_limit_buckets WHERE key = $1 AND reset_at >= statement_timestamp()", [`chore-agent:${parent.id}`],
    )).rows[0]?.count ?? 0;
    assert.equal(await parentQuota(), 0, "Live audit needs a fresh parent quota");
    const dbState = async () => (await getPool().query(
      "SELECT (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM chores c) AS chores, (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM chore_instances i) AS instances",
    )).rows;
    const before = await dbState();
    for (const body of [{ message: "add forbidden fish" }, "{", undefined]) {
      await record(`POST agent/chores/propose ${body === undefined ? "empty" : typeof body === "string" ? "malformed" : "valid"}`,
        "kid", await call("agent/chores/propose", kt, body), 403);
    }
    for (let i = 0; i < 21; i++) {
      const response = await call("agent/chores/propose", kt, { message: "add forbidden fish" });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "Only a parent can do that." });
    }
    records.push({ surface: "21 additional kid proposals", status: 403, body: { error: "Only a parent can do that." } });
    for (const change of [
      { op: "create", chore }, { op: "update", choreId: foreign, patch: { stars: 50 } },
      { op: "delete", choreId: foreign },
    ]) {
      await record(`POST agent/chores/apply ${change.op}`, "kid",
        await call("agent/chores/apply", kt, { changes: [change] }), 403);
    }
    assert.deepEqual(await dbState(), before, "Kid requests changed chore/instance data");
    assert.equal(await parentQuota(), 0, "Kid requests consumed durable parent quota");
    console.log("PASS HTTP kid create/update/delete rejected; complete chores and instances DB state unchanged");
    for (const [role, headers] of [
      ["anonymous", {}], ["display", { "x-display-token": display.token }],
      ["family", { "x-family-token": "obsolete-family-token" }],
    ] as const) {
      for (const path of ["propose", "apply"]) {
        await record(`POST agent/chores/${path}`, role, await call(`agent/chores/${path}`, undefined,
          path === "propose" ? { message: "add fish" } : { changes: [{ op: "delete", choreId: foreign }] },
          "POST", headers), 401);
      }
    }
    const preview = await record("POST agent/chores/propose", "parent",
      await call("agent/chores/propose", pt, { message: "add Role audit applied" }), 200);
    assert.doesNotMatch(preview.summary, /[0-9a-f]{8}-[0-9a-f-]{27}/i);
    const assignee = people.find(p => p.id === preview.changes[0].chore.assignedPersonId)!;
    assert.equal(preview.changes[0].label.includes(assignee.name), true);
    const applied = await record("POST agent/chores/apply", "parent", await call("agent/chores/apply", pt,
      { changes: preview.changes }), 200);
    fixtures.push(applied.chores.find((c: { title: string; active: boolean }) => c.active && c.title === "Role audit applied").id);
    const removal = await record("POST agent/chores/propose removal/before", "parent",
      await call("agent/chores/propose", pt, { message: `remove ${chore.title} own` }), 200);
    assert.ok(removal.changes[0].before);
    assert.equal("pinHash" in removal.changes[0].before, false);
    await record("POST agent/chores/apply cookie auth", "parent",
      await call("agent/chores/apply", undefined, { changes: [] }, "POST", { cookie: `lp_session=${pt}` }), 200);
    const list = await record("GET chores", "kid", await call("chores", kt, undefined, "GET"), 200);
    assert.ok(list.chores.every((c: { assignedPersonId: string }) => c.assignedPersonId === kid.id));
    await record("GET chores/own", "kid", await call(`chores/${own}`, kt, undefined, "GET"), 200);
    await record("GET chores/other", "kid", await call(`chores/${foreign}`, kt, undefined, "GET"), 403);
    await record("GET chores/other", "parent", await call(`chores/${foreign}`, pt, undefined, "GET"), 200);
    await record("GET chores", "parent", await call("chores", pt, undefined, "GET"), 200);
    const snapshot = await record("GET snapshot", "kid", await call("snapshot", kt, undefined, "GET"), 200);
    assert.ok(snapshot.chores.every((c: { personId: string }) => c.personId === kid.id));
    assert.ok(!JSON.stringify(snapshot.chores).includes(foreign));
    await record("GET snapshot", "parent", await call("snapshot", pt, undefined, "GET"), 200);
    for (const path of ["/family", "/family/chores"]) {
      const response = await fetch(`${base}${path}`, { headers: { cookie: `lp_session=${kt}` } });
      const html = await response.text();
      records.push({ surface: `GET ${path} SSR`, role: "kid", status: response.status,
        containsOwn: html.includes(own), containsOther: html.includes(foreign),
        cacheControl: response.headers.get("cache-control"), vary: response.headers.get("vary") });
      console.log(`AUDIT kid ${path} SSR: ${response.status}; own=${html.includes(own)}; other=${html.includes(foreign)}`);
      assert.equal(response.status, 200);
      assert.ok(html.includes(own), "SSR hydration must retain the kid's own chores");
      assert.ok(!html.includes(foreign), "SSR hydration leaks another kid's chore");
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    }
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64");
    for (const [owner, id] of [["own", own], ["other", foreign]]) {
      const upload = await fetch(`${base}/api/chores/${id}/guide-photo`, {
        method: "POST", headers: { authorization: `Bearer ${pt}`, "content-type": "image/png" }, body: image,
      });
      const guide = await record(`POST chores/${owner}/guide-photo`, "parent", upload, 200);
      const path = `photos/${encodeURIComponent(guide.chore.guidePhotoPath)}`;
      await record(`GET ${owner} guide binary`, "kid", await call(path, kt, undefined, "GET"), owner === "own" ? 200 : 403);
      await record(`GET ${owner} guide binary`, "parent", await call(path, pt, undefined, "GET"), 200);
    }
    const instance = (await getPool().query("SELECT id FROM chore_instances WHERE chore_id = $1 LIMIT 1", [foreign])).rows[0];
    const proof = await storePhoto(image);
    await getPool().query("UPDATE chore_instances SET photo_path = $1, status = 'pending' WHERE id = $2", [proof, instance.id]);
    await record("GET other proof binary", "kid", await call(`photos/${encodeURIComponent(proof)}`, kt, undefined, "GET"), 403);
    await record("GET other proof binary", "parent", await call(`photos/${encodeURIComponent(proof)}`, pt, undefined, "GET"), 200);
    const proofSnapshot = await record("GET snapshot with other proof metadata", "kid", await call("snapshot", kt, undefined, "GET"), 200);
    assert.ok(!JSON.stringify(proofSnapshot).includes(proof));
    for (const action of ["complete", "undo", "photo", "review"]) {
      await record(`POST other instance/${action}`, "kid", await call(`chores/instances/${instance.id}/${action}`,
        kt, { action: "approve" }), 403);
    }
    await record("GET chores/instances/pending", "kid", await call("chores/instances/pending", kt, undefined, "GET"), 403);
    await record("GET chores/instances/pending", "parent", await call("chores/instances/pending", pt, undefined, "GET"), 200);
    for (const method of ["POST", "PATCH", "DELETE"]) {
      await record(`${method} legacy chores`, "kid", await call(method === "POST" ? "chores" : `chores/${foreign}`,
        kt, method === "POST" ? chore : { stars: 50 }, method), 403);
    }
    const patched = await record("PATCH legacy chores", "parent", await call(`chores/${own}`,
      pt, { stars: 2 }, "PATCH"), 200);
    assert.equal(patched.chore.stars, 2);
    for (let i = 2; i < 20; i++) {
      const response = await call("agent/chores/propose", pt, { message: "hello" });
      assert.equal(response.status, 200, "Kid attempts burned parent quota");
      await response.arrayBuffer();
    }
    const limited = await record("POST agent/chores/propose parent quota boundary", "parent",
      await call("agent/chores/propose", pt, { message: "hello" }), 429);
    assert.deepEqual(limited, { error: "Too many tries. Wait a minute and try again." });
    assert.equal(await parentQuota(), 20);
    console.log("PASS 20 parent proposals succeed after 24 rejected kid attempts; only parent attempt 21 is rate-limited");
  } finally {
    for (const id of fixtures) await json(`chores/${id}`, pt, undefined, "DELETE");
    if (process.env.CHORE_AGENT_AUDIT_REPORT) {
      await writeFile(process.env.CHORE_AGENT_AUDIT_REPORT, JSON.stringify(records, null, 2));
    }
  }
  console.log("PASS live-server role-boundary audit");
}
