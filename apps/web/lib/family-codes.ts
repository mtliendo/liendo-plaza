import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
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
  kids: z.array(z.object({ personId: z.string().uuid(), code: kidCode })).default([]),
});
const changeSchema = z.object({ personId: z.string().uuid().optional(), code: z.string(), confirmation: z.string().optional() });
const lock = sql`select pg_advisory_xact_lock(18432, 5)`;

function parse<T extends z.ZodTypeAny>(definition: T, input: unknown): z.infer<T> {
  const result = definition.safeParse(input);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? "Check the codes and try again.");
  return result.data;
}

export async function familyCodeStatus() {
  const db = getDb();
  const [parent] = await db.select({ id: schema.familyCodes.id }).from(schema.familyCodes).where(eq(schema.familyCodes.id, "parent"));
  const people = parent ? [] : (await db.select().from(schema.people)).map(asPerson);
  return { setupRequired: !parent, people };
}

export async function setupFamilyCodes(input: unknown, device: DeviceAttach) {
  const body = parse(setupSchema, input);
  if (body.code !== body.confirmation) throw new HttpError(400, "The codes do not match.");
  if (new Set(body.kids.map((kid) => kid.code)).size !== body.kids.length ||
      new Set(body.kids.map((kid) => kid.personId)).size !== body.kids.length) {
    throw new HttpError(400, "Each kid needs a different code.");
  }
  const parent = await getDb().transaction(async (tx) => {
    await tx.execute(lock);
    const [existing] = await tx.select().from(schema.familyCodes).where(eq(schema.familyCodes.id, "parent"));
    if (existing) throw new HttpError(409, "Liendo Plaza is already set up. Enter your code.");
    const people = await tx.select().from(schema.people);
    const chosen = people.find((person) => person.id === body.personId && person.role === "parent");
    if (!chosen || body.kids.some((kid) => !people.some((p) => p.id === kid.personId && p.role === "kid"))) {
      throw new HttpError(400, "Pick a parent and valid kids.");
    }
    await tx.insert(schema.familyCodes).values({ id: "parent", hash: await hashPin(body.code) });
    for (const kid of body.kids) {
      await tx.insert(schema.familyCodes).values({ id: kid.personId, hash: await hashPin(kid.code) });
    }
    return asPerson(chosen);
  });
  return issuePersonSession(parent, device);
}

export async function loginWithFamilyCode(code: string, personId: string | undefined, device: DeviceAttach) {
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(lock);
    const rows = await tx.select().from(schema.familyCodes);
    const parent = rows.find((row) => row.id === "parent");
    if (!parent) return new HttpError(401, "That code is not recognized.");
    if (parent.lockedUntil && parent.lockedUntil.getTime() > Date.now()) {
      return new HttpError(423, "Too many tries. Try again in 5 minutes.");
    }
    let match: typeof parent | undefined;
    if (/^\d{4}$/.test(code) || /^\d{6,72}$/.test(code)) {
      for (const row of rows.filter((row) => code.length === 4 ? row.id !== "parent" : row.id === "parent")) {
        if (await bcrypt.compare(code, row.hash)) { match = row; break; }
      }
    }
    if (!match) {
      const attempts = parent.failedAttempts + 1;
      const lockedUntil = attempts >= 10 ? new Date(Date.now() + 5 * 60_000) : null;
      await tx.update(schema.familyCodes).set({ failedAttempts: attempts, lockedUntil }).where(eq(schema.familyCodes.id, "parent"));
      return new HttpError(lockedUntil ? 423 : 401, lockedUntil ? "Too many tries. Try again in 5 minutes." : "That code is not recognized.");
    }
    const people = await tx.select().from(schema.people);
    const eligible = people.filter((person) => match.id === "parent" ? person.role === "parent" : person.role === "kid" && person.id === match.id);
    if (eligible.some((person) => person.pinLockedUntil && person.pinLockedUntil.getTime() > Date.now())) {
      return new HttpError(423, "Too many tries. Try again in 15 minutes.");
    }
    await tx.update(schema.familyCodes).set({ failedAttempts: 0, lockedUntil: null }).where(eq(schema.familyCodes.id, "parent"));
    if (match.id === "parent" && eligible.length > 1 && !personId) return { parents: eligible.map(asPerson) };
    const person = personId ? eligible.find((person) => person.id === personId) : eligible[0];
    if (!person) return new HttpError(401, "That code is not recognized.");
    return { person: asPerson(person) };
  });
  if (result instanceof HttpError) throw result;
  if ("parents" in result) return result;
  return issuePersonSession(result.person, device);
}

export async function codeSettings() {
  const rows = await getDb().select({ id: schema.familyCodes.id }).from(schema.familyCodes);
  return { configuredPersonIds: rows.filter((row) => row.id !== "parent").map((row) => row.id), parentCodeSet: rows.some((row) => row.id === "parent") };
}

export async function changeFamilyCode(input: unknown) {
  const body = parse(changeSchema, input);
  if (!body.personId) {
    parse(parentCode, body.code);
    if (body.confirmation !== body.code) throw new HttpError(400, "The codes do not match.");
  } else if (body.code) parse(kidCode, body.code);
  await getDb().transaction(async (tx) => {
    await tx.execute(lock);
    const [parent] = await tx.select().from(schema.familyCodes).where(eq(schema.familyCodes.id, "parent"));
    if (!parent) throw new HttpError(409, "Set up Liendo Plaza first.");
    const id = body.personId ?? "parent";
    if (body.personId) {
      const [person] = await tx.select().from(schema.people).where(eq(schema.people.id, body.personId));
      if (person?.role !== "kid") throw new HttpError(400, "Pick a kid.");
      if (!body.code) { await tx.delete(schema.familyCodes).where(eq(schema.familyCodes.id, id)); return; }
      const rows = await tx.select().from(schema.familyCodes);
      for (const row of rows.filter((row) => row.id !== id)) {
        if (await bcrypt.compare(body.code, row.hash)) throw new HttpError(409, "Each kid needs a different code.");
      }
    }
    const hash = await hashPin(body.code);
    await tx.insert(schema.familyCodes).values({ id, hash }).onConflictDoUpdate({
      target: schema.familyCodes.id, set: { hash, failedAttempts: 0, lockedUntil: null },
    });
  });
}
