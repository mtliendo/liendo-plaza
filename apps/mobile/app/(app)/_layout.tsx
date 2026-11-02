import { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import type { DisplaySnapshot, RewardRequest } from "@liendo/shared";
import { weekDates } from "@liendo/shared";
import { api } from "@/lib/api";
import { colors, type } from "@/lib/theme";

function usePendingApprovals() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
        const week = weekDates(today);
        const [snap, rewardRes] = await Promise.all([
          api(`snapshot?from=${week[0]}&to=${week[6]}`) as Promise<DisplaySnapshot>,
          api("rewards/requests") as Promise<{ requests: RewardRequest[] }>,
        ]);
        const chores = snap.chores.filter((item) => item.status === "pending").length;
        const rewards = (rewardRes.requests ?? []).filter((item) => item.status === "pending").length;
        if (alive) setCount(chores + rewards);
      } catch {
        if (alive) setCount(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return count;
}

export default function AppLayout() {
  const pending = usePendingApprovals();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.paper },
        headerTitleStyle: { fontFamily: type.display, color: colors.ink },
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.rule, height: 64 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontFamily: type.body },
      }}
    >
      <Tabs.Screen name="today" options={{ title: "Today" }} />
      <Tabs.Screen name="calendar" options={{ title: "Week" }} />
      <Tabs.Screen name="meals" options={{ title: "Dinner" }} />
      <Tabs.Screen name="stars" options={{ title: "Stars" }} />
      <Tabs.Screen
        name="parent"
        options={{
          title: "Manage",
          href: "/parent/chores",
          tabBarBadge: pending > 0 ? pending : undefined,
        }}
      />
    </Tabs>
  );
}
