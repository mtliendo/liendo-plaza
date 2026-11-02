"use client";

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DISPLAY_REFETCH_MS,
  QUERY_GC_MS,
  QUERY_STALE_MS,
  applyRewardDecision,
  parseEventFixture,
  patchChore,
  patchMeal,
  patchRewardRequest,
  pendingReward,
  queryKeys,
  weekDates,
  type Chore,
  type DisplaySnapshot,
  type Person,
  type Reward,
  type RewardRequest,
} from "@liendo/shared";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_MS,
        gcTime: QUERY_GC_MS,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 1,
      },
    },
  });
}

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

export function QueryProviders({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  const [message, setMessage] = useState<string | null>(null);
  const toast = useCallback((next: string) => {
    setMessage(next);
    window.setTimeout(() => setMessage((current) => (current === next ? null : current)), 4200);
  }, []);
  return (
    <QueryClientProvider client={client}>
      <ToastContext.Provider value={toast}>
        {children}
        {message ? (
          <p className="banner" role="status" data-testid="toast">
            {message}
          </p>
        ) : null}
      </ToastContext.Provider>
    </QueryClientProvider>
  );
}

export function weekWindow() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const week = weekDates(today);
  return { today, from: week[0], to: week[6] };
}

export function currentFixture() {
  if (typeof window === "undefined") return null;
  return parseEventFixture(new URLSearchParams(window.location.search).get("fixture"));
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

export async function fetchMe() {
  const res = await fetch("/api/me", { cache: "no-store" });
  if (res.status === 401) return { actor: null as { kind?: string; person?: Person } | null };
  if (!res.ok) throw new Error("Could not read who is signed in.");
  return (await res.json()) as { actor: { kind?: string; person?: Person } | null };
}

export async function fetchSnapshot(from: string, to: string, fixture: string | null) {
  const suffix = fixture ? `&fixture=${fixture}` : "";
  return readJson<DisplaySnapshot>(`/api/snapshot?from=${from}&to=${to}${suffix}`);
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: fetchMe, retry: false });
}

export function useSnapshot(enabled = true, refetchInterval?: number | false) {
  const { from, to } = weekWindow();
  const fixture = currentFixture();
  return useQuery({
    queryKey: queryKeys.snapshot(from, to, fixture),
    queryFn: () => fetchSnapshot(from, to, fixture),
    enabled,
    refetchInterval,
  });
}

export function useHouseLists(enabled = true) {
  const chores = useQuery({
    queryKey: queryKeys.chores,
    queryFn: () => readJson<{ chores: Chore[] }>("/api/chores").then((body) => body.chores),
    enabled,
  });
  const rewards = useQuery({
    queryKey: queryKeys.rewards,
    queryFn: () => readJson<{ rewards: Reward[] }>("/api/rewards").then((body) => body.rewards),
    enabled,
  });
  const requests = useQuery({
    queryKey: queryKeys.requests,
    queryFn: () => readJson<{ requests: RewardRequest[] }>("/api/rewards/requests").then((body) => body.requests),
    enabled,
  });
  return { chores, rewards, requests };
}

export function usePrefetchHouse() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    const { from, to } = weekWindow();
    const fixture = currentFixture();
    void queryClient.prefetchQuery({
      queryKey: queryKeys.snapshot(from, to, fixture),
      queryFn: () => fetchSnapshot(from, to, fixture),
    });
    void queryClient.prefetchQuery({
      queryKey: queryKeys.chores,
      queryFn: () => readJson<{ chores: Chore[] }>("/api/chores").then((body) => body.chores),
    });
    void queryClient.prefetchQuery({
      queryKey: queryKeys.rewards,
      queryFn: () => readJson<{ rewards: Reward[] }>("/api/rewards").then((body) => body.rewards),
    });
    void queryClient.prefetchQuery({
      queryKey: queryKeys.requests,
      queryFn: () => readJson<{ requests: RewardRequest[] }>("/api/rewards/requests").then((body) => body.requests),
    });
  }, [queryClient]);
}

function snapshotKey() {
  const { from, to } = weekWindow();
  return queryKeys.snapshot(from, to, currentFixture());
}

export function useChoreToggle() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ id, undo }: { id: string; undo?: boolean }) => {
      const path = undo ? `/api/chores/instances/${id}/undo` : `/api/chores/instances/${id}/complete`;
      return readJson<{ instance: { id: string } }>(path, { method: "POST" });
    },
    onMutate: async ({ id, undo }) => {
      const key = snapshotKey();
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DisplaySnapshot>(key);
      if (previous) {
        queryClient.setQueryData(key, patchChore(previous, id, undo ? "open" : "done"));
      }
      return { previous, key };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast("Could not update that chore.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(weekWindow().from, weekWindow().to, currentFixture()) });
    },
  });
}

export function useChoreReview() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      readJson(`/api/chores/instances/${id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      }),
    onMutate: async ({ id, action }) => {
      const key = snapshotKey();
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DisplaySnapshot>(key);
      if (previous) {
        queryClient.setQueryData(key, patchChore(previous, id, action === "approve" ? "done" : "rejected"));
      }
      return { previous, key };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast("Could not review that chore.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["snapshot"] });
    },
  });
}

export function useRewardRequest(person?: Person | null) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (rewardId: string) =>
      readJson<{ request: RewardRequest }>("/api/rewards/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rewardId }),
      }),
    onMutate: async (rewardId) => {
      const key = queryKeys.requests;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RewardRequest[]>(key) ?? [];
      const rewards = queryClient.getQueryData<Reward[]>(queryKeys.rewards) ?? [];
      const reward = rewards.find((item) => item.id === rewardId);
      if (reward && person) {
        queryClient.setQueryData(key, patchRewardRequest(previous, pendingReward(reward, person.id, person.name)));
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.requests, context.previous);
      toast("Could not ask for that reward.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.requests });
    },
  });
}

export function useRewardReview() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      readJson(`/api/rewards/requests/${id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      }),
    onMutate: async ({ id, action }) => {
      const snapKey = snapshotKey();
      await queryClient.cancelQueries({ queryKey: snapKey });
      await queryClient.cancelQueries({ queryKey: queryKeys.requests });
      const previousSnap = queryClient.getQueryData<DisplaySnapshot>(snapKey);
      const previousRequests = queryClient.getQueryData<RewardRequest[]>(queryKeys.requests) ?? [];
      const request = previousRequests.find((item) => item.id === id);
      if (previousSnap && request) {
        const next = applyRewardDecision(previousSnap, previousRequests, request, action);
        queryClient.setQueryData(snapKey, next.snapshot);
        queryClient.setQueryData(queryKeys.requests, next.requests);
      }
      return { previousSnap, previousRequests, snapKey };
    },
    onError: (_error, _vars, context) => {
      if (context?.previousSnap) queryClient.setQueryData(context.snapKey, context.previousSnap);
      if (context?.previousRequests) queryClient.setQueryData(queryKeys.requests, context.previousRequests);
      toast("Could not review that reward.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["snapshot"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.requests });
    },
  });
}

export function useMealEdit() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ date, name }: { date: string; name: string }) =>
      readJson("/api/meals", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, name }),
      }),
    onMutate: async ({ date, name }) => {
      const key = snapshotKey();
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DisplaySnapshot>(key);
      if (previous) queryClient.setQueryData(key, patchMeal(previous, date, { name }));
      return { previous, key };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast("Could not save that dinner.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["snapshot"] });
    },
  });
}

export function useSoftView<T extends string>(initial: T, hrefs: Record<T, string>) {
  const [view, setView] = useState(initial);
  const go = useCallback(
    (next: T) => {
      setView(next);
      const path = hrefs[next];
      const search = typeof window === "undefined" ? "" : window.location.search;
      if (typeof window !== "undefined" && window.location.pathname !== path) {
        window.history.pushState({ view: next }, "", `${path}${search}`);
      }
    },
    [hrefs],
  );

  useEffect(() => {
    const onPop = () => {
      const match = (Object.entries(hrefs) as [T, string][]).find(([, href]) => href === window.location.pathname);
      if (match) setView(match[0]);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [hrefs]);

  return [view, go] as const;
}

export const DISPLAY_REFETCH = DISPLAY_REFETCH_MS;
