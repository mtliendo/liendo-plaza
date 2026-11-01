import { Tabs } from "expo-router";

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#F3E6C8" },
        headerTitleStyle: { fontFamily: "Georgia" },
        tabBarStyle: { backgroundColor: "#F3E6C8", borderTopColor: "#3D2416", height: 64 },
        tabBarActiveTintColor: "#C24A2A",
        tabBarInactiveTintColor: "#5C3A24",
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
