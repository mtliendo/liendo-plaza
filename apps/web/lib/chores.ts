import { and, eq, gte, lte } from "drizzle-orm";
import type { Chore, ChoreInstance, RepeatType } from "@liendo/shared";
import { addDays } from "@liendo/shared";
import { deleteStoredPhoto } from "./blob";
import { getDb, schema } from "./db";
import { HttpError } from "./http";
import { jsWeekday, startOfDayCt, todayIso } from "./time";

function asChore(row: typeof schema.chores.$inferSelect): Chore {
  return {
    id: row.id,
    title: row.title,
    assignedPersonId: row.assignedPersonId,
    stars: row.stars,
    requiresPhoto: row.requiresPhoto,
    repeatType: row.repeatType as RepeatType,
    weekdays: row.weekdays,
    weeklyWeekday: row.weeklyWeekday,
    onceDate: row.onceDate,
    description: row.description,
    steps: row.steps ?? [],
    guidePhotoPath: row.guidePhotoPath,
    active: row.active,
  };
}

function toInstance(
  instance: typeof schema.choreInstances.$inferSelect,
  chore: typeof schema.chores.$inferSelect,
): ChoreInstance {
  return {
    id: instance.id,
    choreId: instance.choreId,
    personId: instance.personId,
    date: instance.date,
    status: instance.status as ChoreInstance["status"],
    stars: chore.stars,
    starsAwarded: instance.starsAwarded,
    title: chore.title,
    requiresPhoto: chore.requiresPhoto,
    photoPath: instance.photoPath,
    description: chore.description,
    steps: chore.steps ?? [],
    guidePhotoPath: chore.guidePhotoPath,
    repeatType: chore.repeatType as RepeatType,
    weekdays: chore.weekdays,
    weeklyWeekday: chore.weeklyWeekday,
    onceDate: chore.onceDate,
  };
}

export function occursOn(chore: Chore, iso: string): boolean {
  const weekday = jsWeekday(startOfDayCt(iso));
  switch (chore.repeatType) {
    case "daily":
      return true;
    case "weekdays": {
      const days = chore.weekdays?.length ? chore.weekdays : [1, 2, 3, 4, 5];
      return days.includes(weekday);
    }
    case "weekly": {
      if (chore.weekdays?.length) return chore.weekdays.includes(weekday);
      return chore.weeklyWeekday === weekday;
    }
    case "once":
      return chore.onceDate === iso;
    default:
      return false;
  }
}

export async function listChores(): Promise<Chore[]> {
  const db = getDb();
  const rows = await db.select().from(schema.chores);
  return rows.map(asChore);
}

export async function getChore(id: string): Promise<Chore> {
  const db = getDb();
  const [row] = await db.select().from(schema.chores).where(eq(schema.chores.id, id)).limit(1);
  if (!row) throw new HttpError(404, "That chore is gone.");
  return asChore(row);
}

export async function createChore(input: Omit<Chore, "id" | "active">): Promise<Chore> {
  const db = getDb();
  const [row] = await db
    .insert(schema.chores)
    .values({
      title: input.title.trim(),
      assignedPersonId: input.assignedPersonId,
      stars: input.stars,
      requiresPhoto: input.requiresPhoto,
      repeatType: input.repeatType,
      weekdays: input.weekdays,
      weeklyWeekday: input.weeklyWeekday,
      onceDate: input.onceDate,
      description: input.description,
      steps: input.steps ?? [],
      guidePhotoPath: input.guidePhotoPath,
    })
    .returning();
  return asChore(row);
}

export async function updateChore(id: string, patch: Partial<Chore>): Promise<Chore> {
  const db = getDb();
  const [row] = await db
    .update(schema.chores)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.assignedPersonId !== undefined ? { assignedPersonId: patch.assignedPersonId } : {}),
      ...(patch.stars !== undefined ? { stars: patch.stars } : {}),
      ...(patch.requiresPhoto !== undefined ? { requiresPhoto: patch.requiresPhoto } : {}),
      ...(patch.repeatType !== undefined ? { repeatType: patch.repeatType } : {}),
      ...(patch.weekdays !== undefined ? { weekdays: patch.weekdays } : {}),
      ...(patch.weeklyWeekday !== undefined ? { weeklyWeekday: patch.weeklyWeekday } : {}),
      ...(patch.onceDate !== undefined ? { onceDate: patch.onceDate } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.steps !== undefined ? { steps: patch.steps } : {}),
      ...(patch.guidePhotoPath !== undefined ? { guidePhotoPath: patch.guidePhotoPath } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.chores.id, id))
    .returning();
  if (!row) throw new HttpError(404, "That chore is gone.");
  const chore = asChore(row);
  await refreshFutureOpenInstances(chore);
  return chore;
}

export async function deactivateChore(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(schema.chores).where(eq(schema.chores.id, id)).limit(1);
  if (!row) return;
  const instances = await db.select().from(schema.choreInstances).where(eq(schema.choreInstances.choreId, id));
  await deleteStoredPhoto(row.guidePhotoPath);
  for (const instance of instances) await deleteStoredPhoto(instance.photoPath);
  await updateChore(id, { active: false, guidePhotoPath: null });
}

async function refreshFutureOpenInstances(chore: Chore) {
  const db = getDb();
  const today = todayIso();
  await db
    .delete(schema.choreInstances)
    .where(
      and(
        eq(schema.choreInstances.choreId, chore.id),
        gte(schema.choreInstances.date, today),
        eq(schema.choreInstances.status, "open"),
      ),
    );
}

export async function ensureInstances(fromIso: string, toIso: string): Promise<ChoreInstance[]> {
  const db = getDb();
  const chores = (await listChores()).filter((chore) => chore.active);
  const dates: string[] = [];
  for (let cursor = fromIso; cursor <= toIso; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }

  for (const date of dates) {
    for (const chore of chores) {
      if (!occursOn(chore, date)) continue;
      await db
        .insert(schema.choreInstances)
        .values({
          choreId: chore.id,
          personId: chore.assignedPersonId,
          date,
        })
        .onConflictDoNothing({ target: [schema.choreInstances.choreId, schema.choreInstances.date] });
    }
  }

  const rows = await db
    .select({
      instance: schema.choreInstances,
      chore: schema.chores,
    })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.choreInstances.choreId, schema.chores.id))
    .where(and(gte(schema.choreInstances.date, fromIso), lte(schema.choreInstances.date, toIso)));

  return rows.map(({ instance, chore }) => toInstance(instance, chore));
}

export async function undoInstance(id: string): Promise<ChoreInstance> {
  const db = getDb();
  const [row] = await db
    .select({ instance: schema.choreInstances, chore: schema.chores })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.choreInstances.choreId, schema.chores.id))
    .where(eq(schema.choreInstances.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, "That chore is not on the list.");
  if (row.instance.status === "open") {
    return toInstance(row.instance, row.chore);
  }
  const [updated] = await db
    .update(schema.choreInstances)
    .set({
      status: "open",
      starsAwarded: 0,
      completedAt: null,
      reviewedAt: null,
      reviewedById: null,
    })
    .where(eq(schema.choreInstances.id, id))
    .returning();
  return toInstance(updated, row.chore);
}

export async function completeInstance(id: string, allowPhoto = false): Promise<ChoreInstance> {
  const db = getDb();
  const [row] = await db
    .select({ instance: schema.choreInstances, chore: schema.chores })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.choreInstances.choreId, schema.chores.id))
    .where(eq(schema.choreInstances.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, "That chore is not on the list.");
  if (row.chore.requiresPhoto && !allowPhoto) {
    throw new HttpError(400, "This one needs a photo on the phone.");
  }
  if (row.instance.status === "done") {
    return toInstance(row.instance, row.chore);
  }
  const [updated] = await db
    .update(schema.choreInstances)
    .set({
      status: "done",
      starsAwarded: row.chore.stars,
      completedAt: new Date(),
    })
    .where(eq(schema.choreInstances.id, id))
    .returning();
  return toInstance(updated, row.chore);
}

export async function markPhotoPending(id: string, photoPath: string): Promise<ChoreInstance> {
  const db = getDb();
  const [row] = await db
    .select({ instance: schema.choreInstances, chore: schema.chores })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.choreInstances.choreId, schema.chores.id))
    .where(eq(schema.choreInstances.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, "That chore is not on the list.");
  if (!row.chore.requiresPhoto) {
    throw new HttpError(400, "This chore does not need a photo.");
  }
  const [updated] = await db
    .update(schema.choreInstances)
    .set({
      status: "pending",
      photoPath,
      completedAt: new Date(),
    })
    .where(eq(schema.choreInstances.id, id))
    .returning();
  return toInstance(updated, row.chore);
}

export async function reviewInstance(
  id: string,
  action: "approve" | "reject",
  reviewerId: string,
): Promise<ChoreInstance> {
  const db = getDb();
  const [row] = await db
    .select({ instance: schema.choreInstances, chore: schema.chores })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.choreInstances.choreId, schema.chores.id))
    .where(eq(schema.choreInstances.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, "That chore is not on the list.");
  if (row.instance.status !== "pending") {
    throw new HttpError(400, "Nothing to review on that chore.");
  }
  const approved = action === "approve";
  const [updated] = await db
    .update(schema.choreInstances)
    .set({
      status: approved ? "done" : "rejected",
      starsAwarded: approved ? row.chore.stars : 0,
      reviewedAt: new Date(),
      reviewedById: reviewerId,
    })
    .where(eq(schema.choreInstances.id, id))
    .returning();
  return toInstance(updated, row.chore);
}
