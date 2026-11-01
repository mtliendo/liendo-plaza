import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import QRCode from "qrcode";
import type { Person } from "@liendo/shared";
import { issueFamilyToken, loginWithPin, pairDisplay, setDisplayCookie } from "./auth";
import { getDb, getPool, schema } from "./db";
import { HttpError } from "./http";
import { asPerson } from "./person";

export const PAIR_TTL_MS = 10 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type DeviceKind = "display" | "phone" | "browser";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizePairCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export function formatPairCode(code: string): string {
  const clean = normalizePairCode(code);
  if (clean.length !== 6) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3)}`;
}

function randomShortCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

async function qrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    width: 360,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#3D2416", light: "#FBF6EA" },
  });
}

export function defaultDeviceLabel(kind: DeviceKind, userAgent = ""): string {
  if (kind === "display") return "Kitchen frame";
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Macintosh/i.test(userAgent)) return "Mac";
  return kind === "phone" ? "Phone" : "Browser";
}

export async function expireStalePairingRequests() {
  await getPool().query(
    `UPDATE pairing_requests SET status = 'expired' WHERE status IN ('pending', 'approved') AND expires_at < now()`,
  );
}

export async function bootstrapAvailable(): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.devices.id })
    .from(schema.devices)
    .innerJoin(schema.people, eq(schema.devices.personId, schema.people.id))
    .where(and(eq(schema.people.role, "parent"), isNull(schema.devices.revokedAt)))
    .limit(1);
  return rows.length === 0;
}

export async function listParents(): Promise<Person[]> {
  const db = getDb();
  const rows = await db.select().from(schema.people).where(eq(schema.people.role, "parent"));
  return rows.map(asPerson);
}

export async function bootstrapStatus() {
  const available = await bootstrapAvailable();
  return {
    available,
    parents: available ? await listParents() : [],
  };
}

export async function bootstrapParent(input: {
  personId: string;
  pin: string;
  deviceKind?: DeviceKind;
  deviceLabel?: string;
  userAgent?: string;
  cookie?: boolean;
}) {
  if (!(await bootstrapAvailable())) {
    throw new HttpError(403, "A parent phone is already paired. Ask them to open Add a device.");
  }
  const db = getDb();
  const [person] = await db.select().from(schema.people).where(eq(schema.people.id, input.personId)).limit(1);
  if (!person || person.role !== "parent") {
    throw new HttpError(403, "The first device has to be a parent.");
  }
  const kind = input.deviceKind === "phone" ? "phone" : "browser";
  const label = input.deviceLabel?.trim() || defaultDeviceLabel(kind, input.userAgent);
  return loginWithPin(input.personId, input.pin, { kind, label, createdById: person.id, cookie: input.cookie });
}

export async function createClaim(input: { deviceKind: DeviceKind; label?: string; userAgent?: string }) {
  await expireStalePairingRequests();
  const db = getDb();
  const pollSecret = randomBytes(24).toString("base64url");
  const kind = input.deviceKind;
  const label = input.label?.trim() || defaultDeviceLabel(kind, input.userAgent);
  const expiresAt = new Date(Date.now() + PAIR_TTL_MS);

  let row: typeof schema.pairingRequests.$inferSelect | undefined;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const shortCode = randomShortCode();
    try {
      const [created] = await db
        .insert(schema.pairingRequests)
        .values({
          kind: "claim",
          deviceKind: kind,
          shortCode,
          requestSecretHash: hash(pollSecret),
          status: "pending",
          deviceLabel: label,
          expiresAt,
        })
        .returning();
      row = created;
      break;
    } catch {
      // unique short code collision
    }
  }
  if (!row?.shortCode) {
    throw new HttpError(500, "Could not make a pairing code. Try again.");
  }

  const pairUrl = `${appUrl()}/family/pair?code=${row.shortCode}`;
  return {
    id: row.id,
    shortCode: row.shortCode,
    displayCode: formatPairCode(row.shortCode),
    pairUrl,
    qrDataUrl: await qrDataUrl(pairUrl),
    pollSecret,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function pollClaim(id: string, pollSecret: string) {
  const db = getDb();
  const [row] = await db.select().from(schema.pairingRequests).where(eq(schema.pairingRequests.id, id)).limit(1);
  if (!row || row.requestSecretHash !== hash(pollSecret) || row.kind !== "claim") {
    throw new HttpError(404, "That pairing request is gone.");
  }
  if (row.status === "redeemed") {
    return { status: "paired" as const };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    if (row.status === "pending" || row.status === "approved") {
      await db.update(schema.pairingRequests).set({ status: "expired" }).where(eq(schema.pairingRequests.id, row.id));
    }
    return { status: "expired" as const };
  }
  if (row.status === "pending") {
    return { status: "pending" as const, expiresAt: row.expiresAt.toISOString() };
  }
  if (row.status !== "approved") {
    return { status: row.status };
  }

  const [claimed] = await db
    .update(schema.pairingRequests)
    .set({ status: "redeemed", redeemedAt: new Date() })
    .where(and(eq(schema.pairingRequests.id, row.id), eq(schema.pairingRequests.status, "approved")))
    .returning();
  if (!claimed) {
    return { status: "paired" as const };
  }

  if (row.deviceKind === "display") {
    const token = await pairDisplay(row.deviceLabel ?? "Kitchen frame", row.approvedById ?? undefined);
    await setDisplayCookie(token);
    return { status: "paired" as const, token };
  }

  return { status: "paired" as const, familyToken: issueFamilyToken() };
}

export async function approveClaim(code: string, parent: Person) {
  await expireStalePairingRequests();
  const shortCode = normalizePairCode(code);
  if (shortCode.length !== 6) {
    throw new HttpError(400, "Use the 6-character code from the other screen.");
  }
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.pairingRequests)
    .where(and(eq(schema.pairingRequests.shortCode, shortCode), eq(schema.pairingRequests.status, "pending")))
    .limit(1);
  if (!row) {
    throw new HttpError(404, "No device is waiting with that code.");
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await db.update(schema.pairingRequests).set({ status: "expired" }).where(eq(schema.pairingRequests.id, row.id));
    throw new HttpError(410, "That code expired. Ask the other screen to show a new one.");
  }
  await db
    .update(schema.pairingRequests)
    .set({ status: "approved", approvedById: parent.id })
    .where(eq(schema.pairingRequests.id, row.id));
  return { ok: true, deviceKind: row.deviceKind, label: row.deviceLabel, displayCode: formatPairCode(shortCode) };
}

export async function listPendingClaims() {
  await expireStalePairingRequests();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.pairingRequests)
    .where(and(eq(schema.pairingRequests.kind, "claim"), eq(schema.pairingRequests.status, "pending")))
    .orderBy(desc(schema.pairingRequests.createdAt));
  const now = Date.now();
  return rows
    .filter((row) => row.expiresAt.getTime() > now && row.shortCode)
    .map((row) => ({
      id: row.id,
      displayCode: formatPairCode(row.shortCode ?? ""),
      shortCode: row.shortCode,
      deviceKind: row.deviceKind,
      label: row.deviceLabel,
      expiresAt: row.expiresAt.toISOString(),
    }));
}

export async function createInvite(parent: Person, deviceKind: DeviceKind = "phone") {
  await expireStalePairingRequests();
  const db = getDb();
  const inviteToken = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + PAIR_TTL_MS);
  const kind = deviceKind === "display" ? "phone" : deviceKind;
  await db.insert(schema.pairingRequests).values({
    kind: "invite",
    deviceKind: kind,
    requestSecretHash: hash(randomBytes(16).toString("hex")),
    inviteTokenHash: hash(inviteToken),
    status: "pending",
    approvedById: parent.id,
    deviceLabel: kind === "phone" ? "New phone" : "New browser",
    expiresAt,
  });
  const webUrl = `${appUrl()}/family?invite=${inviteToken}`;
  const deepLink = `liendoplaza://?invite=${inviteToken}`;
  return {
    webUrl,
    deepLink,
    qrDataUrl: await qrDataUrl(webUrl),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function redeemInvite(inviteToken: string) {
  await expireStalePairingRequests();
  const token = inviteToken.trim();
  if (!token) throw new HttpError(400, "Missing invite.");
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.pairingRequests)
    .where(eq(schema.pairingRequests.inviteTokenHash, hash(token)))
    .limit(1);
  if (!row || row.kind !== "invite") {
    throw new HttpError(404, "That invite is not valid.");
  }
  if (row.status === "redeemed") {
    throw new HttpError(410, "That invite was already used.");
  }
  if (row.status !== "pending" || row.expiresAt.getTime() < Date.now()) {
    if (row.status === "pending") {
      await db.update(schema.pairingRequests).set({ status: "expired" }).where(eq(schema.pairingRequests.id, row.id));
    }
    throw new HttpError(410, "That invite expired. Ask a parent for a new one.");
  }
  await db
    .update(schema.pairingRequests)
    .set({ status: "redeemed", redeemedAt: new Date() })
    .where(eq(schema.pairingRequests.id, row.id));
  return { familyToken: issueFamilyToken() };
}

export async function listDevices() {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.devices.id,
      kind: schema.devices.kind,
      label: schema.devices.label,
      personName: schema.people.name,
      personRole: schema.people.role,
      personColor: schema.people.color,
      personAvatarKey: schema.people.avatarKey,
      createdAt: schema.devices.createdAt,
      lastSeenAt: schema.devices.lastSeenAt,
      revokedAt: schema.devices.revokedAt,
    })
    .from(schema.devices)
    .leftJoin(schema.people, eq(schema.devices.personId, schema.people.id))
    .where(isNull(schema.devices.revokedAt))
    .orderBy(desc(schema.devices.createdAt));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    personName: row.personName,
    personRole: row.personRole,
    personColor: row.personColor,
    personAvatarKey: row.personAvatarKey,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  }));
}

export async function revokeDevice(id: string) {
  const db = getDb();
  const [device] = await db.select().from(schema.devices).where(eq(schema.devices.id, id)).limit(1);
  if (!device || device.revokedAt) {
    throw new HttpError(404, "That device is not on the list.");
  }
  const now = new Date();
  await db.update(schema.devices).set({ revokedAt: now }).where(eq(schema.devices.id, device.id));
  if (device.sessionId) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, device.sessionId));
  }
  if (device.displayPairingId) {
    await db
      .update(schema.displayPairings)
      .set({ revokedAt: now })
      .where(eq(schema.displayPairings.id, device.displayPairingId));
  }
  return { ok: true };
}

export async function touchDevice(deviceId: string | null | undefined) {
  if (!deviceId) return;
  const db = getDb();
  await db.update(schema.devices).set({ lastSeenAt: new Date() }).where(eq(schema.devices.id, deviceId));
}
