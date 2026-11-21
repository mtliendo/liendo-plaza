import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Person } from "@liendo/shared";
import { getDb, schema } from "./db";
import { hashPin, issuePersonSession, type DeviceAttach } from "./auth";
import { HttpError } from "./http";
import { asPerson } from "./person";

const parentCode = z.string().regex(/^\d{6,72}$/, "Use 6 or more digits (up to 72).");
const kidCode = z.string().regex(/^\d{4}$/, "Use exactly 4 digits.");
const setupSchema = z.object({
  code: parentCode,
  confirmation: z.string(),
  personId: z.string().uuid(),
  parents: z.array(z.object({ personId: z.string().uuid(), code: parentCode })).default([]),
  kids: z.array(z.object({ personId: z.string().uuid(), code: kidCode })).default([]),
});
const changeSchema = z.object({ personId: z.string().uuid(), code: z.string(), confirmation: z.string().optional() });
const lock = sql`select pg_advisory_xact_lock(18432, 5)`;
const lockoutIds = { kid: "household-kids", parent: "household-parents" };

function parse<T extends z.ZodTypeAny>(definition: T, input: unknown): z.infer<T> {
  const result = definition.safeParse(input);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? "Check the codes and try again.");
  return result.data;
}

export async function familyCodeStatus(parent?: Person) {
  const db = getDb();
  const rows = await db.select({ id: schema.familyCodes.id }).from(schema.familyCodes);
  const people = await db.select().from(schema.people);
  const setupRequired = !people.some((p) => p.role === "parent" && rows.some((row) => row.id === p.id));
  return { setupRequired, people: setupRequired && parent?.role === "parent" ? people.map(asPerson) : [] };
}

export async function setupFamilyCodes(input: unknown, device: DeviceAttach) {
  const body = parse(setupSchema, input);
  if (body.code !== body.confirmation) throw new HttpError(400, "The codes do not match.");
  const parents = [{ personId: body.personId, code: body.code }, ...body.parents];
  const codes = [...parents, ...body.kids];
  if (new Set(codes.map((entry) => entry.code)).size !== codes.length ||
      new Set(codes.map((entry) => entry.personId)).size !== codes.length) {
    throw new HttpError(400, "Each person needs a different code.");
  }
  const parent = await getDb().transaction(async (tx) => {
    await tx.execute(lock);
    const people = await tx.select().from(schema.people);
    const rows = await tx.select().from(schema.familyCodes);
    if (people.some((p) => p.role === "parent" && rows.some((row) => row.id === p.id))) {
      throw new HttpError(409, "Liendo Plaza is already set up. Enter your code.");
    }
    const chosen = people.find((person) => person.id === body.personId && person.role === "parent");
    if (!chosen || parents.some((entry) => !people.some((p) => p.id === entry.personId && p.role === "parent")) || body.kids.some((kid) => !people.some((p) => p.id === kid.personId && p.role === "kid"))) {
      throw new HttpError(400, "Pick a parent and valid kids.");
    }
    for (const kid of body.kids) {
      for (const other of people.filter((p) => p.role === "kid" && p.id !== kid.personId)) {
        const row = rows.find((row) => row.id === other.id);
        if (row && await bcrypt.compare(kid.code, row.hash)) throw new HttpError(409, "Each person needs a different code.");
      }
    }
    await tx.insert(schema.familyCodes).values(Object.values(lockoutIds).map((id) => ({ id, hash: "" }))).onConflictDoNothing();
    for (const entry of codes) {
      const hash = await hashPin(entry.code);
      await tx.insert(schema.familyCodes).values({ id: entry.personId, hash }).onConflictDoUpdate({ target: schema.familyCodes.id, set: { hash } });
    }
    return asPerson(chosen);
  });
  return issuePersonSession(parent, device);
}

export async function loginWithFamilyCode(code: string, device: DeviceAttach) {
  const role = /^\d{4}$/.test(code) ? "kid" : /^\d{6,72}$/.test(code) ? "parent" : null;
  if (!role) throw new HttpError(401, "That code is not recognized.");
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(lock);
    const rows = await tx.select().from(schema.familyCodes);
    const people = await tx.select().from(schema.people);
    if (!people.some((p) => p.role === "parent" && rows.some((row) => row.id === p.id))) return new HttpError(401, "That code is not recognized.");
    const counterId = lockoutIds[role];
    let counter = rows.find((row) => row.id === counterId);
    if (!counter) [counter] = await tx.insert(schema.familyCodes).values({ id: counterId, hash: "" }).returning();
    if (counter.lockedUntil && counter.lockedUntil.getTime() > Date.now()) {
      return new HttpError(423, "Too many tries. Try again in 5 minutes.");
    }
    let person: typeof people[number] | undefined;
    for (const candidate of people.filter((p) => p.role === role)) {
      const row = rows.find((row) => row.id === candidate.id);
      if (row && await bcrypt.compare(code, row.hash)) { person = candidate; break; }
    }
    if (!person) {
      const attempts = counter.failedAttempts + 1;
      const lockedUntil = attempts >= 10 ? new Date(Date.now() + 5 * 60_000) : null;
      await tx.update(schema.familyCodes).set({ failedAttempts: attempts, lockedUntil }).where(eq(schema.familyCodes.id, counterId));
      return new HttpError(lockedUntil ? 423 : 401, lockedUntil ? "Too many tries. Try again in 5 minutes." : "That code is not recognized.");
    }
    if (person.pinLockedUntil && person.pinLockedUntil.getTime() > Date.now()) {
      return new HttpError(423, "Too many tries. Try again in 15 minutes.");
    }
    await tx.update(schema.familyCodes).set({ failedAttempts: 0, lockedUntil: null }).where(eq(schema.familyCodes.id, counterId));
    return { person: asPerson(person) };
  });
  if (result instanceof HttpError) throw result;
  return issuePersonSession(result.person, device);
}

export async function codeSettings() {
  const rows = await getDb().select({ id: schema.familyCodes.id }).from(schema.familyCodes);
  return { configuredPersonIds: rows.filter((row) => row.id !== "household" && !Object.values(lockoutIds).includes(row.id)).map((row) => row.id) };
}

export async function changeFamilyCode(input: unknown) {
  const body = parse(changeSchema, input);
  await getDb().transaction(async (tx) => {
    await tx.execute(lock);
    const people = await tx.select().from(schema.people);
    const rows = await tx.select().from(schema.familyCodes);
    if (!people.some((p) => p.role === "parent" && rows.some((row) => row.id === p.id))) throw new HttpError(409, "Set up Liendo Plaza first.");
    const person = people.find((p) => p.id === body.personId);
    if (!person) throw new HttpError(400, "Pick a person.");
    const id = person.id;
    if (!body.code) {
      if (person.role === "parent" && !people.some((p) => p.role === "parent" && p.id !== id && rows.some((row) => row.id === p.id))) {
        throw new HttpError(409, "Keep at least one parent code. Set a new code instead.");
      }
      await tx.delete(schema.familyCodes).where(eq(schema.familyCodes.id, id));
      return;
    }
    parse(person.role === "parent" ? parentCode : kidCode, body.code);
    if (person.role === "parent" && body.confirmation !== body.code) throw new HttpError(400, "The codes do not match.");
    for (const other of people.filter((p) => p.role === person.role && p.id !== id)) {
      const row = rows.find((row) => row.id === other.id);
      if (row && await bcrypt.compare(body.code, row.hash)) throw new HttpError(409, "Each person needs a different code.");
    }
    const hash = await hashPin(body.code);
    await tx.insert(schema.familyCodes).values({ id, hash }).onConflictDoUpdate({
      target: schema.familyCodes.id, set: { hash },
    });
  });
}
