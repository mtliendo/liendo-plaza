import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import type { DisplaySnapshot, Person } from "@liendo/shared";
import { weekDates } from "@liendo/shared";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { getSession } from "@/lib/session";
import { body, colors, h1, muted, row, screen } from "@/lib/theme";

export default function TodayScreen() {
  const [me, setMe] = useState<Person | null>(null);
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);

  const load = useCallback(async () => {
    const actor = (await api("me")) as { actor: { person?: Person } };
    setMe(actor.actor.person ?? null);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const week = weekDates(today);
    setSnapshot((await api(`snapshot?from=${week[0]}&to=${week[6]}`)) as DisplaySnapshot);
  }, []);

  useEffect(() => {
    void load();
    void registerPush();
  }, [load]);

  const today = snapshot ? snapshot.now.slice(0, 10) : "";
  const chores =
    snapshot?.chores.filter((item) => (me?.role === "parent" ? true : item.personId === me?.id) && item.date === today) ??
    [];

  async function complete(id: string) {
    await api(`chores/instances/${id}/complete`, { method: "POST" });
    await load();
  }

  async function sendPhoto(id: string) {
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (shot.canceled || !shot.assets[0]) return;
    const token = await getSession();
    const form = new FormData();
    form.append("photo", {
      uri: shot.assets[0].uri,
      name: "chore.jpg",
      type: "image/jpeg",
    } as never);
    await fetch(`${API_URL}/api/chores/instances/${id}/photo`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    await load();
  }

  return (
    <ScrollView contentContainerStyle={screen}>
      <Text style={h1}>Today</Text>
      {me?.role === "parent" ? (
        <View style={{ gap: 8 }}>
          <Link href="/parent/add-device">
            <Text style={{ fontSize: 18, color: colors.accent, minHeight: 48 }}>Add a device</Text>
          </Link>
          <Link href="/parent/devices">
            <Text style={{ fontSize: 18, color: colors.accent, minHeight: 48 }}>Paired devices</Text>
          </Link>
        </View>
      ) : null}
      {chores.map((chore) => (
        <Pressable
          key={chore.id}
          onPress={() => {
            if (chore.requiresPhoto && chore.status === "open") void sendPhoto(chore.id);
            else if (!chore.requiresPhoto && chore.status === "open") void complete(chore.id);
          }}
          style={row}
        >
          <Text style={{ fontSize: 18, color: colors.ink }}>{chore.title}</Text>
          <Text style={muted}>{chore.status}</Text>
          {chore.requiresPhoto ? <Text style={muted}>photo</Text> : null}
          <Text style={body}>{chore.stars} stars</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

async function registerPush() {
  try {
    const perms = await Notifications.requestPermissionsAsync();
    if (!perms.granted) return;
    const token = await Notifications.getExpoPushTokenAsync();
    await api("push/register", { method: "POST", body: JSON.stringify({ token: token.data }) });
  } catch {
    // Simulator and web can skip push.
  }
}
