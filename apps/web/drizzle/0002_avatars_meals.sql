ALTER TABLE people ADD COLUMN IF NOT EXISTS avatar_key text;
UPDATE people SET avatar_key = slug WHERE role = 'kid' AND avatar_key IS NULL;

ALTER TABLE meals ADD COLUMN IF NOT EXISTS photo_path text;
