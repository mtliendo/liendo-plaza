import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import type { DisplaySnapshot, Reward } from "@liendo/shared";
import { weekDates } from "@liendo/shared";
import { api } from "@/lib/api";

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
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text style={{ fontFamily: "Georgia", fontSize: 32 }}>Stars</Text>
      {snapshot?.stars.map((row) => (
        <Text key={row.personId}>
          {row.personName}: {row.balance} to spend, {row.weekEarned} this week
        </Text>
      ))}
      <Text style={{ fontFamily: "Georgia", fontSize: 24, marginTop: 12 }}>Ask for a reward</Text>
      {rewards
        .filter((reward) => reward.active)
        .map((reward) => (
          <Pressable
            key={reward.id}
            onPress={async () => {
              await api("rewards/requests", { method: "POST", body: JSON.stringify({ rewardId: reward.id }) });
              await load();
            }}
            style={{ backgroundColor: "#FBF6EA", padding: 16 }}
          >
            <Text>
              {reward.name} · {reward.starCost}
            </Text>
          </Pressable>
        ))}
    </ScrollView>
  );
}
