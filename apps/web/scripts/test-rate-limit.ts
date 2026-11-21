import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { Pool } from "pg";
import { getPool } from "../lib/db";
import { errorResponse, HttpError } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";

async function worker(key: string, attempts: number) {
  let allowed = 0;
  for (let i = 0; i < attempts; i++) {
    try {
      await rateLimit(key, 20, 600_000);
      allowed++;
    } catch (error) {
      assert.ok(error instanceof HttpError);
      const response = errorResponse(error);
      assert.equal(response.status, 429);
      assert.deepEqual(await response.json(), { error: "Too many tries. Wait a minute and try again." });
    }
  }
  process.stdout.write(JSON.stringify({ allowed, denied: attempts - allowed }));
}

function coldProcess(key: string, attempts: number): Promise<{ allowed: number; denied: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import", "tsx", fileURLToPath(import.meta.url), "--worker", key, String(attempts),
    ], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { errors += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(`Limiter worker exited ${code}: ${errors}`));
      try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
    });
  });
}

async function main() {
  const keys = [randomUUID(), randomUUID(), randomUUID()].map(id => `rate-limit-test:${id}`);
  try {
    assert.deepEqual(await coldProcess(keys[0], 10), { allowed: 10, denied: 0 });
    assert.deepEqual(await coldProcess(keys[0], 10), { allowed: 10, denied: 0 });
    assert.deepEqual(await coldProcess(keys[0], 1), { allowed: 0, denied: 1 });
    console.log("PASS separate cold processes share one quota; combined request 21 returns the unchanged 429");
    const concurrent = await Promise.all([coldProcess(keys[1], 15), coldProcess(keys[1], 15)]);
    assert.equal(concurrent.reduce((sum, result) => sum + result.allowed, 0), 20);
    assert.equal(concurrent.reduce((sum, result) => sum + result.denied, 0), 10);
    const { rows: [bucket] } = await getPool().query("SELECT count FROM rate_limit_buckets WHERE key = $1", [keys[1]]);
    assert.equal(bucket.count, 20);
    console.log("PASS concurrent processes atomically allow exactly 20 of 30 requests");
    await getPool().query("UPDATE rate_limit_buckets SET reset_at = now() - interval '1 second' WHERE key = $1", [keys[0]]);
    assert.deepEqual(await coldProcess(keys[0], 1), { allowed: 1, denied: 0 });
    assert.deepEqual(await coldProcess(keys[2], 1), { allowed: 1, denied: 0 });
    assert.deepEqual(await coldProcess(keys[1], 1), { allowed: 0, denied: 1 });
    const { rows: [reset] } = await getPool().query("SELECT count, reset_at > now() AS renewed FROM rate_limit_buckets WHERE key = $1", [keys[0]]);
    assert.equal(reset.count, 1);
    assert.equal(reset.renewed, true);
    console.log("PASS expired windows renew and independent keys do not share quota");
    const missingTablePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: "-c search_path=pg_catalog",
    });
    const warning = mock.method(console, "warn", () => {});
    const query = mock.method(getPool(), "query", missingTablePool.query.bind(missingTablePool));
    try {
      for (let i = 0; i < 20; i++) await rateLimit(keys[0], 20, 600_000);
      await assert.rejects(() => rateLimit(keys[0], 20, 600_000), error =>
        error instanceof HttpError && error.status === 429 &&
        error.message === "Too many tries. Wait a minute and try again.");
      assert.equal(warning.mock.callCount(), 1);
      await rateLimit(keys[2], 20, 600_000);
      const later = Date.now() + 600_001;
      const clock = mock.method(Date, "now", () => later);
      try { await rateLimit(keys[0], 20, 600_000); } finally { clock.mock.restore(); }
      assert.equal(warning.mock.callCount(), 1);
      console.log("PASS real undefined_table falls back, limits request 21, isolates keys, renews expiry, and warns once");
      for (const code of ["42501", "08006"]) {
        const failure = Object.assign(new Error("Database unavailable"), { code });
        query.mock.mockImplementation(async () => { throw failure; });
        await assert.rejects(() => rateLimit(keys[0], 20, 600_000), error => error === failure);
      }
      assert.equal(warning.mock.callCount(), 1);
      console.log("PASS permission and connection errors still fail closed without fallback");
    } finally {
      query.mock.restore();
      warning.mock.restore();
      await missingTablePool.end();
    }
    await rateLimit(keys[0], 20, 600_000);
    const { rows: [recovered] } = await getPool().query("SELECT count FROM rate_limit_buckets WHERE key = $1", [keys[0]]);
    assert.equal(recovered.count, 2);
    console.log("PASS limiter automatically returns to durable counters when the table is available");
  } finally {
    await getPool().query("DELETE FROM rate_limit_buckets WHERE key = ANY($1::text[])", [keys]);
  }
}

const database = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname), "Use a local test database");
assert.match(database.pathname, /^\/liendo_.*test_\d+$/);
const run = process.argv[2] === "--worker" ? worker(process.argv[3], Number(process.argv[4])) : main();
run.catch(error => { console.error(error); process.exitCode = 1; }).finally(() => getPool().end());
