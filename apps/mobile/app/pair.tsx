import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "@/lib/api";
import { getSession } from "@/lib/session";
import { body, colors, h1, screen } from "@/lib/theme";

export default function PairScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; invite?: string }>();
  const code = typeof params.code === "string" ? params.code : "";
  const [message, setMessage] = useState("Checking this phone…");
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const token = await getSession();
      if (!token) {
        router.replace(params.invite ? `/?invite=${params.invite}` : "/");
        return;
      }
      if (!code) {
        router.replace("/(app)/parent/add-device");
        return;
      }
      try {
        await api("pair/approve", { method: "POST", body: JSON.stringify({ code }) });
        setMessage("That device is approved. It should open on its own.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not approve that device.");
      }
    })();
  }, [code, params.invite, router]);

  return (
    <View style={{ ...screen, flex: 1, justifyContent: "center" }}>
      <Text style={h1}>Add a device</Text>
      <Text style={body}>{message}</Text>
      {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
      <Pressable onPress={() => router.replace("/(app)/today")}>
        <Text>Back to today</Text>
      </Pressable>
    </View>
  );
}
