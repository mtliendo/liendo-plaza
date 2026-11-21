ALTER TABLE chores ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, (row_number() OVER (PARTITION BY assigned_person_id ORDER BY created_at, id) - 1)::integer AS position
  FROM chores
  WHERE assigned_person_id IN (
    SELECT assigned_person_id FROM chores GROUP BY assigned_person_id HAVING bool_and(sort_order = 0)
  )
)
UPDATE chores SET sort_order = ranked.position FROM ranked WHERE chores.id = ranked.id;
