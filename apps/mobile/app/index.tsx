import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import type { Person } from "@liendo/shared";
import { API_URL } from "@/lib/config";
import { getSession, saveFamilyToken, saveSession } from "@/lib/session";
import { body, btn, btnLabel, colors, h1, h2, input, muted, personEdge, screen, type } from "@/lib/theme";

type Claim = { id: string; displayCode: string; qrDataUrl: string; pollSecret: string };

export default function AuthScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ invite?: string }>();
  const invite = typeof params.invite === "string" ? params.invite : "";
  const [familyToken, setFamilyToken] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [parents, setParents] = useState<Person[]>([]);
  const [bootstrap, setBootstrap] = useState(false);
  const [picked, setPicked] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [claim, setClaim] = useState<Claim | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await getSession();
      if (token) router.replace("/(app)/today");
    })();
  }, [router]);

  useEffect(() => {
    void (async () => {
      const statusRes = await fetch(`${API_URL}/api/pair/status`);
      const status = (await statusRes.json()) as { available?: boolean; parents?: Person[] };
      setBootstrap(Boolean(status.available));
      setParents(status.parents ?? []);

      if (invite) {
        try {
          const res = await fetch(`${API_URL}/api/pair/redeem`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ invite }),
          });
          const body = (await res.json()) as { familyToken?: string; error?: string };
          if (!res.ok || !body.familyToken) throw new Error(body.error ?? "That invite did not work.");
          await saveFamilyToken(body.familyToken);
          setFamilyToken(body.familyToken);
          const peopleRes = await fetch(`${API_URL}/api/people`, { headers: { "x-family-token": body.familyToken } });
          const peopleBody = (await peopleRes.json()) as { people: Person[] };
          setPeople(peopleBody.people);
        } catch (err) {
          setError(err instanceof Error ? err.message : "That invite did not work.");
        }
        return;
      }

      const claimRes = await fetch(`${API_URL}/api/pair/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceKind: "phone" }),
      });
      const claimBody = (await claimRes.json()) as Claim & { error?: string };
      if (claimRes.ok) setClaim(claimBody);
    })();
  }, [invite]);

  useEffect(() => {
    if (!claim || familyToken) return;
    const timer = setInterval(() => {
      void (async () => {
        const res = await fetch(`${API_URL}/api/pair/poll`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: claim.id, pollSecret: claim.pollSecret }),
        });
        const body = (await res.json()) as { status?: string; familyToken?: string };
        if (body.status === "paired" && body.familyToken) {
          await saveFamilyToken(body.familyToken);
          setFamilyToken(body.familyToken);
          const peopleRes = await fetch(`${API_URL}/api/people`, { headers: { "x-family-token": body.familyToken } });
          const peopleBody = (await peopleRes.json()) as { people: Person[] };
          setPeople(peopleBody.people);
        }
      })();
    }, 2000);
    return () => clearInterval(timer);
  }, [claim, familyToken]);

  async function bootstrapLogin() {
    if (!picked) return;
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/pair/bootstrap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId: picked.id, pin, deviceKind: "phone" }),
      });
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? "That PIN is wrong.");
      await saveSession(body.token);
      router.replace("/(app)/today");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That PIN is wrong.");
    }
  }

  async function login() {
    if (!picked || !familyToken) return;
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familyToken, personId: picked.id, pin, deviceKind: "phone" }),
      });
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? "That PIN is wrong.");
      await saveSession(body.token);
      router.replace("/(app)/today");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That PIN is wrong.");
    }
  }

  return (
    <ScrollView contentContainerStyle={{ ...screen, justifyContent: "center" }}>
      <Text style={{ ...h1, fontSize: 36 }}>Liendo Plaza</Text>
      {!familyToken && bootstrap && !picked ? (
        <>
          <Text style={body}>First parent phone. Pick your name and enter your PIN.</Text>
          {parents.map((person) => (
            <Pressable key={person.id} onPress={() => setPicked(person)} style={personEdge(person.color)}>
              <Text style={{ color: colors.ink }}>{person.name}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
      {familyToken && !picked ? (
        <>
          <Text style={h2}>Pick your name</Text>
          {people.map((person) => (
            <Pressable key={person.id} onPress={() => setPicked(person)} style={personEdge(person.color)}>
              <Text style={{ color: colors.ink }}>{person.name}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
      {picked ? (
        <>
          <Text style={h2}>{picked.name}</Text>
          <TextInput
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
            style={input}
          />
          <Pressable onPress={() => void (familyToken ? login() : bootstrapLogin())} style={btn}>
            <Text style={btnLabel}>Open</Text>
          </Pressable>
        </>
      ) : null}
      {!familyToken && !picked && claim ? (
        <View style={{ alignItems: "center", gap: 12, backgroundColor: colors.paper2, padding: 20 }}>
          <Text style={muted}>A parent can scan this or type the code under Add a device.</Text>
          <Image source={{ uri: claim.qrDataUrl }} style={{ width: 220, height: 220 }} />
          <Text style={{ fontFamily: type.display, fontSize: 36, letterSpacing: 4, color: colors.ink }}>{claim.displayCode}</Text>
        </View>
      ) : null}
      {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
    </ScrollView>
  );
}
