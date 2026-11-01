import { Stack } from "expo-router";

export default function ParentLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: "#F3E6C8" }, headerTitleStyle: { fontFamily: "Georgia" } }}>
      <Stack.Screen name="chores" options={{ title: "Chores" }} />
      <Stack.Screen name="approvals" options={{ title: "Approvals" }} />
      <Stack.Screen name="rewards" options={{ title: "Rewards" }} />
      <Stack.Screen name="meals" options={{ title: "Plan dinners" }} />
      <Stack.Screen name="pins" options={{ title: "PINs" }} />
    </Stack>
  );
}
