import { useEffect } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { ChoreCard } from "@/components/chore-card";
import { EventBoard } from "@/components/EventBoard";
import { PersonAvatar } from "@/components/PersonAvatar";
import { api } from "@/lib/api";
import { useMe, usePrefetchHouse, useSnapshot } from "@/lib/query";
import { accentLabel, h1, h2, muted, screen } from "@/lib/theme";

export default function TodayScreen() {
  const meQuery = useMe();
  const snapshotQuery = useSnapshot();
  const prefetch = usePrefetchHouse();
  const router = useRouter();
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

  return (
    <ScrollView contentContainerStyle={screen} contentInsetAdjustmentBehavior="automatic">
      {me ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <PersonAvatar person={me} size={28} />
          <Text style={muted}>{me.name}</Text>
        </View>
      ) : null}
      <Text style={h1}>Today</Text>
      {snapshot ? <EventBoard events={snapshot.events} now={snapshot.now} people={snapshot.people} /> : null}
      {snapshot ? (
        <View style={{ gap: 4 }}>
          <Text style={accentLabel}>Tonight’s dinner</Text>
          <Text style={h2}>{snapshot.meals.find((meal) => meal.date === today)?.name ?? "Nothing written yet"}</Text>
        </View>
      ) : null}
      {chores.map((chore) => {
        const person = snapshot?.people.find((row) => row.id === chore.personId);
        return (
          <ChoreCard
            key={chore.id}
            chore={chore}
            person={person}
            showPerson={Boolean(me?.role === "parent" && person)}
            onPress={() => router.push(`/chore/${chore.id}`)}
          />
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
