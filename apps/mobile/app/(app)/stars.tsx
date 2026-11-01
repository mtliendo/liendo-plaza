import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { DisplaySnapshot, Reward } from "@liendo/shared";
import { weekDates } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";
import { api } from "@/lib/api";
import { colors, h1, h2, muted, personEdge, screen } from "@/lib/theme";

export default function StarsScreen() {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const load = useCallback(async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const week = weekDates(today);
    setSnapshot((await api(`snapshot?from=${week[0]}&to=${week[6]}`)) as DisplaySnapshot);
    const body = (await api("rewards")) as { rewards: Reward[] };
    setRewards(body.rewards);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <ScrollView contentContainerStyle={screen}>
      <Text style={h1}>Stars</Text>
      {snapshot?.stars.map((row) => {
        const person = snapshot.people.find((item) => item.id === row.personId);
        return (
          <View key={row.personId} style={{ ...personEdge(row.color), flexDirection: "row", alignItems: "center", gap: 12 }}>
            {person ? <PersonAvatar person={person} size={56} /> : null}
            <View>
              <Text style={{ color: colors.ink }}>{row.personName}</Text>
              <Text style={muted}>{row.balance} to spend</Text>
              <Text style={muted}>{row.weekEarned} this week</Text>
            </View>
          </View>
        );
      })}
      <Text style={h2}>Ask for a reward</Text>
      {rewards
        .filter((reward) => reward.active)
        .map((reward) => (
          <Pressable
            key={reward.id}
            onPress={async () => {
              await api("rewards/requests", { method: "POST", body: JSON.stringify({ rewardId: reward.id }) });
              await load();
            }}
            style={{ backgroundColor: colors.paper2, padding: 16, minHeight: 64, justifyContent: "center" }}
          >
            <Text style={{ color: colors.ink }}>{reward.name}</Text>
            <Text style={muted}>{reward.starCost} stars</Text>
          </Pressable>
        ))}
    </ScrollView>
  );
}
