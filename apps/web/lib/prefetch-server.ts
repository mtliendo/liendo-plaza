import { dehydrate, QueryClient } from "@tanstack/react-query";
import { cookies } from "next/headers";
import { queryKeys, weekDates } from "@liendo/shared";
import { DISPLAY_COOKIE, SESSION_COOKIE, displayFromToken, personFromSession } from "./auth";
import { listChores } from "./chores";
import { buildSnapshot } from "./snapshot";
import { listRewardRequests, listRewards } from "./stars";
import { todayIso } from "./time";

export async function dehydrateHouse(kind: "display" | "family") {
  const client = new QueryClient();
  const jar = await cookies();
  const today = todayIso();
  const week = weekDates(today);
  try {
    if (kind === "display") {
      const token = jar.get(DISPLAY_COOKIE)?.value;
      if (!token || !(await displayFromToken(token))) return dehydrate(client);
    } else {
      const token = jar.get(SESSION_COOKIE)?.value;
      const person = token ? await personFromSession(token) : null;
      if (!person) return dehydrate(client);
      await client.prefetchQuery({ queryKey: queryKeys.chores, queryFn: listChores });
      await client.prefetchQuery({ queryKey: queryKeys.rewards, queryFn: () => listRewards() });
      await client.prefetchQuery({ queryKey: queryKeys.requests, queryFn: listRewardRequests });
    }
    await client.prefetchQuery({
      queryKey: queryKeys.snapshot(week[0], week[6], null),
      queryFn: () => buildSnapshot(week[0], week[6]),
    });
  } catch {
    // First paint can fetch on the client if the cookie is stale.
  }
  return dehydrate(client);
}
