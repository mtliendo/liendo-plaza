import { useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { EventBoard } from "@/components/EventBoard";
import { PersonAvatar } from "@/components/PersonAvatar";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { useChoreToggle, useMe, usePrefetchHouse, useSnapshot } from "@/lib/query";
import { getSession } from "@/lib/session";
import { accentLabel, body, colors, h1, h2, muted, row, screen } from "@/lib/theme";

export default function TodayScreen() {
  const meQuery = useMe();
  const snapshotQuery = useSnapshot();
  const toggle = useChoreToggle();
  const prefetch = usePrefetchHouse();
  const me = meQuery.data?.actor.person ?? null;
  const snapshot = snapshotQuery.data ?? null;

  useEffect(() => {
    prefetch();
    void registerPush();
  }, [prefetch]);

  const today = snapshot ? snapshot.now.slice(0, 10) : "";
  const chores =
    snapshot?.chores.filter((item) => (me?.role === "parent" ? true : item.personId === me?.id) && item.date === today) ??
    [];

  async function complete(id: string) {
    toggle.mutate({ id });
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
    await snapshotQuery.refetch();
  }

  return (
    <ScrollView contentContainerStyle={screen}>
      {me ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <PersonAvatar person={me} size={48} />
          <Text style={h1}>Today</Text>
        </View>
      ) : (
        <Text style={h1}>Today</Text>
      )}
      {snapshot ? <EventBoard events={snapshot.events} now={snapshot.now} people={snapshot.people} /> : null}
      {snapshot ? (
        <View>
          <Text style={accentLabel}>Tonight’s dinner</Text>
          <Text style={h2}>{snapshot.meals.find((meal) => meal.date === today)?.name ?? "Nothing written yet"}</Text>
        </View>
      ) : null}
      {chores.map((chore) => {
        const person = snapshot?.people.find((row) => row.id === chore.personId);
        return (
          <Pressable
            key={chore.id}
            onPress={() => {
              if (chore.requiresPhoto && chore.status === "open") void sendPhoto(chore.id);
              else if (!chore.requiresPhoto && chore.status === "open") void complete(chore.id);
            }}
            style={row}
          >
            {person && me?.role === "parent" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <PersonAvatar person={person} size={48} />
                <Text style={{ fontSize: 16, color: colors.ink }}>{person.name}</Text>
              </View>
            ) : null}
            <Text style={{ fontSize: 18, color: colors.ink }}>{chore.title}</Text>
            <Text style={muted}>{chore.status}</Text>
            {chore.requiresPhoto ? <Text style={muted}>photo</Text> : null}
            <Text style={body}>{chore.stars === 1 ? "1 star" : `${chore.stars} stars`}</Text>
          </Pressable>
        );
      })}
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
