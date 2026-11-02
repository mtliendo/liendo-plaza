import type { Person } from "@liendo/shared";
import { schema } from "./db";

export function asPerson(row: typeof schema.people.$inferSelect): Person {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role as Person["role"],
    color: row.color,
    avatarKey: row.avatarKey ?? (row.role === "kid" ? row.slug : null),
  };
}

export function toMeal(row: { date: string; name: string; photoPath?: string | null }) {
  return {
    date: row.date,
    name: row.name,
    photoPath: row.photoPath ?? null,
  };
}
