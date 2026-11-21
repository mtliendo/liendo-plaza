import assert from "node:assert/strict";
import { loginWithPin } from "../lib/auth";
import { handleApi } from "../lib/api";
import { applyChores, proposeChores, validateChanges } from "../lib/chore-agent";
import { peopleList } from "../lib/snapshot";
import { HttpError } from "../lib/http";
import { getPool } from "../lib/db";
import { listChores } from "../lib/chores";

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
  const invalidChanges = [
    { op: "create", chore: { ...valid, onceDate: "" } },
    { op: "update", choreId: created.id, patch: { onceDate: "2026-02-30" } },
    { op: "create", chore: { ...valid, stars: 51 } },
    { op: "delete", choreId: "bad" },
    { op: "update", choreId: created.id, patch: { assignedPersonId: "00000000-0000-0000-0000-000000000000" } },
    { op: "update", choreId: created.id, patch: { repeatType: "weekly", weekdays: [], weeklyWeekday: null } },
  ];
  for (const invalid of invalidChanges) {
    const count = (await listChores()).length;
    await assert.rejects(() => applyChores([
      { op: "create", chore: valid }, { op: "update", choreId: created.id, patch: { stars: 7 } }, invalid,
    ]), (e: unknown) => e instanceof HttpError && e.status === 400 && e.message.includes("Nothing was applied"));
    assert.equal((await listChores()).length, count);
    assert.equal((await listChores()).find(c => c.id === created.id)?.stars, 3);
    assert.deepEqual(await validateChanges([invalid]), []);
  }
  console.log("PASS invalid apply batches return 400 without creating or updating; propose drops invalid changes");
  const normalized = await validateChanges([{ op: "create", chore: {
    ...valid, onceDate: "2026-01-01", weekdays: [1], weeklyWeekday: 2,
  } }]);
  assert.equal(normalized[0].op === "create" && normalized[0].chore.onceDate, null);
  assert.equal(normalized[0].op === "create" && normalized[0].chore.weekdays, null);
  assert.equal(normalized[0].op === "create" && normalized[0].chore.weeklyWeekday, null);
  const connection = await getPool().connect();
  try {
    await connection.query("ALTER TABLE chores ADD CONSTRAINT agent_rollback_test CHECK (title <> 'Agent rollback fixture') NOT VALID");
    const count = (await listChores()).length;
    await assert.rejects(() => applyChores([
      { op: "update", choreId: created.id, patch: { stars: 7 } },
      { op: "create", chore: valid },
      { op: "create", chore: { ...valid, title: "Agent rollback fixture" } },
    ]));
    assert.equal((await listChores()).length, count);
    assert.equal((await listChores()).find(c => c.id === created.id)?.stars, 3);
  } finally {
    await connection.query("ALTER TABLE chores DROP CONSTRAINT IF EXISTS agent_rollback_test");
    connection.release();
  }
  console.log("PASS all date fields validated, irrelevant repeat fields normalized, database failures roll back batch");
  const weekends = await validateChanges([{ op: "update", choreId: created.id,
    patch: { repeatType: "weekly", weekdays: [6, 0], weeklyWeekday: null } }]);
  assert.ok(weekends[0].label.includes("daily → Sat, Sun"));
  await applyChores(weekends);
  const weekly = await validateChanges([{ op: "update", choreId: created.id, patch: { stars: 4 } }]);
  assert.equal(weekly.length, 1);
  assert.ok(weekly[0].label.includes("★3 → ★4"));
  await applyChores(weekly);
  const monday = await validateChanges([{ op: "update", choreId: created.id,
    patch: { weekdays: [], weeklyWeekday: 1 } }]);
  assert.ok(monday[0].label.includes("Sat, Sun → Mon"));
  await applyChores(monday);
  const creates = await validateChanges([{ op: "create", chore: {
    ...valid, repeatType: "weekdays", weekdays: [1, 3, 5],
  } }]);
  assert.ok(creates[0].label.includes("Mon, Wed, Fri"));
  console.log("PASS weekly arrays and single days accepted; labels show names and old → new values");
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
