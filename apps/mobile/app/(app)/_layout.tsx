import { Tabs } from "expo-router";
import { colors, type } from "@/lib/theme";

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.paper },
        headerTitleStyle: { fontFamily: type.display, color: colors.ink },
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.rule, height: 64 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen name="today" options={{ title: "Today" }} />
      <Tabs.Screen name="calendar" options={{ title: "Week" }} />
      <Tabs.Screen name="meals" options={{ title: "Dinner" }} />
      <Tabs.Screen name="stars" options={{ title: "Stars" }} />
      <Tabs.Screen name="parent" options={{ title: "Parents", href: "/parent/chores" }} />
    </Tabs>
  );
}
