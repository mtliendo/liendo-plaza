import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Reward, RewardRequest, StarSummary } from "@liendo/shared";
import { startOfWeekSunday, addDays } from "@liendo/shared";
import { getDb, schema } from "./db";
import { HttpError } from "./http";
import { todayIso } from "./time";

export async function starSummaries(): Promise<StarSummary[]> {
  const db = getDb();
  const people = await db.select().from(schema.people);
  const weekStart = startOfWeekSunday(todayIso());
  const weekEnd = addDays(weekStart, 6);

  const earned = await db
    .select({
      personId: schema.choreInstances.personId,
      total: sql<number>`coalesce(sum(${schema.choreInstances.starsAwarded}), 0)`.mapWith(Number),
    })
    .from(schema.choreInstances)
    .groupBy(schema.choreInstances.personId);

  const week = await db
    .select({
      personId: schema.choreInstances.personId,
      total: sql<number>`coalesce(sum(${schema.choreInstances.starsAwarded}), 0)`.mapWith(Number),
    })
    .from(schema.choreInstances)
    .where(and(gte(schema.choreInstances.date, weekStart), lte(schema.choreInstances.date, weekEnd)))
    .groupBy(schema.choreInstances.personId);

  const spent = await db
    .select({
      personId: schema.rewardRequests.personId,
      total: sql<number>`coalesce(sum(${schema.rewards.starCost}), 0)`.mapWith(Number),
    })
    .from(schema.rewardRequests)
    .innerJoin(schema.rewards, eq(schema.rewardRequests.rewardId, schema.rewards.id))
    .where(eq(schema.rewardRequests.status, "approved"))
    .groupBy(schema.rewardRequests.personId);

  return people
    .filter((person) => person.role === "kid")
    .map((person) => {
      const earnedTotal = earned.find((row) => row.personId === person.id)?.total ?? 0;
      const spentTotal = spent.find((row) => row.personId === person.id)?.total ?? 0;
      return {
        personId: person.id,
        personName: person.name,
        color: person.color,
        avatarKey: person.avatarKey ?? person.slug,
        balance: earnedTotal - spentTotal,
        weekEarned: week.find((row) => row.personId === person.id)?.total ?? 0,
      };
    });
}

export async function listRewards(activeOnly = false): Promise<Reward[]> {
  const db = getDb();
  const rows = await db.select().from(schema.rewards);
  return rows
    .filter((row) => (activeOnly ? row.active : true))
    .map((row) => ({
      id: row.id,
      name: row.name,
      starCost: row.starCost,
      active: row.active,
    }));
}

export async function listRewardRequests(): Promise<RewardRequest[]> {
  const db = getDb();
  const rows = await db
    .select({
      request: schema.rewardRequests,
      reward: schema.rewards,
      person: schema.people,
    })
    .from(schema.rewardRequests)
    .innerJoin(schema.rewards, eq(schema.rewardRequests.rewardId, schema.rewards.id))
    .innerJoin(schema.people, eq(schema.rewardRequests.personId, schema.people.id));
  return rows
    .map(({ request, reward, person }) => ({
      id: request.id,
      rewardId: request.rewardId,
      rewardName: reward.name,
      starCost: reward.starCost,
      personId: request.personId,
      personName: person.name,
      status: request.status as RewardRequest["status"],
      createdAt: request.createdAt.toISOString(),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function requestReward(rewardId: string, personId: string): Promise<RewardRequest> {
  const db = getDb();
  const [reward] = await db.select().from(schema.rewards).where(eq(schema.rewards.id, rewardId)).limit(1);
  if (!reward || !reward.active) throw new HttpError(404, "That reward is not on the list.");
  const stars = await starSummaries();
  const summary = stars.find((row) => row.personId === personId);
  if (!summary || summary.balance < reward.starCost) {
    throw new HttpError(400, "Not enough stars yet.");
  }
  const [row] = await db.insert(schema.rewardRequests).values({ rewardId, personId }).returning();
  const [person] = await db.select().from(schema.people).where(eq(schema.people.id, personId)).limit(1);
  return {
    id: row.id,
    rewardId,
    rewardName: reward.name,
    starCost: reward.starCost,
    personId,
    personName: person?.name ?? "",
    status: "pending",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function reviewReward(id: string, action: "approve" | "reject", reviewerId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      request: schema.rewardRequests,
      reward: schema.rewards,
    })
    .from(schema.rewardRequests)
    .innerJoin(schema.rewards, eq(schema.rewardRequests.rewardId, schema.rewards.id))
    .where(eq(schema.rewardRequests.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, "That request is gone.");
  if (row.request.status !== "pending") throw new HttpError(400, "Already reviewed.");
  if (action === "approve") {
    const stars = await starSummaries();
    const summary = stars.find((item) => item.personId === row.request.personId);
    if (!summary || summary.balance < row.reward.starCost) {
      throw new HttpError(400, "Not enough stars left.");
    }
  }
  const [updated] = await db
    .update(schema.rewardRequests)
    .set({
      status: action === "approve" ? "approved" : "rejected",
      reviewedAt: new Date(),
      reviewedById: reviewerId,
    })
    .where(eq(schema.rewardRequests.id, id))
    .returning();
  return updated;
}
