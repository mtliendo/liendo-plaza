import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import type { Person } from "@liendo/shared";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { getSession, saveFamilyToken, saveSession } from "@/lib/session";

export default function AuthScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const [secret, setSecret] = useState(typeof params.code === "string" ? params.code : "");
  const [familyToken, setFamilyToken] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const token = await getSession();
      if (token) router.replace("/(app)/today");
    })();
  }, [router]);

  async function enterFamily() {
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/family`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const body = (await res.json()) as { familyToken?: string; error?: string };
      if (!res.ok || !body.familyToken) throw new Error(body.error ?? "That code did not work.");
      await saveFamilyToken(body.familyToken);
      setFamilyToken(body.familyToken);
      const peopleRes = await fetch(`${API_URL}/api/people`, {
        headers: { "x-family-token": body.familyToken },
      });
      const peopleBody = (await peopleRes.json()) as { people: Person[] };
      setPeople(peopleBody.people);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not work.");
    }
  }

  async function login() {
    if (!picked || !familyToken) return;
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familyToken, personId: picked.id, pin }),
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
    <View style={{ flex: 1, backgroundColor: "#F3E6C8", padding: 24, justifyContent: "center", gap: 16 }}>
      <Text style={{ fontFamily: "Georgia", fontSize: 36, color: "#3D2416" }}>Liendo Plaza</Text>
      {!familyToken ? (
        <>
          <Text style={{ color: "#5C3A24" }}>Paste the family code once.</Text>
          <TextInput
            value={secret}
            onChangeText={setSecret}
            autoCapitalize="none"
            style={{ borderWidth: 1, borderColor: "#3D2416", padding: 14, minHeight: 48, backgroundColor: "#FBF6EA" }}
          />
          <Pressable onPress={() => void enterFamily()} style={{ backgroundColor: "#C24A2A", padding: 16 }}>
            <Text style={{ color: "#FBF6EA", textAlign: "center" }}>Continue</Text>
          </Pressable>
        </>
      ) : !picked ? (
        <>
          <Text style={{ fontSize: 22, color: "#3D2416" }}>Pick your name</Text>
          {people.map((person) => (
            <Pressable
              key={person.id}
              onPress={() => setPicked(person)}
              style={{ borderLeftWidth: 6, borderLeftColor: person.color, padding: 14, backgroundColor: "#FBF6EA" }}
            >
              <Text>{person.name}</Text>
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <Text style={{ fontSize: 22, color: "#3D2416" }}>{picked.name}</Text>
          <TextInput
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
            style={{ borderWidth: 1, borderColor: "#3D2416", padding: 14, minHeight: 48, backgroundColor: "#FBF6EA" }}
          />
          <Pressable onPress={() => void login()} style={{ backgroundColor: "#C24A2A", padding: 16 }}>
            <Text style={{ color: "#FBF6EA", textAlign: "center" }}>Open</Text>
          </Pressable>
        </>
      )}
      {error ? <Text style={{ color: "#9B2C1A" }}>{error}</Text> : null}
    </View>
  );
}
