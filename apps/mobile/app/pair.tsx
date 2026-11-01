import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "@/lib/api";
import { getSession } from "@/lib/session";

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
    <View style={{ flex: 1, backgroundColor: "#F3E6C8", padding: 24, justifyContent: "center", gap: 16 }}>
      <Text style={{ fontFamily: "Georgia", fontSize: 32, color: "#3D2416" }}>Add a device</Text>
      <Text>{message}</Text>
      {error ? <Text style={{ color: "#9B2C1A" }}>{error}</Text> : null}
      <Pressable onPress={() => router.replace("/(app)/today")}>
        <Text>Back to today</Text>
      </Pressable>
    </View>
  );
}
