import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import type { Person } from "@liendo/shared";
import { getDb, schema } from "./db";
import { HttpError } from "./http";

export const DISPLAY_COOKIE = "lp_display";
export const SESSION_COOKIE = "lp_session";

const FAMILY_TTL_MS = 15 * 60 * 1000;
const SESSION_DAYS = 180;
const DISPLAY_DAYS = 400;
const PIN_LOCK_AFTER = 5;
const PIN_LOCK_MINUTES = 15;
const BCRYPT_ROUNDS = 12;

export type Actor =
  | { kind: "person"; person: Person }
  | { kind: "display" }
  | { kind: "family" }
  | { kind: "cron" };

function secret(): string {
  const value = process.env.FAMILY_ACCESS_SECRET;
  if (!value || value.length < 16) {
    throw new HttpError(500, "FAMILY_ACCESS_SECRET is missing or too short.");
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function signedToken(kind: string, ttlMs: number): string {
  const body = Buffer.from(
    JSON.stringify({ k: kind, exp: Date.now() + ttlMs, n: randomBytes(8).toString("hex") }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

function readSigned(token: string, kind: string): boolean {
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const expected = sign(body);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as { k: string; exp: number };
    return parsed.k === kind && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export function verifyFamilySecret(input: string): void {
  const expected = secret();
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, "That family code does not match.");
  }
}

export function issueFamilyToken(): string {
  return signedToken("family", FAMILY_TTL_MS);
}

export function verifyFamilyToken(token: string): void {
  if (!readSigned(token, "family")) {
    throw new HttpError(401, "That family code expired. Enter it again.");
  }
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

export function pinLooksValid(pin: string, length: 4 | 6): boolean {
  return new RegExp(`^\\d{${length}}$`).test(pin);
}

function asPerson(row: typeof schema.people.$inferSelect): Person {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role as Person["role"],
    color: row.color,
  };
}

export async function loginWithPin(personId: string, pin: string): Promise<{ token: string; person: Person }> {
  const db = getDb();
  const [person] = await db.select().from(schema.people).where(eq(schema.people.id, personId)).limit(1);
  if (!person || !person.pinHash) {
    throw new HttpError(401, "That name or PIN is wrong.");
  }
  if (person.pinLockedUntil && person.pinLockedUntil.getTime() > Date.now()) {
    throw new HttpError(423, "This PIN is locked for a few minutes. Try again later.");
  }

  const ok = await bcrypt.compare(pin, person.pinHash);
  if (!ok) {
    const attempts = person.pinFailedAttempts + 1;
    const locked =
      attempts >= PIN_LOCK_AFTER ? new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000) : null;
    await db
      .update(schema.people)
      .set({ pinFailedAttempts: attempts, pinLockedUntil: locked })
      .where(eq(schema.people.id, person.id));
    if (locked) {
      throw new HttpError(423, "Too many wrong PINs. Locked for 15 minutes.");
    }
    throw new HttpError(401, "That PIN is wrong.");
  }

  await db
    .update(schema.people)
    .set({ pinFailedAttempts: 0, pinLockedUntil: null })
    .where(eq(schema.people.id, person.id));

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(schema.sessions).values({
    personId: person.id,
    tokenHash: sha256(token),
    expiresAt,
  });
  return { token, person: asPerson(person) };
}

export async function personFromSession(token: string): Promise<Person | null> {
  const db = getDb();
  const [row] = await db
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      person: schema.people,
    })
    .from(schema.sessions)
    .innerJoin(schema.people, eq(schema.sessions.personId, schema.people.id))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return row ? asPerson(row.person) : null;
}

export async function revokeSession(token: string) {
  const db = getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
}

export async function pairDisplay(): Promise<string> {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  await db.insert(schema.displayPairings).values({ tokenHash: sha256(token) });
  return token;
}

export async function displayFromToken(token: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.displayPairings)
    .where(eq(schema.displayPairings.tokenHash, sha256(token)))
    .limit(1);
  if (!row) return false;
  await db
    .update(schema.displayPairings)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.displayPairings.id, row.id));
  return true;
}

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

function cookieFromRequest(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function requireActor(req: Request, allow: Actor["kind"][] = ["person", "display"]): Promise<Actor> {
  if (allow.includes("cron")) {
    const cron = process.env.CRON_SECRET;
    const header = req.headers.get("authorization");
    if (cron && header === `Bearer ${cron}`) return { kind: "cron" };
  }

  const token = bearer(req) ?? cookieFromRequest(req, SESSION_COOKIE);
  if (token && allow.includes("person")) {
    const person = await personFromSession(token);
    if (person) return { kind: "person", person };
  }

  const display = cookieFromRequest(req, DISPLAY_COOKIE) ?? req.headers.get("x-display-token");
  if (display && allow.includes("display") && (await displayFromToken(display))) {
    return { kind: "display" };
  }

  const family = req.headers.get("x-family-token");
  if (family && allow.includes("family")) {
    verifyFamilyToken(family);
    return { kind: "family" };
  }

  throw new HttpError(401, "Sign in first.");
}

export function requireParent(actor: Actor): Person {
  if (actor.kind !== "person" || actor.person.role !== "parent") {
    throw new HttpError(403, "Only a parent can do that.");
  }
  return actor.person;
}

export function requirePerson(actor: Actor): Person {
  if (actor.kind !== "person") {
    throw new HttpError(401, "Sign in with your name and PIN.");
  }
  return actor.person;
}

export async function setDisplayCookie(token: string) {
  const jar = await cookies();
  jar.set(DISPLAY_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DISPLAY_DAYS * 24 * 60 * 60,
  });
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearAuthCookies() {
  const jar = await cookies();
  jar.delete(DISPLAY_COOKIE);
  jar.delete(SESSION_COOKIE);
}

export async function setPersonPin(personId: string, pin: string, length: 4 | 6) {
  if (!pinLooksValid(pin, length)) {
    throw new HttpError(400, `Use a ${length}-digit PIN.`);
  }
  const db = getDb();
  await db
    .update(schema.people)
    .set({
      pinHash: await hashPin(pin),
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    })
    .where(eq(schema.people.id, personId));
}
