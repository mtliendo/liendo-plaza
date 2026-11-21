import assert from "node:assert/strict";
import { loginWithPin } from "../lib/auth";
import { handleApi } from "../lib/api";
import { applyChores, proposeChores, recoverChoreProposal, validateChanges } from "../lib/chore-agent";
import { peopleList } from "../lib/snapshot";
import { HttpError } from "../lib/http";
import { getPool } from "../lib/db";
import { listChores } from "../lib/chores";
import { NoObjectGeneratedError } from "ai";
import { MockLanguageModelV4 } from "ai/test";

async function main() {
  process.env.CHORE_AGENT_FAKE = "1";
  const people = await peopleList();
  const kid = people.find(p => p.role === "kid")!;
  const { token } = await loginWithPin(kid.id, "1234");
  const deniedRequest = new Request("http://localhost/api/agent/chores/propose", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: "add fish" }),
  });
  deniedRequest.json = async () => { throw new Error("Kid body must not be parsed"); };
  const denied = await handleApi(deniedRequest);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "Only a parent can do that." });
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  assert.match(denied.headers.get("vary") ?? "", /Authorization, Cookie/i);
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
  const generationError = (text: string | undefined) => new NoObjectGeneratedError({
    text, response: { id: "test", modelId: "test", timestamp: new Date() }, finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2,
      inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 1, reasoningTokens: 0 } },
  });
  const recovered = await recoverChoreProposal(generationError(JSON.stringify({
    summary: "Review these changes.", changes: [
      { op: "create", chore: valid }, { op: "create", chore: { ...valid, stars: 100 } },
    ],
  })));
  assert.equal(recovered.changes.length, 1);
  assert.equal(recovered.summary, "Review these changes.");
  for (const text of [undefined, "{", "{}", JSON.stringify({ summary: "Invalid", changes: [{ op: "bad" }] })]) {
    const result = await recoverChoreProposal(generationError(text));
    assert.deepEqual(result.changes, []);
    assert.ok(result.summary.includes("try again"));
  }
  const providerError = new Error("Provider unavailable");
  await assert.rejects(() => recoverChoreProposal(providerError), error => error === providerError);
  console.log("PASS structured-output fallback salvages valid changes, handles malformed output, and preserves other errors");
  const proposal = await proposeChores({ message: "add Agent regression fish" });
  assert.equal(proposal.changes.length, 1);
  const created = (await applyChores(proposal.changes)).chores.find(c => c.title === "Agent regression fish" && c.active)!;
  assert.ok(created);
  const unknownId = "01234567-89ab-cdef-0123-456789abcdef";
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify({
        summary: `Remove ${created.id} for ${kid.id.toUpperCase()}. Also ${created.id.toUpperCase()}; reference ${unknownId}.`,
        changes: [{ op: "delete", choreId: created.id }],
      }) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  });
  process.env.CHORE_AGENT_FAKE = "0";
  try {
    const removal = await proposeChores({ message: `remove ${created.title}` }, model);
    assert.equal(removal.summary, `Remove ${created.title} for ${kid.name}. Also ${created.title}; reference .`);
    assert.doesNotMatch(removal.summary, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    assert.equal(removal.changes[0].op === "delete" && removal.changes[0].choreId, created.id);
    assert.equal(model.doGenerateCalls.length, 1);
    assert.ok(model.doGenerateCalls[0].prompt.some(turn => turn.role === "system" &&
      turn.content.includes("never IDs or UUIDs")));
  } finally {
    process.env.CHORE_AGENT_FAKE = "1";
  }
  console.log("PASS stub-model removal summaries replace chore/person IDs with names and strip unknown UUIDs");
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
  assert.deepEqual(weekly[0].op === "update" && weekly[0].patch, { stars: 4 });
  const copiedSchedule = await validateChanges([{ op: "update", choreId: created.id,
    patch: { stars: 4, repeatType: "weekly", weekdays: [6, 0], weeklyWeekday: null, onceDate: null } }]);
  assert.deepEqual(copiedSchedule[0].op === "update" && copiedSchedule[0].patch, { stars: 4 });
  await getPool().query("UPDATE chores SET weekdays = ARRAY[2,4] WHERE id = $1", [created.id]);
  const concurrent = await applyChores(weekly);
  assert.equal(concurrent.chores.find(c => c.id === created.id)?.stars, 4);
  assert.deepEqual(concurrent.chores.find(c => c.id === created.id)?.weekdays, [2, 4]);
  const copiedResult = await applyChores(copiedSchedule);
  assert.deepEqual(copiedResult.chores.find(c => c.id === created.id)?.weekdays, [2, 4]);
  console.log("PASS stars-only previews stay sparse and preserve concurrent database schedule changes");
  const monday = await validateChanges([{ op: "update", choreId: created.id,
    patch: { weekdays: [], weeklyWeekday: 1 } }]);
  assert.ok(monday[0].label.includes("Tue, Thu → Mon"));
  await applyChores(monday);
  const switchToDaily = await validateChanges([{ op: "update", choreId: created.id, patch: { repeatType: "daily" } }]);
  const daily = (await applyChores(switchToDaily)).chores.find(c => c.id === created.id)!;
  assert.equal(daily.repeatType, "daily");
  assert.equal(daily.weekdays, null);
  assert.equal(daily.weeklyWeekday, null);
  assert.equal(daily.onceDate, null);
  const creates = await validateChanges([{ op: "create", chore: {
    ...valid, repeatType: "weekdays", weekdays: [1, 3, 5],
  } }]);
  assert.ok(creates[0].label.includes("Mon, Wed, Fri"));
  console.log("PASS weekly arrays and single days accepted; labels show names and old → new values");
  const parent = people.find(p => p.role === "parent")!;
  const parentCreate = await validateChanges([{ op: "create", chore: {
    ...valid, title: "Agent parent regression", assignedPersonId: parent.id,
  } }]);
  assert.equal(parentCreate.length, 1);
  assert.ok(parentCreate[0].label.includes(parent.name));
  const parentChore = (await applyChores(parentCreate)).chores.find(c => c.active && c.title === "Agent parent regression")!;
  assert.equal(parentChore.assignedPersonId, parent.id);
  const parentUpdate = await validateChanges([{ op: "update", choreId: parentChore.id, patch: { stars: 5 } }]);
  assert.equal(parentUpdate.length, 1);
  assert.ok(parentUpdate[0].label.includes(parent.name));
  assert.equal((await applyChores(parentUpdate)).chores.find(c => c.id === parentChore.id)?.stars, 5);
  const reassign = await validateChanges([{ op: "update", choreId: created.id, patch: { assignedPersonId: parent.id } }]);
  assert.equal(reassign.length, 1);
  assert.equal((await applyChores(reassign)).chores.find(c => c.id === created.id)?.assignedPersonId, parent.id);
  const parentDelete = await proposeChores({ message: "remove Agent parent regression" });
  assert.equal(parentDelete.changes.length, 1);
  assert.equal(parentDelete.changes[0].op, "delete");
  assert.equal((await applyChores(parentDelete.changes)).chores.find(c => c.id === parentChore.id)?.active, false);
  console.log("PASS parent-assigned chores support create, update, reassignment and fake-mode deletion");
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
