import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { storePhoto } from "../lib/blob";
import { getDb, getPool, schema } from "../lib/db";

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.match(database.pathname, /^\/liendo_guide_kitchen_test_\d+$/);
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  const output = process.env.LP_GUIDE_SESSION_FILE;
  assert.ok(output, "Set LP_GUIDE_SESSION_FILE to a private path outside the repository");
  const db = getDb();
  const [kid] = await db.select().from(schema.people).where(eq(schema.people.slug, "noah"));
  const [parent] = await db.select().from(schema.people).where(eq(schema.people.slug, "focus"));
  assert.ok(kid && parent, "Run db:seed on the dedicated database first");
  const guidePhotoPath = await storePhoto(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
      <rect width="640" height="400" fill="#eee4d3"/>
      <rect x="80" y="70" width="480" height="240" rx="12" fill="#708e9b"/>
      <path d="M100 220h440" stroke="#fff" stroke-width="8"/>
      <ellipse cx="320" cy="200" rx="100" ry="18" fill="#fff"/>
      <ellipse cx="320" cy="185" rx="100" ry="18" fill="#faf6ef"/>
      <ellipse cx="320" cy="170" rx="100" ry="18" fill="#fff"/>
      <text x="320" y="365" text-anchor="middle" font-size="28" fill="#3a2418">Clean plates go on this shelf</text>
    </svg>`,
  ));
  await db.insert(schema.chores).values({
    title: "Guide fixture chore", assignedPersonId: kid.id, stars: 2,
    requiresPhoto: false, repeatType: "daily", guidePhotoPath,
    description: "Use the photo to find the shelf for clean plates.", steps: ["Stack the plates neatly"],
  });
  const tokens = { kid: randomUUID(), parent: randomUUID(), display: randomUUID() };
  for (const [role, person] of [["kid", kid], ["parent", parent]] as const) {
    await db.insert(schema.sessions).values({
      personId: person.id, tokenHash: createHash("sha256").update(tokens[role]).digest("hex"),
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    });
  }
  await db.insert(schema.displayPairings).values({
    tokenHash: createHash("sha256").update(tokens.display).digest("hex"),
  });
  await writeFile(output, JSON.stringify(tokens), { mode: 0o600 });
  console.log("Guide fixture and private session file ready.");
  await getPool().end();
}

void main();
