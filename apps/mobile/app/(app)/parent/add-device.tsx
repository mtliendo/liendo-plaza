import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api } from "@/lib/api";

type Pending = { id: string; displayCode: string; label: string | null; deviceKind: string };
type Invite = { webUrl: string; deepLink: string; qrDataUrl: string };

export default function AddDeviceScreen() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadPending = useCallback(async () => {
    const body = (await api("pair/pending")) as { requests: Pending[] };
    setPending(body.requests);
  }, []);

  useEffect(() => {
    void loadPending().catch(() => undefined);
    const timer = setInterval(() => void loadPending().catch(() => undefined), 4000);
    return () => clearInterval(timer);
  }, [loadPending]);

  async function approve(next: string) {
    setError("");
    try {
      const body = (await api("pair/approve", { method: "POST", body: JSON.stringify({ code: next }) })) as {
        label?: string;
        displayCode?: string;
      };
      setMessage(`${body.label ?? "That device"} is approved.`);
      setCode("");
      await loadPending();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve that device.");
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text>Type the short code from the kitchen frame or another phone.</Text>
      <TextInput
        value={code}
        onChangeText={(value) => setCode(value.toUpperCase())}
        autoCapitalize="characters"
        placeholder="AB3-K7M"
        style={{ borderWidth: 1, borderColor: "#3D2416", padding: 14, minHeight: 48, backgroundColor: "#FBF6EA" }}
      />
      <Pressable onPress={() => void approve(code)} style={{ backgroundColor: "#C24A2A", padding: 16 }}>
        <Text style={{ color: "#FBF6EA", textAlign: "center" }}>Approve this device</Text>
      </Pressable>
      {pending.map((item) => (
        <Pressable key={item.id} onPress={() => void approve(item.displayCode)} style={{ padding: 12, backgroundColor: "#FBF6EA" }}>
          <Text style={{ fontSize: 22 }}>{item.displayCode}</Text>
          <Text>{item.label ?? item.deviceKind}</Text>
        </Pressable>
      ))}
      <Pressable
        onPress={async () => {
          try {
            setInvite((await api("pair/invite", { method: "POST", body: JSON.stringify({ deviceKind: "phone" }) })) as Invite);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not make an invite.");
          }
        }}
        style={{ borderBottomWidth: 2, borderBottomColor: "#3D2416", paddingVertical: 12 }}
      >
        <Text>Invite a new phone</Text>
      </Pressable>
      {invite ? (
        <View style={{ alignItems: "center", gap: 12 }}>
          <Image source={{ uri: invite.qrDataUrl }} style={{ width: 240, height: 240 }} />
          <Text selectable>{invite.webUrl}</Text>
          <Text selectable>{invite.deepLink}</Text>
        </View>
      ) : null}
      {message ? <Text>{message}</Text> : null}
      {error ? <Text style={{ color: "#9B2C1A" }}>{error}</Text> : null}
    </ScrollView>
  );
}
