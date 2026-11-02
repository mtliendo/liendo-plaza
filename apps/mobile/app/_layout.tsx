import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { QueryProviders } from "@/lib/query";
import { colors, type } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    Fraunces: require("../assets/fonts/Fraunces.ttf"),
    "Fraunces-Italic": require("../assets/fonts/Fraunces-Italic.ttf"),
    Figtree: require("../assets/fonts/Figtree.ttf"),
  });

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  }

  return (
    <QueryProviders>
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
    </QueryProviders>
  );
}
