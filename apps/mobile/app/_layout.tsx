import "react-native-gesture-handler";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import { SplashHouse } from "@/components/splash-house";
import { QueryProviders } from "@/lib/query";
import { colors, type } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 400, fade: true });

const HOLD_MS = 2200;
const REDUCED_HOLD_MS = 900;

export default function RootLayout() {
  const [loaded] = useFonts({
    Fraunces: require("../assets/fonts/Fraunces.ttf"),
    "Fraunces-Italic": require("../assets/fonts/Fraunces-Italic.ttf"),
    Figtree: require("../assets/fonts/Figtree.ttf"),
  });
  const reduced = useReducedMotion();
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    void SplashScreen.hideAsync();
    const hold = reduced ? REDUCED_HOLD_MS : HOLD_MS;
    const timer = setTimeout(() => setSplashDone(true), hold);
    return () => clearTimeout(timer);
  }, [loaded, reduced]);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <QueryProviders>
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
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
          <Stack.Screen name="chore/[id]" options={{ title: "Chore" }} />
        </Stack>
        {splashDone ? null : (
          <View style={{ position: "absolute", inset: 0, zIndex: 20 }}>
            <SplashHouse playing />
          </View>
        )}
      </View>
    </QueryProviders>
    </GestureHandlerRootView>
  );
}
