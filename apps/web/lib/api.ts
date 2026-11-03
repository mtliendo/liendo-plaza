import { eq } from "drizzle-orm";
import { z } from "zod";
import { FAMILY, fixturesAllowed, parseEventFixture, buildEventFixture } from "@liendo/shared";
import { addDays, weekDates } from "@liendo/shared";
import {
  clearAuthCookies,
  loginWithPin,
  requireActor,
  requireParent,
  requirePerson,
  revokeSession,
  setPersonPin,
  setSessionCookie,
  verifyFamilyToken,
} from "./auth";
import {
  approveClaim,
  bootstrapParent,
  bootstrapStatus,
  createClaim,
  createInvite,
  defaultDeviceLabel,
  listDevices,
  listPendingClaims,
  pollClaim,
  redeemInvite,
  revokeDevice,
} from "./pair";
import { getCalendarEvents } from "./calendar";
import {
  completeInstance,
  createChore,
  deactivateChore,
  listChores,
  markPhotoPending,
  reviewInstance,
  undoInstance,
  updateChore,
} from "./chores";
import { getDb, schema } from "./db";
import { readPhoto, readUpload, storePhoto } from "./blob";
import { HttpError, json, readJson } from "./http";
import { notifyParents, notifyPerson, registerPushToken } from "./push";
import { clientIp, rateLimit } from "./rate-limit";
import { getDisplayRefreshRequestedAt, getSettings, requestDisplayRefresh, updateSettings } from "./settings";
import { buildSnapshot } from "./snapshot";
import { listRewardRequests, listRewards, requestReward, reviewReward, starSummaries } from "./stars";
import { mealSuggestions, mealsInRange, peopleList } from "./snapshot";
import { calendarWindow, todayIso } from "./time";
import { getWeather } from "./weather";

const choreSchema = z.object({
  title: z.string().min(1).max(80),
  assignedPersonId: z.string().uuid(),
  stars: z.number().int().min(1).max(50),
  requiresPhoto: z.boolean(),
  repeatType: z.enum(["daily", "weekdays", "weekly", "once"]),
  weekdays: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  weeklyWeekday: z.number().int().min(0).max(6).nullable().optional(),
  onceDate: z.string().nullable().optional(),
});

function pathOf(req: Request) {
  return new URL(req.url).pathname.replace(/^\/api\/?/, "");
}

function sessionToken(req: Request) {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export async function handleApi(req: Request): Promise<Response> {
  const path = pathOf(req);
  const method = req.method;
  const url = new URL(req.url);

  if (path === "health" && method === "GET") {
    return json({ ok: true });
  }

  if (path === "version" && method === "GET") {
    const buildId = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev";
    let refreshRequestedAt: string | null = null;
    try {
      refreshRequestedAt = await getDisplayRefreshRequestedAt();
    } catch {
      refreshRequestedAt = null;
    }
    return json({ buildId, refreshRequestedAt }, 200, { "cache-control": "no-store, must-revalidate" });
  }

  if (path === "display/refresh" && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const refreshRequestedAt = await requestDisplayRefresh();
    return json({ ok: true, refreshRequestedAt });
  }

  if (path === "auth/family" && method === "POST") {
    throw new HttpError(410, "Family codes are retired. Pair with a QR, a short code, or a parent PIN.");
  }

  if (path === "auth/display" && method === "POST") {
    throw new HttpError(410, "Family codes are retired. Pair this frame with the QR on the board.");
  }

  if (path === "auth/login" && method === "POST") {
    rateLimit(`login:${clientIp(req)}`, 20, 60_000);
    const body = await readJson<{
      familyToken?: string;
      personId?: string;
      pin?: string;
      cookie?: boolean;
      deviceKind?: "phone" | "browser";
      deviceLabel?: string;
    }>(req);
    if (!body.familyToken) throw new HttpError(401, "This device is not paired yet.");
    verifyFamilyToken(body.familyToken);
    if (!body.personId || !body.pin) throw new HttpError(400, "Pick a name and enter a PIN.");
    const kind = body.deviceKind === "phone" ? "phone" : "browser";
    const result = await loginWithPin(body.personId, body.pin, {
      kind,
      label: body.deviceLabel?.trim() || defaultDeviceLabel(kind, req.headers.get("user-agent") ?? ""),
      cookie: body.cookie,
    });
    if (body.cookie) await setSessionCookie(result.token);
    return json(result);
  }

  if (path === "auth/logout" && method === "POST") {
    const token = sessionToken(req);
    if (token) await revokeSession(token);
    await clearAuthCookies();
    return json({ ok: true });
  }

  if (path === "pair/status" && method === "GET") {
    return json(await bootstrapStatus());
  }

  if (path === "pair/bootstrap" && method === "POST") {
    rateLimit(`bootstrap:${clientIp(req)}`, 10, 60_000);
    const body = await readJson<{
      personId?: string;
      pin?: string;
      deviceKind?: "phone" | "browser";
      deviceLabel?: string;
      cookie?: boolean;
    }>(req);
    if (!body.personId || !body.pin) throw new HttpError(400, "Pick a parent and enter their PIN.");
    const result = await bootstrapParent({
      personId: body.personId,
      pin: body.pin,
      deviceKind: body.deviceKind,
      deviceLabel: body.deviceLabel,
      userAgent: req.headers.get("user-agent") ?? "",
      cookie: body.cookie,
    });
    return json(result);
  }

  if (path === "pair/claim" && method === "POST") {
    rateLimit(`claim:${clientIp(req)}`, 20, 60_000);
    const body = await readJson<{ deviceKind?: "display" | "phone" | "browser"; label?: string }>(req);
    const deviceKind = body.deviceKind === "phone" || body.deviceKind === "browser" ? body.deviceKind : "display";
    return json(
      await createClaim({
        deviceKind,
        label: body.label,
        userAgent: req.headers.get("user-agent") ?? "",
      }),
    );
  }

  if (path === "pair/poll" && method === "POST") {
    rateLimit(`poll:${clientIp(req)}`, 120, 60_000);
    const body = await readJson<{ id?: string; pollSecret?: string }>(req);
    if (!body.id || !body.pollSecret) throw new HttpError(400, "Missing pairing poll.");
    return json(await pollClaim(body.id, body.pollSecret));
  }

  if (path === "pair/approve" && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    const parent = requireParent(actor);
    const body = await readJson<{ code?: string }>(req);
    return json(await approveClaim(body.code ?? "", parent));
  }

  if (path === "pair/pending" && method === "GET") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    return json({ requests: await listPendingClaims() });
  }

  if (path === "pair/invite" && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    const parent = requireParent(actor);
    const body = await readJson<{ deviceKind?: "phone" | "browser" }>(req);
    return json(await createInvite(parent, body.deviceKind === "browser" ? "browser" : "phone"));
  }

  if (path === "pair/redeem" && method === "POST") {
    rateLimit(`redeem:${clientIp(req)}`, 20, 60_000);
    const body = await readJson<{ invite?: string }>(req);
    return json(await redeemInvite(body.invite ?? ""));
  }

  if (path === "devices" && method === "GET") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    return json({ devices: await listDevices() });
  }

  const deviceMatch = path.match(/^devices\/([^/]+)$/);
  if (deviceMatch && method === "DELETE") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    return json(await revokeDevice(deviceMatch[1]));
  }

  if (path === "people" && method === "GET") {
    await requireActor(req, ["person", "display", "family"]);
    return json({ people: await peopleList() });
  }

  if (path === "me" && method === "GET") {
    const actor = await requireActor(req, ["person", "display"]);
    return json({ actor });
  }

  if (path === "snapshot" && method === "GET") {
    await requireActor(req, ["person", "display"]);
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const snapshot = await buildSnapshot(from, to);
    const fixture = parseEventFixture(url.searchParams.get("fixture"));
    if (fixture && fixturesAllowed()) {
      snapshot.events = buildEventFixture(fixture, snapshot.now, snapshot.people);
    }
    return json(snapshot);
  }

  if (path === "calendar" && method === "GET") {
    await requireActor(req, ["person", "display"]);
    const window = calendarWindow(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
    return json({ events: await getCalendarEvents(window.from, window.to), ...window });
  }

  if (path === "weather" && method === "GET") {
    await requireActor(req, ["person", "display"]);
    return json({ weather: await getWeather() });
  }

  if (path === "chores" && method === "GET") {
    await requireActor(req, ["person", "display"]);
    return json({ chores: await listChores() });
  }

  if (path === "chores" && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const body = choreSchema.parse(await readJson(req));
    return json({ chore: await createChore({ ...body, weekdays: body.weekdays ?? null, weeklyWeekday: body.weeklyWeekday ?? null, onceDate: body.onceDate ?? null }) }, 201);
  }

  const choreMatch = path.match(/^chores\/([^/]+)$/);
  if (choreMatch && (method === "PATCH" || method === "DELETE")) {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    if (method === "DELETE") {
      await deactivateChore(choreMatch[1]);
      return json({ ok: true });
    }
    const body = choreSchema.partial().parse(await readJson(req));
    return json({ chore: await updateChore(choreMatch[1], body) });
  }

  const completeMatch = path.match(/^chores\/instances\/([^/]+)\/complete$/);
  if (completeMatch && method === "POST") {
    const actor = await requireActor(req, ["person", "display"]);
    const db = getDb();
    const [row] = await db.select().from(schema.choreInstances).where(eq(schema.choreInstances.id, completeMatch[1])).limit(1);
    if (!row) throw new HttpError(404, "That chore is not on the list.");
    if (actor.kind === "person" && actor.person.role !== "parent" && actor.person.id !== row.personId) {
      throw new HttpError(403, "That chore belongs to someone else.");
    }
    return json({ instance: await completeInstance(completeMatch[1]) });
  }

  const undoMatch = path.match(/^chores\/instances\/([^/]+)\/undo$/);
  if (undoMatch && method === "POST") {
    const actor = await requireActor(req, ["person", "display"]);
    const db = getDb();
    const [row] = await db.select().from(schema.choreInstances).where(eq(schema.choreInstances.id, undoMatch[1])).limit(1);
    if (!row) throw new HttpError(404, "That chore is not on the list.");
    if (actor.kind === "person" && actor.person.role !== "parent" && actor.person.id !== row.personId) {
      throw new HttpError(403, "That chore belongs to someone else.");
    }
    return json({ instance: await undoInstance(undoMatch[1]) });
  }

  const photoMatch = path.match(/^chores\/instances\/([^/]+)\/photo$/);
  if (photoMatch && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    const person = requirePerson(actor);
    const db = getDb();
    const [row] = await db.select().from(schema.choreInstances).where(eq(schema.choreInstances.id, photoMatch[1])).limit(1);
    if (!row) throw new HttpError(404, "That chore is not on the list.");
    if (person.role !== "parent" && person.id !== row.personId) {
      throw new HttpError(403, "That chore belongs to someone else.");
    }
    const stored = await storePhoto(await readUpload(req));
    const instance = await markPhotoPending(photoMatch[1], stored);
    await notifyParents("Photo waiting", `${person.name} sent a chore photo.`);
    return json({ instance });
  }

  const reviewMatch = path.match(/^chores\/instances\/([^/]+)\/review$/);
  if (reviewMatch && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    const parent = requireParent(actor);
    const body = await readJson<{ action?: "approve" | "reject" }>(req);
    if (body.action !== "approve" && body.action !== "reject") {
      throw new HttpError(400, "Approve or reject.");
    }
    const instance = await reviewInstance(reviewMatch[1], body.action, parent.id);
    await notifyPerson(
      instance.personId,
      body.action === "approve" ? "Chore approved" : "Try that chore again",
      body.action === "approve" ? `${instance.title} is done. Stars are in.` : `${instance.title} was sent back.`,
    );
    return json({ instance });
  }

  if (path === "rewards" && method === "GET") {
    await requireActor(req, ["person", "display"]);
    return json({ rewards: await listRewards() });
  }

  if (path === "rewards" && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const body = await readJson<{ name?: string; starCost?: number }>(req);
    if (!body.name || !body.starCost) throw new HttpError(400, "Name and star cost are required.");
    const db = getDb();
    const [reward] = await db.insert(schema.rewards).values({ name: body.name.trim(), starCost: body.starCost }).returning();
    return json({ reward }, 201);
  }

  const rewardMatch = path.match(/^rewards\/([^/]+)$/);
  if (rewardMatch && method === "PATCH") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const body = await readJson<{ name?: string; starCost?: number; active?: boolean }>(req);
    const db = getDb();
    const [reward] = await db
      .update(schema.rewards)
      .set({
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.starCost !== undefined ? { starCost: body.starCost } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      })
      .where(eq(schema.rewards.id, rewardMatch[1]))
      .returning();
    return json({ reward });
  }

  if (path === "rewards/requests" && method === "GET") {
    await requireActor(req, ["person"]);
    return json({ requests: await listRewardRequests() });
  }

  if (path === "rewards/requests" && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    const person = requirePerson(actor);
    const body = await readJson<{ rewardId?: string }>(req);
    if (!body.rewardId) throw new HttpError(400, "Pick a reward.");
    const request = await requestReward(body.rewardId, person.id);
    await notifyParents("Reward request", `${person.name} asked for ${request.rewardName}.`);
    return json({ request }, 201);
  }

  const rewardReview = path.match(/^rewards\/requests\/([^/]+)\/review$/);
  if (rewardReview && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    const parent = requireParent(actor);
    const body = await readJson<{ action?: "approve" | "reject" }>(req);
    if (body.action !== "approve" && body.action !== "reject") {
      throw new HttpError(400, "Approve or reject.");
    }
    const updated = await reviewReward(rewardReview[1], body.action, parent.id);
    await notifyPerson(
      updated.personId,
      body.action === "approve" ? "Reward approved" : "Reward not this time",
      body.action === "approve" ? "Stars came off. Enjoy it." : "Ask again another day.",
    );
    return json({ request: updated });
  }

  if (path === "stars" && method === "GET") {
    await requireActor(req, ["person", "display"]);
    return json({ stars: await starSummaries() });
  }

  if (path === "meals" && method === "GET") {
    await requireActor(req, ["person", "display"]);
    const today = todayIso();
    const week = weekDates(today);
    const from = url.searchParams.get("from") ?? week[0];
    const to = url.searchParams.get("to") ?? addDays(week[0], 6);
    return json({ meals: await mealsInRange(from, to) });
  }

  if (path === "meals" && (method === "PUT" || method === "POST")) {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const body = await readJson<{ date?: string; name?: string }>(req);
    if (!body.date) throw new HttpError(400, "Pick a day.");
    const db = getDb();
    const name = (body.name ?? "").trim();
    if (!name) {
      await db.delete(schema.meals).where(eq(schema.meals.date, body.date));
      return json({ meal: null });
    }
    const [meal] = await db
      .insert(schema.meals)
      .values({ date: body.date, name, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.meals.date, set: { name, updatedAt: new Date() } })
      .returning();
    return json({ meal: { date: meal.date, name: meal.name, photoPath: meal.photoPath ?? null } });
  }

  const mealPhoto = path.match(/^meals\/(\d{4}-\d{2}-\d{2})\/photo$/);
  if (mealPhoto && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const date = mealPhoto[1];
    const stored = await storePhoto(await readUpload(req), "meals");
    const db = getDb();
    const [existing] = await db.select().from(schema.meals).where(eq(schema.meals.date, date)).limit(1);
    const [meal] = existing
      ? await db
          .update(schema.meals)
          .set({ photoPath: stored, updatedAt: new Date() })
          .where(eq(schema.meals.date, date))
          .returning()
      : await db
          .insert(schema.meals)
          .values({ date, name: "Dinner", photoPath: stored, updatedAt: new Date() })
          .returning();
    return json({ meal: { date: meal.date, name: meal.name, photoPath: meal.photoPath ?? null } });
  }
  if (mealPhoto && method === "DELETE") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const db = getDb();
    const [meal] = await db
      .update(schema.meals)
      .set({ photoPath: null, updatedAt: new Date() })
      .where(eq(schema.meals.date, mealPhoto[1]))
      .returning();
    return json({ meal: meal ? { date: meal.date, name: meal.name, photoPath: null } : null });
  }

  if (path === "meals/suggest" && method === "GET") {
    await requireActor(req, ["person"]);
    return json({ names: await mealSuggestions(url.searchParams.get("q") ?? "") });
  }

  if (path === "pins" && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const body = await readJson<{ personId?: string; pin?: string }>(req);
    if (!body.personId || !body.pin) throw new HttpError(400, "Pick a person and a PIN.");
    const people = await peopleList();
    const target = people.find((person) => person.id === body.personId);
    if (!target) throw new HttpError(404, "No one by that name.");
    const length = FAMILY.find((row) => row.slug === target.slug)?.pinLength ?? (target.role === "parent" ? 6 : 4);
    await setPersonPin(target.id, body.pin, length);
    return json({ ok: true });
  }

  if (path === "settings" && method === "GET") {
    await requireActor(req, ["person", "display"]);
    return json({ settings: await getSettings() });
  }

  if (path === "settings" && method === "PATCH") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const body = await readJson<{ choreReminderHour?: number; choreReminderMinute?: number }>(req);
    return json({ settings: await updateSettings(body) });
  }

  if (path === "push/register" && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    const person = requirePerson(actor);
    const body = await readJson<{ token?: string }>(req);
    if (!body.token) throw new HttpError(400, "Missing push token.");
    await registerPushToken(person.id, body.token);
    return json({ ok: true });
  }

  const photoGet = path.match(/^photos\/(.+)$/);
  if (photoGet && method === "GET") {
    await requireActor(req, ["person", "display"]);
    const stored = decodeURIComponent(photoGet[1]);
    const file = await readPhoto(stored);
    return new Response(file.body as unknown as BodyInit, {
      headers: {
        "content-type": file.contentType,
        "cache-control": "private, max-age=3600",
      },
    });
  }

  throw new HttpError(404, "Nothing at that address.");
}
