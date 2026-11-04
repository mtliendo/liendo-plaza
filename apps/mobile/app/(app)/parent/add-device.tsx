import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api } from "@/lib/api";
import { body, btn, btnLabel, colors, curve, h2, input, muted, screen } from "@/lib/theme";

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
    <ScrollView contentContainerStyle={screen}>
      <Text style={body}>Type the short code from the kitchen frame or another phone.</Text>
      <TextInput
        value={code}
        onChangeText={(value) => setCode(value.toUpperCase())}
        autoCapitalize="characters"
        placeholder="AB3-K7M"
        style={input}
      />
      <Pressable onPress={() => void approve(code)} style={btn}>
        <Text style={btnLabel}>Approve this device</Text>
      </Pressable>
      {pending.map((item) => (
        <Pressable key={item.id} onPress={() => void approve(item.displayCode)} style={{ padding: 16, backgroundColor: colors.paper2, minHeight: 64, ...curve.card }}>
          <Text style={h2}>{item.displayCode}</Text>
          <Text style={muted}>{item.label ?? item.deviceKind}</Text>
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
        style={{ borderBottomWidth: 1, borderBottomColor: colors.ink, paddingVertical: 16, minHeight: 64, justifyContent: "center" }}
      >
        <Text style={{ color: colors.ink }}>Invite a new phone</Text>
      </Pressable>
      {invite ? (
        <View style={{ alignItems: "center", gap: 12, backgroundColor: colors.paper2, padding: 20, ...curve.sheet }}>
          <Image source={{ uri: invite.qrDataUrl }} style={{ width: 240, height: 240, ...curve.card }} />
          <Text selectable style={muted}>{invite.webUrl}</Text>
          <Text selectable style={muted}>{invite.deepLink}</Text>
        </View>
      ) : null}
      {message ? <Text style={body}>{message}</Text> : null}
      {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
    </ScrollView>
  );
}
