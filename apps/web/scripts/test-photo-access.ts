import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { addDays, mealPhotoSrc, type DisplaySnapshot } from "@liendo/shared";
import { handleApi } from "../lib/api";
import { getDb, getPool, schema } from "../lib/db";
import { errorResponse } from "../lib/http";
import { deleteStoredPhoto } from "../lib/blob";
import { todayIso } from "../lib/time";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.match(database.pathname, /^\/liendo_photo_access_test_\d+$/,
  "Use a dedicated photo-access database, never the app database");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));

const db = getDb();
const tokens = { parent: randomUUID(), kid: randomUUID(), other: randomUUID(), empty: randomUUID(), display: randomUUID() };
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
let otherGuidePhoto: string;
let ownChoreId: string;
let otherChoreId: string;
let openChoreId: string;
let ownId: string;
let otherId: string;
let openId: string;
let kidId: string;
let otherKidId: string;
const originalFetch = globalThis.fetch;

function assertPrivatePhoto(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const vary = response.headers.get("vary")?.toLowerCase().split(",").map((field) => field.trim());
  assert.ok(vary?.includes("authorization"));
  assert.ok(vary?.includes("cookie"));
}

async function request(path: string, actor: keyof typeof tokens, method = "GET", body?: Record<string, string>) {
  const headers: Record<string, string> = actor === "display" ?
    { "x-display-token": tokens.display } : { authorization: `Bearer ${tokens[actor]}` };
  if (body) headers["content-type"] = "application/json";
  try {
    return await handleApi(new Request("http://photo-access.test/api/" + path, {
      headers, method, body: body ? JSON.stringify(body) : undefined,
    }));
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
  [ownPhoto, otherPhoto, mealPhoto, guidePhoto, otherGuidePhoto] =
    ["own", "other", "meal", "guide", "other-guide"].map((path) => `${base}/${path}.jpg`);
  const people = await db.insert(schema.people).values([
    { slug: "photo-parent", name: "Parent", role: "parent", color: "#123456" },
    { slug: "photo-kid", name: "Kid", role: "kid", color: "#123456" },
    { slug: "photo-other", name: "Other kid", role: "kid", color: "#123456" },
    { slug: "photo-empty", name: "No chores", role: "kid", color: "#123456" },
  ]).returning();
  kidId = people[1].id;
  otherKidId = people[2].id;
  for (const [index, actor] of (["parent", "kid", "other", "empty"] as const).entries()) {
    await db.insert(schema.sessions).values({
      personId: people[index].id,
      tokenHash: createHash("sha256").update(tokens[actor]).digest("hex"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
  }
  await db.insert(schema.displayPairings).values({
    tokenHash: createHash("sha256").update(tokens.display).digest("hex"),
  });
  const chores = await db.insert(schema.chores).values([people[1], people[2]].map((person, index) => ({
    title: "Proof for " + person.name, assignedPersonId: person.id, stars: 2,
    requiresPhoto: true, repeatType: "once", onceDate: yesterday,
    guidePhotoPath: index === 0 ? guidePhoto : otherGuidePhoto,
  }))).returning();
  [ownChoreId, otherChoreId] = chores.map((chore) => chore.id);
  const instances = await db.insert(schema.choreInstances).values(chores.map((chore, index) => ({
    choreId: chore.id, personId: chore.assignedPersonId, date: yesterday,
    status: "pending", photoPath: index === 0 ? ownPhoto : otherPhoto,
  }))).returning();
  [ownId, otherId] = instances.map((instance) => instance.id);
  const [openChore] = await db.insert(schema.chores).values({
    title: "Own open chore", assignedPersonId: kidId, stars: 1,
    requiresPhoto: false, repeatType: "once", onceDate: yesterday,
  }).returning();
  openChoreId = openChore.id;
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

test("kid chore lists contain only assigned definitions, including an empty list", async () => {
  for (const [actor, ids] of [
    ["kid", [ownChoreId, openChoreId]], ["other", [otherChoreId]], ["empty", []],
  ] as const) {
    const response = await request("chores", actor);
    assert.equal(response.status, 200);
    const { chores } = await response.json();
    assert.deepEqual(new Set(chores.map((chore: { id: string }) => chore.id)), new Set(ids));
  }
});

test("kid chore detail allows own definition, denies others, and preserves missing 404", async () => {
  const own = await request(`chores/${ownChoreId}`, "kid");
  assert.equal(own.status, 200);
  assert.equal((await own.json()).chore.id, ownChoreId);
  assert.equal((await request(`chores/${otherChoreId}`, "kid")).status, 403);
  assert.equal((await request(`chores/${ownChoreId}`, "other")).status, 403);
  assert.equal((await request(`chores/${randomUUID()}`, "kid")).status, 404);
});

test("parent and display retain every chore definition and detail", async () => {
  const ids = [ownChoreId, otherChoreId, openChoreId];
  for (const actor of ["parent", "display"] as const) {
    const response = await request("chores", actor);
    assert.equal(response.status, 200);
    const { chores } = await response.json();
    assert.deepEqual(new Set(chores.map((chore: { id: string }) => chore.id)), new Set(ids));
    for (const id of ids) {
      const detail = await request(`chores/${id}`, actor);
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).chore.id, id);
    }
  }
});

test("guide downloads enforce assignment without changing parent or display access", async () => {
  assert.equal((await request("photos/" + encodeURIComponent(guidePhoto), "kid")).status, 200);
  assert.equal((await request("photos/" + encodeURIComponent(otherGuidePhoto), "kid")).status, 403);
  assert.equal((await request("photos/" + encodeURIComponent(guidePhoto), "other")).status, 403);
  for (const actor of ["parent", "display"] as const) {
    for (const path of [guidePhoto, otherGuidePhoto]) {
      assert.equal((await request("photos/" + encodeURIComponent(path), actor)).status, 200);
    }
  }
});

test("a guide shared by own and other chores remains usable for the own chore", async () => {
  await db.update(schema.chores).set({ guidePhotoPath: guidePhoto }).where(eq(schema.chores.id, otherChoreId));
  try {
    assert.equal((await request("photos/" + encodeURIComponent(guidePhoto), "kid")).status, 200);
  } finally {
    await db.update(schema.chores).set({ guidePhotoPath: otherGuidePhoto }).where(eq(schema.chores.id, otherChoreId));
  }
});

test("reassignment preserves guide and detail access for the kid retaining a rejected instance", async () => {
  const guide = otherGuidePhoto + "?reassigned";
  const [chore] = await db.insert(schema.chores).values({
    title: "Retry after reassignment", assignedPersonId: kidId, stars: 2,
    requiresPhoto: true, repeatType: "once", onceDate: todayIso(), guidePhotoPath: guide,
  }).returning();
  const [instance] = await db.insert(schema.choreInstances).values({
    choreId: chore.id, personId: kidId, date: todayIso(), status: "rejected",
  }).returning();
  try {
    const reassigned = await request(`chores/${chore.id}`, "parent", "PATCH", { assignedPersonId: otherKidId });
    assert.equal(reassigned.status, 200);
    assert.equal((await reassigned.json()).chore.assignedPersonId, otherKidId);
    const response = await request(`snapshot?from=${todayIso()}&to=${todayIso()}`, "kid");
    assert.equal(response.status, 200);
    const data = await response.json() as DisplaySnapshot;
    const retained = data.chores.find((item) => item.id === instance.id);
    assert.equal(retained?.status, "rejected");
    assert.equal(retained?.guidePhotoPath, guide);
    const list = await request("chores", "kid");
    assert.ok(!(await list.json()).chores.some((item: { id: string }) => item.id === chore.id));
    for (const actor of ["kid", "other", "parent", "display"] as const) {
      assert.equal((await request(`chores/${chore.id}`, actor)).status, 200);
      const photo = await request("photos/" + encodeURIComponent(guide), actor);
      assert.equal(photo.status, 200);
      assert.deepEqual(Buffer.from(await photo.arrayBuffer()), bytes);
    }
    assert.equal((await request(`chores/${chore.id}`, "empty")).status, 403);
    assert.equal((await request("photos/" + encodeURIComponent(guide), "empty")).status, 403);
  } finally {
    await db.delete(schema.chores).where(eq(schema.chores.id, chore.id));
  }
});

test("protected photo reads prohibit caching for every actor and for authorization and missing-photo errors", async () => {
  for (const actor of ["kid", "parent", "display"] as const) {
    for (const path of [ownPhoto, guidePhoto, mealPhoto]) {
      const response = await request("photos/" + encodeURIComponent(path), actor);
      assert.equal(response.status, 200);
      assertPrivatePhoto(response);
    }
  }
  for (const path of [otherPhoto, otherGuidePhoto]) {
    const response = await request("photos/" + encodeURIComponent(path), "kid");
    assert.equal(response.status, 403);
    assertPrivatePhoto(response);
  }
  const missing = await request("photos/" + encodeURIComponent("local:missing.jpg"), "kid");
  assert.equal(missing.status, 404);
  assertPrivatePhoto(missing);
  const anonymous = await handleApi(new Request("http://photo-access.test/api/photos/" + encodeURIComponent(ownPhoto)));
  assert.equal(anonymous.status, 401);
  assertPrivatePhoto(anonymous);
  const cookie = await handleApi(new Request("http://photo-access.test/api/photos/" + encodeURIComponent(ownPhoto), {
    headers: { cookie: `lp_session=${tokens.parent}` },
  }));
  assert.equal(cookie.status, 200);
  assertPrivatePhoto(cookie);
});

test("guide upload and clear responses, including failed mutations, prohibit caching", async () => {
  const [chore] = await db.insert(schema.chores).values({
    title: "Cache fixture", assignedPersonId: kidId, stars: 1, requiresPhoto: false, repeatType: "daily",
  }).returning();
  let stored: string | undefined;
  try {
    const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    const uploaded = await handleApi(new Request(`http://photo-access.test/api/chores/${chore.id}/guide-photo`, {
      method: "POST", headers: { authorization: `Bearer ${tokens.parent}`, "content-type": "image/jpeg" },
      body: new Uint8Array(jpeg),
    }));
    assert.equal(uploaded.status, 200);
    assertPrivatePhoto(uploaded);
    stored = (await uploaded.json()).chore.guidePhotoPath;
    assert.ok(stored);
    const read = await request("photos/" + encodeURIComponent(stored), "kid");
    assert.equal(read.status, 200);
    assertPrivatePhoto(read);
    const removed = await request(`chores/${chore.id}/guide-photo`, "parent", "DELETE");
    assert.equal(removed.status, 200);
    assertPrivatePhoto(removed);
    assert.equal((await removed.json()).chore.guidePhotoPath, null);
    for (const method of ["POST", "DELETE"]) {
      const forbidden = await request(`chores/${chore.id}/guide-photo`, "kid", method);
      assert.equal(forbidden.status, 403);
      assertPrivatePhoto(forbidden);
      const missing = await request(`chores/${randomUUID()}/guide-photo`, "parent", method);
      assert.equal(missing.status, 404);
      assertPrivatePhoto(missing);
    }
    for (const path of [`chores/${chore.id}/guide-photo`, `chores/instances/${ownId}/photo`, `meals/${yesterday}/photo`]) {
      const empty = await request(path, "parent", "POST");
      assert.equal(empty.status, 400);
      assertPrivatePhoto(empty);
    }
  } finally {
    await deleteStoredPhoto(stored);
    await db.delete(schema.chores).where(eq(schema.chores.id, chore.id));
  }
});
