import { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import type { DisplaySnapshot, RewardRequest } from "@liendo/shared";
import { weekDates } from "@liendo/shared";
import { TabIcon } from "@/components/tab-icon";
import { api } from "@/lib/api";
import { useMe } from "@/lib/query";
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
  const me = useMe().data?.actor.person ?? null;
  const isParent = me?.role === "parent";
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.paper },
        headerTitleStyle: { fontFamily: type.display, color: colors.ink },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.paper,
          borderTopColor: colors.rule,
          height: 84,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontFamily: type.body, fontWeight: "500" },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: "Today",
          tabBarIcon: ({ focused }) => <TabIcon name="today" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Week",
          tabBarIcon: ({ focused }) => <TabIcon name="calendar" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="meals"
        options={{
          title: "Dinner",
          tabBarIcon: ({ focused }) => <TabIcon name="meals" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="stars"
        options={{
          title: "Stars",
          tabBarIcon: ({ focused }) => <TabIcon name="stars" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="parent"
        options={{
          title: "Manage",
          href: isParent ? "/parent/chores" : null,
          tabBarBadge: isParent && pending > 0 ? pending : undefined,
          tabBarIcon: ({ focused }) => <TabIcon name="parent" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
