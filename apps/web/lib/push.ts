import { and, eq, ne, sql } from "drizzle-orm";
import { apnsConfig, sendAPNs, type APNsEnvironment } from "./apns";
import { getDb, schema } from "./db";
import { HttpError } from "./http";

type PushKind = "expo" | "apns";
type PushRegistration = { token: string; kind: PushKind; environment: APNsEnvironment };

type PushMessage = {
  to: string;
  title: string;
  body: string;
  sound?: "default";
  data?: Record<string, string>;
  kind?: PushKind;
  environment?: APNsEnvironment;
};

export function parsePushRegistration(input: unknown): PushRegistration {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Invalid push registration.");
  }
  const body = input as { token?: unknown; kind?: unknown; environment?: unknown };
  if (typeof body.token !== "string" || !body.token || body.token.length > 512) {
    throw new HttpError(400, "Missing or invalid push token.");
  }
  const kind = body.kind ?? "expo";
  if (kind !== "expo" && kind !== "apns") throw new HttpError(400, "Invalid push kind.");
  const environment = body.environment ?? (kind === "expo" ? "production" : undefined);
  if (environment !== "sandbox" && environment !== "production") throw new HttpError(400, "Invalid push environment.");
  if (kind === "apns" && (!/^[a-f0-9]+$/i.test(body.token) || body.token.length % 2 !== 0)) {
    throw new HttpError(400, "Invalid APNs token.");
  }
  return { token: kind === "apns" ? body.token.toLowerCase() : body.token, kind, environment };
}

export async function registerPushToken(personId: string, registration: PushRegistration) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${registration.token}, 0))`);
    if (registration.kind === "apns") {
      await tx.delete(schema.pushTokens).where(and(
        eq(schema.pushTokens.token, registration.token), eq(schema.pushTokens.kind, "apns"),
        eq(schema.pushTokens.environment, registration.environment), ne(schema.pushTokens.personId, personId),
      ));
    }
    await tx.insert(schema.pushTokens).values({ personId, ...registration }).onConflictDoUpdate({
      target: [schema.pushTokens.personId, schema.pushTokens.token],
      set: { kind: registration.kind, environment: registration.environment, createdAt: new Date() },
    });
  });
}

export async function unregisterPushToken(personId: string, registration: PushRegistration) {
  await getDb().delete(schema.pushTokens).where(and(
    eq(schema.pushTokens.personId, personId), eq(schema.pushTokens.token, registration.token),
    eq(schema.pushTokens.kind, registration.kind), eq(schema.pushTokens.environment, registration.environment),
  ));
}

export async function tokensFor(personIds: string[]) {
  if (!personIds.length) return [];
  const db = getDb();
  const rows = await db.select().from(schema.pushTokens);
  return rows.filter((row) => personIds.includes(row.personId));
}

export async function sendPush(messages: PushMessage[]) {
  if (!messages.length) return;
  const native = messages.filter((message) => message.kind === "apns");
  const config = apnsConfig();
  if (native.length && !config) console.warn("APNs not configured; skipping native push.");
  await Promise.all(native.map(async (message) => {
    if (!config) return;
    try {
      const environment = message.environment ?? "production";
      const result = await sendAPNs(message.to, environment, message, config);
      if ((result.status === 410 && result.reason === "Unregistered") ||
          (result.status === 400 && result.reason === "BadDeviceToken")) {
        await getDb().delete(schema.pushTokens).where(and(
          eq(schema.pushTokens.kind, "apns"), eq(schema.pushTokens.environment, environment),
          eq(schema.pushTokens.token, message.to),
        ));
      } else if (result.status !== 200) {
        console.warn("APNs rejected push", result);
      }
    } catch {
      console.warn("APNs send failed; token retained.");
    }
  }));
  const expo = messages.filter((message) => message.kind !== "apns")
    .map(({ to, title, body, sound, data }) => ({ to, title, body, sound, data }));
  if (!expo.length) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(expo),
    });
  } catch (error) {
    console.warn("push send failed", error);
  }
}

export async function notifyParents(title: string, body: string) {
  const db = getDb();
  const parents = await db.select().from(schema.people).where(eq(schema.people.role, "parent"));
  const tokens = await tokensFor(parents.map((row) => row.id));
  await sendPush(tokens.map((row) => ({ to: row.token, kind: row.kind, environment: row.environment, title, body, sound: "default" })));
}

export async function notifyPerson(personId: string, title: string, body: string, kind?: PushKind, data?: Record<string, string>) {
  const tokens = await tokensFor([personId]);
  await sendPush(tokens.filter((row) => !kind || row.kind === kind)
    .map((row) => ({ to: row.token, kind: row.kind, environment: row.environment, title, body, sound: "default", data })));
}
