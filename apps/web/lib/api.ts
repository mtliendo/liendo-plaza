import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { fixturesAllowed, parseEventFixture, buildEventFixture } from "@liendo/shared";
import { addDays, weekDates } from "@liendo/shared";
import {
  clearAuthCookies,
  requireActor,
  requireParent,
  requirePerson,
  revokeSession,
  setSessionCookie,
  sessionTokenFromRequest,
} from "./auth";
import {
  approveClaim,
  bootstrapStatus,
  createClaim,
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
  getChore,
  listChores,
  listPendingInstances,
  markPhotoPending,
  reviewInstance,
  undoInstance,
  updateChore,
} from "./chores";
import { getDb, schema } from "./db";
import { deleteStoredPhoto, readPhoto, readUpload, replaceStoredPhoto, storePhoto } from "./blob";
import { HttpError, errorResponse, json, readJson } from "./http";
import { notifyParents, notifyPerson, parsePushRegistration, registerPushToken, unregisterPushToken } from "./push";
import { clientIp, rateLimit } from "./rate-limit";
import { getDisplayRefreshRequestedAt, getSettings, requestDisplayRefresh, updateSettings } from "./settings";
import { buildSnapshot } from "./snapshot";
import { householdCached, invalidateHousehold } from "./household-cache";
import { listRewardRequests, listRewards, requestReward, reviewReward, starSummaries } from "./stars";
import { mealSuggestions, mealsInRange, peopleList } from "./snapshot";
import { calendarWindow, todayIso } from "./time";
import { getWeather } from "./weather";
import { applyChores, choreSchema, proposalRequest, proposeChores } from "./chore-agent";
import { changeFamilyCode, codeSettings, familyCodeStatus, loginWithFamilyCode, setupFamilyCodes } from "./family-codes";

function pathOf(req: Request) {
  return new URL(req.url).pathname.replace(/^\/api\/?/, "");
}

async function ownsChoreInstance(personId: string, choreIds: string[]): Promise<boolean> {
  if (!choreIds.length) return false;
  const [instance] = await getDb().select({ id: schema.choreInstances.id }).from(schema.choreInstances)
    .where(and(eq(schema.choreInstances.personId, personId), inArray(schema.choreInstances.choreId, choreIds)))
    .limit(1);
  return Boolean(instance);
}

export async function handleApi(req: Request): Promise<Response> {
  let response: Response;
  try {
    response = await dispatchApi(req);
  } catch (error) {
    response = errorResponse(error);
  }
  if (req.method !== "GET" && response.ok) invalidateHousehold();
  response.headers.set("cache-control", "private, no-store");
  response.headers.append("vary", "Authorization, Cookie, X-Display-Token, X-Family-Token");
  return response;
}

const cachedDisplayRefreshRequestedAt = householdCached(getDisplayRefreshRequestedAt, "display-refresh");
// Changes whenever the household tag is invalidated, so the display can poll it without touching Neon.
const cachedHouseholdRevision = householdCached(async () => new Date().toISOString(), "household-revision");

async function dispatchApi(req: Request): Promise<Response> {
  const path = pathOf(req);
  const method = req.method;
  const url = new URL(req.url);
  if ((path === "agent/chores/propose" || path === "agent/chores/apply") && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    const parent = requireParent(actor);
    if (path.endsWith("/propose")) {
      rateLimit(`chore-agent:${parent.id}`, 20, 600_000);
      return json(await proposeChores(proposalRequest.parse(await readJson(req))));
    }
    const body = z.object({ changes: z.array(z.unknown()).max(50) }).parse(await readJson(req));
    return json(await applyChores(body.changes));
  }

  if (path === "health" && method === "GET") {
    return json({ ok: true });
  }

  if (path === "version" && method === "GET") {
    const buildId = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev";
    let refreshRequestedAt: string | null = null;
    try {
      refreshRequestedAt = await cachedDisplayRefreshRequestedAt();
    } catch {
      refreshRequestedAt = null;
    }
    // Only a paired display gets the revision; it would otherwise reveal when the household changes.
    const paired = await requireActor(req, ["display"]).then(() => true, () => false);
    const revision = paired ? await cachedHouseholdRevision().catch(() => null) : null;
    return json({ buildId, refreshRequestedAt, revision }, 200, { "cache-control": "no-store, must-revalidate" });
  }

  if (path === "display/refresh" && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const refreshRequestedAt = await requestDisplayRefresh();
    return json({ ok: true, refreshRequestedAt });
  }

  if (path === "auth/family" && method === "POST") {
    throw new HttpError(410, "Enter your family code to sign in.");
  }

  if (path === "auth/display" && method === "POST") {
    throw new HttpError(410, "Pair this kitchen board using its QR or short code.");
  }

  if (path === "auth/codes/status" && method === "GET") {
    const actor = await requireActor(req, ["person"]).catch((error: unknown) => {
      if (error instanceof HttpError && error.status === 401) return null;
      throw error;
    });
    return json(await familyCodeStatus(actor?.kind === "person" ? actor.person : undefined), 200, { "cache-control": "no-store" });
  }

  if (path === "auth/codes/setup" && method === "POST") {
    const parent = requireParent(await requireActor(req, ["person"]));
    rateLimit(`setup:${clientIp(req)}`, 10, 60_000);
    const body = await readJson<Record<string, unknown>>(req);
    if (body.personId !== parent.id) throw new HttpError(403, "Set up using your own parent profile.");
    const kind = body.deviceKind === "phone" ? "phone" : "browser";
    const result = await setupFamilyCodes(body, { kind, label: defaultDeviceLabel(kind, req.headers.get("user-agent") ?? "") });
    if (body.cookie === true) await setSessionCookie(result.token);
    return json(result, 200, { "cache-control": "no-store" });
  }

  if (path === "auth/codes" && (method === "GET" || method === "POST")) {
    requireParent(await requireActor(req, ["person"]));
    if (method === "GET") return json(await codeSettings(), 200, { "cache-control": "no-store" });
    await changeFamilyCode(await readJson(req));
    return json({ ok: true });
  }

  if (path === "auth/login" && method === "POST") {
    rateLimit(`login:${clientIp(req)}`, 20, 60_000);
    const body = await readJson<{
      code?: string;
      cookie?: boolean;
      deviceKind?: "phone" | "browser";
      deviceLabel?: string;
    }>(req);
    const kind = body.deviceKind === "phone" ? "phone" : "browser";
    const result = await loginWithFamilyCode(typeof body.code === "string" ? body.code : "", {
      kind,
      label: body.deviceLabel?.trim() || defaultDeviceLabel(kind, req.headers.get("user-agent") ?? ""),
    });
    if (body.cookie) await setSessionCookie(result.token);
    return json(result, 200, { "cache-control": "no-store" });
  }

  if (path === "auth/logout" && method === "POST") {
    const token = sessionTokenFromRequest(req);
    if (token) await revokeSession(token);
    await clearAuthCookies();
    return json({ ok: true });
  }

  if (path === "pair/status" && method === "GET") {
    return json(await bootstrapStatus());
  }

  if (path === "pair/bootstrap" && method === "POST") {
    throw new HttpError(410, "Enter your family code to sign in.");
  }

  if (path === "pair/claim" && method === "POST") {
    rateLimit(`claim:${clientIp(req)}`, 20, 60_000);
    const body = await readJson<{ deviceKind?: "display" | "phone" | "browser"; label?: string }>(req);
    if (body.deviceKind && body.deviceKind !== "display") throw new HttpError(410, "Phones and browsers sign in with a family code.");
    const deviceKind = "display";
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
    throw new HttpError(410, "Phones and browsers sign in with a family code.");
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
    const actor = await requireActor(req, ["person", "display"]);
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const snapshot = await buildSnapshot(from, to, { cached: actor.kind === "display" });
    if (actor.kind === "person" && actor.person.role === "kid") {
      snapshot.chores = snapshot.chores.filter((instance) => instance.personId === actor.person.id);
    }
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
    const actor = await requireActor(req, ["person", "display"]);
    const chores = await listChores();
    return json({ chores: actor.kind === "person" && actor.person.role === "kid"
      ? chores.filter((chore) => chore.assignedPersonId === actor.person.id) : chores });
  }

  if (path === "chores" && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const body = choreSchema.parse(await readJson(req));
    return json({
      chore: await createChore({
        ...body,
        weekdays: body.weekdays ?? null,
        weeklyWeekday: body.weeklyWeekday ?? null,
        onceDate: body.onceDate ?? null,
        description: body.description ?? null,
        steps: body.steps ?? [],
        guidePhotoPath: null,
      }),
    }, 201);
  }

  const choreMatch = path.match(/^chores\/([^/]+)$/);
  if (choreMatch && method === "GET") {
    const actor = await requireActor(req, ["person", "display"]);
    const chore = await getChore(choreMatch[1]);
    if (actor.kind === "person" && actor.person.role === "kid" && chore.assignedPersonId !== actor.person.id &&
        !await ownsChoreInstance(actor.person.id, [chore.id])) {
      throw new HttpError(403, "That chore belongs to someone else.");
    }
    return json({ chore });
  }
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

  const guidePhoto = path.match(/^chores\/([^/]+)\/guide-photo$/);
  if (guidePhoto && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const current = await getChore(guidePhoto[1]);
    const stored = await replaceStoredPhoto(current.guidePhotoPath, await readUpload(req), "chore-guides");
    return json({ chore: await updateChore(guidePhoto[1], { guidePhotoPath: stored }) });
  }
  if (guidePhoto && method === "DELETE") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const current = await getChore(guidePhoto[1]);
    await deleteStoredPhoto(current.guidePhotoPath);
    return json({ chore: await updateChore(guidePhoto[1], { guidePhotoPath: null }) });
  }

  if (path === "chores/instances/pending" && method === "GET") {
    const actor = await requireActor(req, ["person"], { touchDevice: false });
    requireParent(actor);
    return json({ instances: await listPendingInstances() });
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
  if (rewardMatch && method === "DELETE") {
    const actor = await requireActor(req, ["person"]);
    requireParent(actor);
    const db = getDb();
    const [reward] = await db
      .update(schema.rewards)
      .set({ active: false })
      .where(eq(schema.rewards.id, rewardMatch[1]))
      .returning();
    return json({ reward });
  }

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
    const person = requirePerson(await requireActor(req, ["person"]));
    return json({ requests: await listRewardRequests(person) });
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
      const [existing] = await db.select().from(schema.meals).where(eq(schema.meals.date, body.date)).limit(1);
      await deleteStoredPhoto(existing?.photoPath);
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
    const db = getDb();
    const [existing] = await db.select().from(schema.meals).where(eq(schema.meals.date, date)).limit(1);
    const stored = await replaceStoredPhoto(existing?.photoPath, await readUpload(req), "meals");
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
    const [existing] = await db.select().from(schema.meals).where(eq(schema.meals.date, mealPhoto[1])).limit(1);
    await deleteStoredPhoto(existing?.photoPath);
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
    throw new HttpError(410, "Manage family codes under Family.");
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

  if ((path === "push/register" || path === "push/unregister") && method === "POST") {
    const actor = await requireActor(req, ["person"]);
    const person = requirePerson(actor);
    const body = parsePushRegistration(await readJson(req));
    if (path === "push/register") await registerPushToken(person.id, body);
    else await unregisterPushToken(person.id, body);
    return json({ ok: true });
  }

  const photoGet = path.match(/^photos\/(.+)$/);
  if (photoGet && method === "GET") {
    const actor = await requireActor(req, ["person", "display"]);
    const stored = decodeURIComponent(photoGet[1]);
    if (actor.kind === "person" && actor.person.role === "kid") {
      const db = getDb();
      const proofs = await db.select({ personId: schema.choreInstances.personId })
        .from(schema.choreInstances).where(eq(schema.choreInstances.photoPath, stored));
      if (proofs.some((proof) => proof.personId !== actor.person.id)) {
        throw new HttpError(403, "That proof belongs to someone else.");
      }
      if (!proofs.length) {
        const [meals, guides] = await Promise.all([
          db.select({ id: schema.meals.id }).from(schema.meals).where(eq(schema.meals.photoPath, stored)).limit(1),
          db.select({ id: schema.chores.id, assignedPersonId: schema.chores.assignedPersonId }).from(schema.chores)
            .where(eq(schema.chores.guidePhotoPath, stored)),
        ]);
        if (guides.length && !guides.some((guide) => guide.assignedPersonId === actor.person.id) &&
            !await ownsChoreInstance(actor.person.id, guides.map((guide) => guide.id))) {
          throw new HttpError(403, "That guide belongs to someone else.");
        }
        if (!meals.length && !guides.length) throw new HttpError(404, "Photo is gone.");
      }
    }
    const file = await readPhoto(stored);
    return new Response(file.body as unknown as BodyInit, {
      headers: {
        "content-type": file.contentType,
      },
    });
  }

  throw new HttpError(404, "Nothing at that address.");
}
