import assert from "node:assert/strict";
import { getDb, getPool, schema } from "../lib/db";
import { issuePersonSession } from "../lib/auth";
import { asPerson } from "../lib/person";

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.match(database.pathname, /^\/liendo_.*test_\d+$/);
  const parent = (await getDb().select().from(schema.people)).find((p) => p.slug === "focus" && p.role === "parent");
  assert.ok(parent, "Seed the isolated database first");
  let session = await issuePersonSession(asPerson(parent), { kind: "phone", label: "Existing parent test fixture" });
  if (process.argv.includes("--setup")) {
    const base = new URL(process.env.LP_API_URL ?? "");
    assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
    const headers = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };
    const status = await fetch(new URL("/api/auth/codes/status", base), { headers }).then((r) => r.json());
    const response = await fetch(new URL("/api/auth/codes/setup", base), { method: "POST", headers,
      body: JSON.stringify({ personId: parent.id, code: "123456", confirmation: "123456", deviceKind: "phone",
        kids: status.people.filter((p: { role: string }) => p.role === "kid").map((p: { id: string; slug: string }) => ({
          personId: p.id, code: ({ noah: "1234", sofia: "0101", xavier: "0303" } as Record<string, string>)[p.slug],
        })),
      }),
    });
    assert.equal(response.status, 200);
    session = await response.json();
  }
  process.stdout.write(session.token);
  await getPool().end();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
