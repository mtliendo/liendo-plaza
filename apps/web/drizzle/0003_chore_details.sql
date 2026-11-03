ALTER TABLE chores ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE chores ADD COLUMN IF NOT EXISTS steps text[] NOT NULL DEFAULT '{}';
ALTER TABLE chores ADD COLUMN IF NOT EXISTS guide_photo_path text;
