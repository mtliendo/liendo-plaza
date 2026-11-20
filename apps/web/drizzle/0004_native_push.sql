ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expo'
  CHECK (kind IN ('expo', 'apns'));
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production'
  CHECK (environment IN ('sandbox', 'production'));
DROP INDEX IF EXISTS push_tokens_person_token;
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_person_token
  ON push_tokens (person_id, token, kind, environment);
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_apns_device
  ON push_tokens (token, environment) WHERE kind = 'apns';
