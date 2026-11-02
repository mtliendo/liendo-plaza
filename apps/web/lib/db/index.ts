import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let db: Database | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }
  pool = new Pool({
    connectionString: url,
    max: process.env.VERCEL ? 3 : 8,
  });
  return pool;
}

export function getDb(): Database {
  if (db) return db;
  db = drizzle(getPool(), { schema });
  return db;
}

export { schema };
