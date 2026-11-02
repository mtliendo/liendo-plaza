import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { focusManager, onlineManager, QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { DISPLAY_REFETCH_MS, patchChore, QUERY_GC_MS, QUERY_STALE_MS, queryKeys, weekDates, type DisplaySnapshot, type Person } from "@liendo/shared";
import { AppState, type AppStateStatus } from "react-native";
import { useEffect, type ReactNode } from "react";
import { api } from "./api";

const client = new QueryClient({
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

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(Boolean(state.isConnected))),
);

function onAppState(status: AppStateStatus) {
  focusManager.setFocused(status === "active");
}

export function QueryProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, []);
  return (
    <PersistQueryClientProvider client={client} persistOptions={{ persister, maxAge: QUERY_GC_MS }}>
      {children}
    </PersistQueryClientProvider>
  );
}

function week() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const days = weekDates(today);
  return { today, from: days[0], to: days[6] };
}

export function useSnapshot(enabled = true) {
  const { from, to } = week();
  return useQuery({
    queryKey: queryKeys.snapshot(from, to, null),
    queryFn: () => api(`snapshot?from=${from}&to=${to}`) as Promise<DisplaySnapshot>,
    enabled,
    refetchInterval: DISPLAY_REFETCH_MS,
  });
}

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api("me") as Promise<{ actor: { person?: Person } }>,
    retry: false,
  });
}

export function usePrefetchHouse() {
  const queryClient = useQueryClient();
  return () => {
    const { from, to } = week();
    void queryClient.prefetchQuery({
      queryKey: queryKeys.snapshot(from, to, null),
      queryFn: () => api(`snapshot?from=${from}&to=${to}`) as Promise<DisplaySnapshot>,
    });
    void queryClient.prefetchQuery({ queryKey: queryKeys.chores, queryFn: () => api("chores") });
    void queryClient.prefetchQuery({ queryKey: queryKeys.rewards, queryFn: () => api("rewards") });
    void queryClient.prefetchQuery({ queryKey: queryKeys.requests, queryFn: () => api("rewards/requests") });
  };
}

export function useChoreToggle() {
  const queryClient = useQueryClient();
  const { from, to } = week();
  const key = queryKeys.snapshot(from, to, null);
  return useMutation({
    mutationFn: ({ id, undo }: { id: string; undo?: boolean }) =>
      api(`chores/instances/${id}/${undo ? "undo" : "complete"}`, { method: "POST" }),
    onMutate: async ({ id, undo }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DisplaySnapshot>(key);
      if (previous) queryClient.setQueryData(key, patchChore(previous, id, undo ? "open" : "done"));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
