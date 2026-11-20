import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { addDays, mealPhotoSrc, type DisplaySnapshot } from "@liendo/shared";
import { handleApi } from "../lib/api";
import { getDb, getPool, schema } from "../lib/db";
import { errorResponse } from "../lib/http";
import { todayIso } from "../lib/time";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.match(database.pathname, /^\/liendo_photo_access_test_\d+$/,
  "Use a dedicated photo-access database, never the app database");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));

const db = getDb();
const tokens = { parent: randomUUID(), kid: randomUUID(), other: randomUUID(), display: randomUUID() };
const yesterday = addDays(todayIso(), -1);
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const photos = createServer((_req, response) => {
  response.writeHead(200, { "Content-Type": "image/jpeg" });
  response.end(bytes);
});
let ownPhoto: string;
let otherPhoto: string;
let mealPhoto: string;
let guidePhoto: string;
let ownId: string;
let otherId: string;
let openId: string;
let kidId: string;
const originalFetch = globalThis.fetch;

async function request(path: string, actor: keyof typeof tokens, method = "GET") {
  const headers: Record<string, string> = actor === "display" ?
    { "x-display-token": tokens.display } : { authorization: `Bearer ${tokens[actor]}` };
  try {
    return await handleApi(new Request("http://photo-access.test/api/" + path, { headers, method }));
  } catch (error) {
    return errorResponse(error);
  }
}

async function snapshot(actor: keyof typeof tokens) {
  const response = await request(`snapshot?from=${yesterday}&to=${yesterday}`, actor);
  assert.equal(response.status, 200);
  return await response.json() as DisplaySnapshot;
}

before(async () => {
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.open-meteo.com/")) return Response.json({});
    return originalFetch(input, init);
  };
  await new Promise<void>((resolve) => photos.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(photos.address() as AddressInfo).port}`;
  [ownPhoto, otherPhoto, mealPhoto, guidePhoto] = ["own", "other", "meal", "guide"].map((path) => `${base}/${path}.jpg`);
  const people = await db.insert(schema.people).values([
    { slug: "photo-parent", name: "Parent", role: "parent", color: "#123456" },
    { slug: "photo-kid", name: "Kid", role: "kid", color: "#123456" },
    { slug: "photo-other", name: "Other kid", role: "kid", color: "#123456" },
  ]).returning();
  kidId = people[1].id;
  for (const [index, actor] of (["parent", "kid", "other"] as const).entries()) {
    await db.insert(schema.sessions).values({
      personId: people[index].id,
      tokenHash: createHash("sha256").update(tokens[actor]).digest("hex"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
  }
  await db.insert(schema.displayPairings).values({
    tokenHash: createHash("sha256").update(tokens.display).digest("hex"),
  });
  const chores = await db.insert(schema.chores).values([people[1], people[2]].map((person) => ({
    title: "Proof for " + person.name, assignedPersonId: person.id, stars: 2,
    requiresPhoto: true, repeatType: "once", onceDate: yesterday, guidePhotoPath: guidePhoto,
  }))).returning();
  const instances = await db.insert(schema.choreInstances).values(chores.map((chore, index) => ({
    choreId: chore.id, personId: chore.assignedPersonId, date: yesterday,
    status: "pending", photoPath: index === 0 ? ownPhoto : otherPhoto,
  }))).returning();
  [ownId, otherId] = instances.map((instance) => instance.id);
  const [openChore] = await db.insert(schema.chores).values({
    title: "Own open chore", assignedPersonId: kidId, stars: 1,
    requiresPhoto: false, repeatType: "once", onceDate: yesterday,
  }).returning();
  const [openInstance] = await db.insert(schema.choreInstances).values({
    choreId: openChore.id, personId: kidId, date: yesterday, status: "open",
  }).returning();
  openId = openInstance.id;
  await db.insert(schema.meals).values({ date: yesterday, name: "Dinner", photoPath: mealPhoto });
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => photos.close((error) => error ? reject(error) : resolve()));
  await getPool().end();
});

test("kid can read own proof but cannot read another kid's proof", async () => {
  const own = await request("photos/" + encodeURIComponent(ownPhoto), "kid");
  assert.equal(own.status, 200);
  assert.deepEqual(Buffer.from(await own.arrayBuffer()), bytes);
  assert.equal((await request("photos/" + encodeURIComponent(otherPhoto), "kid")).status, 403);
  assert.equal((await request("photos/" + encodeURIComponent(ownPhoto), "other")).status, 403);
});

test("unknown path aliases cannot bypass proof ownership", async () => {
  assert.equal((await request("photos/" + encodeURIComponent(otherPhoto + "#alias"), "kid")).status, 404);
});

test("parents and displays retain access to every proof", async () => {
  for (const actor of ["parent", "display"] as const) {
    for (const path of [ownPhoto, otherPhoto]) {
      assert.equal((await request("photos/" + encodeURIComponent(path), actor)).status, 200);
    }
  }
});

test("kid snapshot excludes others' instance details without changing own chores or meals", async () => {
  const data = await snapshot("kid");
  assert.equal(data.chores.length, 2);
  assert.ok(data.chores.every((instance) => instance.personId === kidId));
  assert.equal(data.chores.find((instance) => instance.id === ownId)?.photoPath, ownPhoto);
  assert.equal(data.chores.find((instance) => instance.id === otherId), undefined);
  assert.equal(data.chores.find((instance) => instance.id === ownId)?.guidePhotoPath, guidePhoto);
  assert.equal(data.chores.find((instance) => instance.id === openId)?.status, "open");
  assert.equal(data.meals[0].photoPath, mealPhoto);
  const other = await snapshot("other");
  assert.deepEqual(other.chores.map((instance) => instance.id), [otherId]);
});

test("kid can still complete and undo their own non-photo chore", async () => {
  const completed = await request(`chores/instances/${openId}/complete`, "kid", "POST");
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).instance.status, "done");
  const undone = await request(`chores/instances/${openId}/undo`, "kid", "POST");
  assert.equal(undone.status, 200);
  assert.equal((await undone.json()).instance.status, "open");
});

test("parent and display snapshots preserve all proof paths", async () => {
  for (const actor of ["parent", "display"] as const) {
    const data = await snapshot(actor);
    assert.equal(data.chores.find((instance) => instance.id === ownId)?.photoPath, ownPhoto);
    assert.equal(data.chores.find((instance) => instance.id === otherId)?.photoPath, otherPhoto);
  }
});

test("meal and guide photos stay accessible; public seed images keep their public URL", async () => {
  for (const actor of ["kid", "parent", "display"] as const) {
    for (const path of [mealPhoto, guidePhoto]) {
      assert.equal((await request("photos/" + encodeURIComponent(path), actor)).status, 200);
    }
  }
  assert.equal(mealPhotoSrc("/meals/tacos.jpg"), "/meals/tacos.jpg");
});
