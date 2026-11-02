import { eq } from "drizzle-orm";
import type { FamilySettings } from "@liendo/shared";
import { getDb, schema } from "./db";

const REFRESH_KEY = "displayRefreshRequestedAt";

const DEFAULTS: FamilySettings = {
  choreReminderHour: 18,
  choreReminderMinute: 0,
};

export async function getSettings(): Promise<FamilySettings> {
  const db = getDb();
  const rows = await db.select().from(schema.settings);
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    choreReminderHour: Number(map.choreReminderHour ?? DEFAULTS.choreReminderHour),
    choreReminderMinute: Number(map.choreReminderMinute ?? DEFAULTS.choreReminderMinute),
  };
}

export async function updateSettings(patch: Partial<FamilySettings>): Promise<FamilySettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  const db = getDb();
  for (const [key, value] of Object.entries(next)) {
    await db
      .insert(schema.settings)
      .values({ key, value: String(value) })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(value) } });
  }
  return next;
}

export async function getDisplayRefreshRequestedAt(): Promise<string | null> {
  const db = getDb();
  const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, REFRESH_KEY));
  return rows[0]?.value ?? null;
}

export async function requestDisplayRefresh(): Promise<string> {
  const at = new Date().toISOString();
  const db = getDb();
  await db
    .insert(schema.settings)
    .values({ key: REFRESH_KEY, value: at })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: at } });
  return at;
}
