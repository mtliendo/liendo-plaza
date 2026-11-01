import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPool } from "../lib/db";

async function main() {
  const sql = await readFile(join(process.cwd(), "drizzle", "0000_init.sql"), "utf8");
  const pool = getPool();
  await pool.query(sql);
  await pool.end();
  console.log("migrations applied");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
