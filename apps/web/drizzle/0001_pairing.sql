CREATE TABLE IF NOT EXISTS pairing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  device_kind text NOT NULL,
  short_code text,
  request_secret_hash text NOT NULL,
  invite_token_hash text,
  status text NOT NULL DEFAULT 'pending',
  approved_by_id uuid REFERENCES people(id),
  device_label text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS pairing_requests_short_pending
  ON pairing_requests (short_code)
  WHERE status = 'pending' AND short_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pairing_requests_invite_token
  ON pairing_requests (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_id uuid;

ALTER TABLE display_pairings ADD COLUMN IF NOT EXISTS device_id uuid;
ALTER TABLE display_pairings ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT 'Kitchen frame';
ALTER TABLE display_pairings ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  label text NOT NULL,
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  display_pairing_id uuid REFERENCES display_pairings(id) ON DELETE SET NULL,
  created_by_id uuid REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

INSERT INTO devices (kind, label, display_pairing_id, created_at, last_seen_at)
SELECT 'display', COALESCE(label, 'Kitchen frame (earlier pairing)'), id, created_at, last_seen_at
FROM display_pairings
WHERE revoked_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM devices d WHERE d.display_pairing_id = display_pairings.id
  );
