import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import type { Person } from "@liendo/shared";
import { pairDisplay, loginWithPin } from "../lib/auth";
import { getDb, getPool, schema } from "../lib/db";
import { listRewardRequests } from "../lib/stars";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function main() {
  assert.match(process.env.DATABASE_URL ?? "", /\/liendo_plaza_test_[\w-]+$/, "Use an isolated test database");
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname));
  const db = getDb();
  const people = await db.select().from(schema.people);
  const parent = people.find((p) => p.slug === "focus")!;
  const sofia = people.find((p) => p.slug === "sofia")!;
  const noah = people.find((p) => p.slug === "noah")!;
  const xavier = people.find((p) => p.slug === "xavier")!;
  const codes = ["123456", "0101", "1234", "0303"];
  const status = await fetch(`${base}/api/auth/codes/status`).then((r) => r.json());
  if (status.setupRequired) {
    const legacy = await loginWithPin(parent.id, "123456", { kind: "browser", label: "Existing privacy-test parent" });
    const setup = await fetch(`${base}/api/auth/codes/setup`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${legacy.token}` },
      body: JSON.stringify({ personId: parent.id, code: codes[0], confirmation: codes[0],
        kids: [sofia, noah, xavier].map((person, index) => ({ personId: person.id, code: codes[index + 1] })) }),
    });
    assert.equal(setup.status, 200);
  }
  const sessions: { token: string; person: Person }[] = [];
  for (const code of codes) {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceKind: "browser", deviceLabel: "Reward privacy regression" }),
    });
    assert.equal(response.status, 200);
    sessions.push(await response.json());
  }
  const [reward] = await db.insert(schema.rewards).values({ name: "Privacy test reward", starCost: 0 }).returning();
  const rows = await db.insert(schema.rewardRequests).values([
    { personId: sofia.id, rewardId: reward.id, status: "pending" },
    { personId: noah.id, rewardId: reward.id, status: "pending" },
    { personId: sofia.id, rewardId: reward.id, status: "approved" },
    { personId: noah.id, rewardId: reward.id, status: "rejected" },
  ]).returning();
  async function request(path: string, index?: number, method = "GET", body?: unknown, cookie = false) {
    return fetch(`${base}/api/${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(index === undefined ? {} : cookie
          ? { cookie: `lp_session=${sessions[index].token}` }
          : { authorization: `Bearer ${sessions[index].token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  try {
    for (const index of [1, 2, 3, 0]) {
      for (const cookie of [false, true]) {
        const response = await request("rewards/requests", index, "GET", undefined, cookie);
        assert.equal(response.status, 200);
        const { requests } = await response.json();
        if (index !== 0) assert.ok(requests.every((r: { personId: string }) => r.personId === sessions[index].person.id),
          `${sessions[index].person.name} received another kid's reward request`);
        for (const row of rows) assert.equal(requests.some((r: { id: string }) => r.id === row.id),
          index === 0 || row.personId === sessions[index].person.id);
      }
      const direct = await listRewardRequests(sessions[index].person);
      assert.ok(index === 0 || direct.every((r) => r.personId === sessions[index].person.id));
      const html = await fetch(`${base}/family/stars`, { headers: { cookie: `lp_session=${sessions[index].token}` } }).then((r) => r.text());
      for (const row of rows) assert.equal(html.includes(row.id), index === 0 || row.personId === sessions[index].person.id,
        "Server HTML must not dehydrate another kid's request");
      for (const path of index <= 1 ? ["snapshot", "stars"] : []) {
        const response = await request(path, index);
        assert.equal(response.status, 200);
        const body = await response.text();
        assert.ok(rows.every((row) => !body.includes(row.id)), `${path} must not contain request rows`);
        assert.ok(!body.includes("rewardId") && !body.includes("reviewedById"));
      }
    }
    console.log("PASS list + server HTML/hydration: parent all; Sofia/Noah own pending + historical; Xavier empty; bearer + cookie; snapshot/stars expose no request rows");
    for (const action of ["approve", "reject"]) {
      const response = await request(`rewards/requests/${rows[1].id}/review`, 1, "POST", { action });
      assert.equal(response.status, 403);
    }
    const denied = await request("rewards/requests");
    assert.equal(denied.status, 401);
    for (const suffix of ["", "/cancel", "/photo"]) {
      const response = await request(`rewards/requests/${rows[1].id}${suffix}`, 1, suffix === "/cancel" ? "POST" : "GET");
      assert.equal(response.status, 404);
    }
    const invalid = await request("rewards/requests", 1, "POST", {});
    assert.equal(invalid.status, 400);
    const created = await request("rewards/requests", 1, "POST", { rewardId: reward.id, personId: noah.id });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).request.personId, sofia.id);
    const reviewed = await request(`rewards/requests/${rows[0].id}/review`, 0, "POST", { action: "approve" });
    assert.equal(reviewed.status, 200);
    console.log("PASS kid cross-owner approve/reject 403; anonymous 401; absent detail/cancel/photo 404; invalid create 400; forged-owner create remains own; parent approve 200");
    const display = await pairDisplay("Reward privacy regression display", parent.id);
    for (const path of ["snapshot", "stars", "rewards/requests"]) {
      const response = await fetch(`${base}/api/${path}`, { headers: { "x-display-token": display } });
      assert.equal(response.status, path === "rewards/requests" ? 401 : 200);
      const body = await response.text();
      assert.ok(rows.every((row) => !body.includes(row.id)));
    }
    const displayHtml = await fetch(`${base}/display`, { headers: { cookie: `lp_display=${display}` } }).then((r) => r.text());
    assert.ok(rows.every((row) => !displayHtml.includes(row.id)));
    console.log("PASS display snapshot/stars/HTML contain no request rows; display token cannot list requests (401)");
  } finally {
    await db.delete(schema.rewardRequests).where(inArray(schema.rewardRequests.rewardId, [reward.id]));
    await db.delete(schema.rewards).where(inArray(schema.rewards.id, [reward.id]));
    await getPool().end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
