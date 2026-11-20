import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { handleApi } from "../lib/api";
import { getDb, schema } from "../lib/db";
import { errorResponse } from "../lib/http";

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.match(database.pathname, /^\/liendo_refresh_test_\d+$/);
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  const port = Number(process.env.LP_REFRESH_PORT ?? "3128");
  assert.ok(port > 3000 && port < 65536);
  const sessionFile = process.env.LP_REFRESH_SESSION_FILE;
  assert.ok(sessionFile, "Set LP_REFRESH_SESSION_FILE to a private path outside the repository");
  const db = getDb();
  const [parent, kid] = await db.insert(schema.people).values([
    { slug: "refresh-parent", name: "Parent", role: "parent", color: "#123456" },
    { slug: "refresh-kid", name: "Kid", role: "kid", color: "#123456" },
  ]).returning();
  await db.insert(schema.chores).values({
    title: "Refresh fixture chore", assignedPersonId: kid.id, stars: 1,
    requiresPhoto: false, repeatType: "daily",
  });
  const token = randomUUID();
  await db.insert(schema.sessions).values({
    personId: parent.id, tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  });
  await writeFile(sessionFile, token, { mode: 0o600 });
  const counts = { snapshot: 0, pending: 0, meals: 0 };
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url ?? "/", `http://127.0.0.1:${port}`);
    let response: Response;
    try {
      if (url.pathname.startsWith("/api/qa/requests/")) {
        response = Response.json(counts);
      } else {
        if (url.pathname === "/api/snapshot") counts.snapshot++;
        if (url.pathname === "/api/chores/instances/pending") counts.pending++;
        if (url.pathname === "/api/meals") counts.meals++;
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        }
        response = await handleApi(new Request(url, { method: incoming.method, headers }));
      }
    } catch (error) {
      response = errorResponse(error);
    }
    console.log(`${new Date().toISOString()} ${incoming.method} ${url.pathname}${url.search} ${response.status}`);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(port, "127.0.0.1", () => console.log(`Refresh fixture listening on ${port}; database ${database.pathname}`));
}

void main();
