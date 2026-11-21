import assert from "node:assert/strict";
import { loginWithPin } from "../lib/auth";
import { handleApi } from "../lib/api";
import { applyChores, proposeChores, validateChanges } from "../lib/chore-agent";
import { peopleList } from "../lib/snapshot";
import { HttpError } from "../lib/http";
import { getPool } from "../lib/db";

async function main() {
  process.env.CHORE_AGENT_FAKE = "1";
  const people = await peopleList();
  const kid = people.find(p => p.role === "kid")!;
  const { token } = await loginWithPin(kid.id, "1234");
  await assert.rejects(() => handleApi(new Request("http://localhost/api/agent/chores/propose", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: "add fish" }),
  })), (e: unknown) => e instanceof HttpError && e.status === 403);
  console.log("PASS kid gets 403");
  const valid = { title: "Validation fixture", assignedPersonId: kid.id, stars: 1, requiresPhoto: false, repeatType: "daily" };
  assert.deepEqual(await validateChanges([
    { op: "create", chore: { title: "" } }, { op: "delete", choreId: "bad" },
    { op: "create", chore: { ...valid, assignedPersonId: "00000000-0000-0000-0000-000000000000" } },
    { op: "create", chore: { ...valid, stars: 51 } },
    { op: "create", chore: { ...valid, repeatType: "once", onceDate: "2026-02-30" } },
  ]), []);
  assert.deepEqual(await validateChanges([]), []);
  console.log("PASS validation drops invalid changes and handles empty input");
  const proposal = await proposeChores({ message: "add Agent regression fish" });
  assert.equal(proposal.changes.length, 1);
  const created = (await applyChores(proposal.changes)).chores.find(c => c.title === "Agent regression fish" && c.active)!;
  assert.ok(created);
  const preview = await validateChanges([{ op: "update", choreId: created.id, patch: { stars: 3 } }]);
  assert.equal(preview[0].before?.stars, 1);
  const updated = await applyChores(preview);
  assert.equal(updated.chores.find(c => c.id === created.id)?.stars, 3);
  await applyChores([{ op: "delete", choreId: created.id }]);
  console.log("PASS apply creates, updates, deletes");
  await assert.rejects(() => applyChores([
    proposal.changes[0], { op: "delete", choreId: created.id },
  ]), (e: unknown) => e instanceof HttpError && e.status === 409);
  console.log("PASS stale chore rejects whole batch with 409");
  const empty = await proposeChores({ message: "hello" });
  assert.deepEqual(empty.changes, []);
  console.log("PASS unclear request returns no changes");
}
main().finally(() => getPool().end()).catch(error => { console.error(error); process.exitCode = 1; });
