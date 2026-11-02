import { eq } from "drizzle-orm";
import { ensureInstances } from "@/lib/chores";
import { getDb, schema } from "@/lib/db";
import { json } from "@/lib/http";
import { notifyPerson } from "@/lib/push";
import { getSettings } from "@/lib/settings";
import { nowCt, todayIso } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && header !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized." }, 401);
  }

  const settings = await getSettings();
  const now = nowCt();
  if (now.hour !== settings.choreReminderHour) {
    return json({ skipped: true, reason: "not the reminder hour" });
  }
  if (now.minute >= 15) {
    return json({ skipped: true, reason: "past the first quarter hour" });
  }

  const today = todayIso(now);
  const instances = await ensureInstances(today, today);
  const open = instances.filter((item) => item.status === "open" || item.status === "rejected");
  const byPerson = new Map<string, number>();
  for (const item of open) {
    byPerson.set(item.personId, (byPerson.get(item.personId) ?? 0) + 1);
  }

  const db = getDb();
  const kids = await db.select().from(schema.people).where(eq(schema.people.role, "kid"));
  let sent = 0;
  for (const kid of kids) {
    const count = byPerson.get(kid.id) ?? 0;
    if (!count) continue;
    await notifyPerson(
      kid.id,
      "Chores still open",
      count === 1 ? "One chore is still waiting." : `${count} chores are still waiting.`,
    );
    sent += 1;
  }

  return json({ sent, date: today });
}
