import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";

type Device = { id: string; kind: string; label: string; personName: string | null; lastSeenAt: string | null };

export default function DevicesScreen() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const body = (await api("devices")) as { devices: Device[] };
    setDevices(body.devices);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load devices."));
  }, [load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      {devices.map((device) => (
        <View key={device.id} style={{ borderBottomWidth: 1, borderBottomColor: "#3D2416", paddingBottom: 12 }}>
          <Text style={{ fontSize: 18 }}>{device.label}</Text>
          <Text style={{ color: "#5C3A24" }}>
            {device.kind}
            {device.personName ? ` · ${device.personName}` : ""}
          </Text>
          <Pressable
            onPress={async () => {
              try {
                await api(`devices/${device.id}`, { method: "DELETE" });
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not revoke that device.");
              }
            }}
            style={{ marginTop: 8 }}
          >
            <Text style={{ color: "#C24A2A" }}>Revoke</Text>
          </Pressable>
        </View>
      ))}
      {error ? <Text style={{ color: "#9B2C1A" }}>{error}</Text> : null}
    </ScrollView>
  );
}
