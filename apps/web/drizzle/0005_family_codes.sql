CREATE TABLE IF NOT EXISTS family_codes (
  id text PRIMARY KEY,
  hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz
);
