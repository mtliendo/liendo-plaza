import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPool } from "../lib/db";

async function main() {
  const dir = join(process.cwd(), "drizzle");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const pool = getPool();
  for (const file of files) {
    const sql = await readFile(join(dir, file), "utf8");
    await pool.query(sql);
    console.log(`applied ${file}`);
  }
  await pool.end();
  console.log("migrations applied");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
