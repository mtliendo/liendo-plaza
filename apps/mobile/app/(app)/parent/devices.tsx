import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { colors, muted, screen } from "@/lib/theme";

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
    <ScrollView contentContainerStyle={screen}>
      {devices.map((device) => (
        <View key={device.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.rule, paddingBottom: 12, minHeight: 64 }}>
          <Text style={{ fontSize: 18, color: colors.ink }}>{device.label}</Text>
          <Text style={muted}>{device.kind}</Text>
          {device.personName ? <Text style={muted}>{device.personName}</Text> : null}
          <Pressable
            onPress={async () => {
              try {
                await api(`devices/${device.id}`, { method: "DELETE" });
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not revoke that device.");
              }
            }}
            style={{ marginTop: 8, minHeight: 48, justifyContent: "center" }}
          >
            <Text style={{ color: colors.accent }}>Revoke</Text>
          </Pressable>
        </View>
      ))}
      {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
    </ScrollView>
  );
}
