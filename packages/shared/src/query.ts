import type { ChoreInstance, ChoreStatus, DisplaySnapshot, Meal, Reward, RewardRequest } from "./types";

export const QUERY_STALE_MS = 45_000;
export const QUERY_GC_MS = 30 * 60 * 1000;
export const DISPLAY_REFETCH_MS = 60_000;

export const queryKeys = {
  me: ["me"] as const,
  snapshot: (from: string, to: string, fixture: string | null = null) =>
    ["snapshot", from, to, fixture ?? ""] as const,
  chores: ["chores"] as const,
  rewards: ["rewards"] as const,
  requests: ["requests"] as const,
  people: ["people"] as const,
  meals: (from: string, to: string) => ["meals", from, to] as const,
};

export function weekRange(now = new Date()) {
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - date.getDay());
  const pad = (value: number) => String(value).padStart(2, "0");
  const iso = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const days = Array.from({ length: 7 }, (_, index) => {
    const next = new Date(sunday);
    next.setDate(sunday.getDate() + index);
    return iso(next);
  });
  return { today, from: days[0], to: days[6], days };
}

function bumpStars(snapshot: DisplaySnapshot, personId: string, delta: number): DisplaySnapshot {
  if (!delta) return snapshot;
  return {
    ...snapshot,
    stars: snapshot.stars.map((row) =>
      row.personId === personId
        ? { ...row, balance: row.balance + delta, weekEarned: Math.max(0, row.weekEarned + delta) }
        : row,
    ),
  };
}

export function patchChore(
  snapshot: DisplaySnapshot,
  id: string,
  status: ChoreStatus,
  starsAwarded?: number,
): DisplaySnapshot {
  const current = snapshot.chores.find((item) => item.id === id);
  if (!current) return snapshot;
  const nextAwarded = starsAwarded ?? (status === "done" ? current.stars : 0);
  const next: ChoreInstance = { ...current, status, starsAwarded: nextAwarded };
  return bumpStars(
    { ...snapshot, chores: snapshot.chores.map((item) => (item.id === id ? next : item)) },
    current.personId,
    nextAwarded - current.starsAwarded,
  );
}

export function patchMeal(snapshot: DisplaySnapshot, date: string, patch: Partial<Meal>): DisplaySnapshot {
  const current = snapshot.meals.find((meal) => meal.date === date);
  const next = { date, name: current?.name ?? "", photoPath: current?.photoPath ?? null, ...patch };
  const meals = current
    ? snapshot.meals.map((meal) => (meal.date === date ? next : meal))
    : [...snapshot.meals, next];
  return { ...snapshot, meals };
}

export function patchRewardRequest(
  requests: RewardRequest[],
  next: RewardRequest,
): RewardRequest[] {
  const exists = requests.some((item) => item.id === next.id);
  return exists ? requests.map((item) => (item.id === next.id ? next : item)) : [next, ...requests];
}

export function applyRewardDecision(
  snapshot: DisplaySnapshot,
  requests: RewardRequest[],
  request: RewardRequest,
  action: "approve" | "reject",
): { snapshot: DisplaySnapshot; requests: RewardRequest[] } {
  const updated = { ...request, status: action === "approve" ? "approved" : "rejected" } as RewardRequest;
  return {
    snapshot:
      action === "approve" ? bumpStars(snapshot, request.personId, -request.starCost) : snapshot,
    requests: patchRewardRequest(requests, updated),
  };
}

export function pendingReward(reward: Reward, personId: string, personName: string): RewardRequest {
  return {
    id: `optimistic-${reward.id}-${Date.now()}`,
    rewardId: reward.id,
    rewardName: reward.name,
    starCost: reward.starCost,
    personId,
    personName,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}
