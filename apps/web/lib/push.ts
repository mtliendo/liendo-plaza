import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";

type PushMessage = {
  to: string;
  title: string;
  body: string;
  sound?: "default";
  data?: Record<string, string>;
};

export async function registerPushToken(personId: string, token: string) {
  const db = getDb();
  await db
    .insert(schema.pushTokens)
    .values({ personId, token })
    .onConflictDoNothing({ target: [schema.pushTokens.personId, schema.pushTokens.token] });
}

export async function tokensFor(personIds: string[]): Promise<{ personId: string; token: string }[]> {
  if (!personIds.length) return [];
  const db = getDb();
  const rows = await db.select().from(schema.pushTokens);
  return rows.filter((row) => personIds.includes(row.personId));
}

export async function sendPush(messages: PushMessage[]) {
  if (!messages.length) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(messages),
    });
  } catch (error) {
    console.warn("push send failed", error);
  }
}

export async function notifyParents(title: string, body: string) {
  const db = getDb();
  const parents = await db.select().from(schema.people).where(eq(schema.people.role, "parent"));
  const tokens = await tokensFor(parents.map((row) => row.id));
  await sendPush(tokens.map((row) => ({ to: row.token, title, body, sound: "default" })));
}

export async function notifyPerson(personId: string, title: string, body: string) {
  const tokens = await tokensFor([personId]);
  await sendPush(tokens.map((row) => ({ to: row.token, title, body, sound: "default" })));
}
