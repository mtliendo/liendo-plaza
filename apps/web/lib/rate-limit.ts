import { HttpError } from "./http";
import { getPool } from "./db";

export async function rateLimit(key: string, limit: number, windowMs: number) {
  const result = await getPool().query(`
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
  if (!result.rowCount) {
    throw new HttpError(429, "Too many tries. Wait a minute and try again.");
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
