import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors, type } from "@/lib/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTitleStyle: { fontFamily: type.display, fontSize: 22, color: colors.ink },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.paper },
          contentStyle: { backgroundColor: colors.paper },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="pair" options={{ title: "Add a device" }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
