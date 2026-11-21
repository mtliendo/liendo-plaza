import { HttpError } from "./http";
import { getPool } from "./db";

const buckets = new Map<string, { count: number; resetAt: number }>();
let warnedMissingTable = false;

export async function rateLimit(key: string, limit: number, windowMs: number) {
  let result;
  try {
    result = await getPool().query(`
      INSERT INTO rate_limit_buckets (key, count, reset_at)
      VALUES ($1, 1, statement_timestamp() + $3::double precision * interval '1 millisecond')
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limit_buckets.reset_at < statement_timestamp()
          THEN 1 ELSE rate_limit_buckets.count + 1 END,
        reset_at = CASE WHEN rate_limit_buckets.reset_at < statement_timestamp()
          THEN statement_timestamp() + $3::double precision * interval '1 millisecond'
          ELSE rate_limit_buckets.reset_at END
      WHERE rate_limit_buckets.reset_at < statement_timestamp() OR rate_limit_buckets.count < $2
      RETURNING key
    `, [key, limit, windowMs]);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "42P01")) throw error;
    if (!warnedMissingTable) {
      console.warn("Rate-limit table is missing; using per-process limits until the database migration is applied.");
      warnedMissingTable = true;
    }
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    current.count += 1;
    if (current.count <= limit) return;
    throw new HttpError(429, "Too many tries. Wait a minute and try again.");
  }
  if (!result.rowCount) {
    throw new HttpError(429, "Too many tries. Wait a minute and try again.");
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
