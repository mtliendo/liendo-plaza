import { Stack } from "expo-router";
import { colors, type } from "@/lib/theme";

export default function ParentLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.paper }, headerTitleStyle: { fontFamily: type.display, color: colors.ink } }}>
      <Stack.Screen name="chores" options={{ title: "Chores" }} />
      <Stack.Screen name="approvals" options={{ title: "Approvals" }} />
      <Stack.Screen name="rewards" options={{ title: "Rewards" }} />
      <Stack.Screen name="meals" options={{ title: "Plan dinners" }} />
      <Stack.Screen name="pins" options={{ title: "PINs" }} />
      <Stack.Screen name="add-device" options={{ title: "Add a device" }} />
      <Stack.Screen name="devices" options={{ title: "Devices" }} />
    </Stack>
  );
}
