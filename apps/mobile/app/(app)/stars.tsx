import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { Reward } from "@liendo/shared";
import { queryKeys } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";
import { api } from "@/lib/api";
import { useSnapshot } from "@/lib/query";
import { colors, curve, h1, h2, muted, personEdge, screen } from "@/lib/theme";

export default function StarsScreen() {
  const snapshotQuery = useSnapshot();
  const snapshot = snapshotQuery.data ?? null;
  const rewardsQuery = useQuery({
    queryKey: queryKeys.rewards,
    queryFn: () => api("rewards") as Promise<{ rewards: Reward[] }>,
  });
  const rewards = rewardsQuery.data?.rewards ?? [];
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
              await snapshotQuery.refetch();
            }}
            style={{ backgroundColor: colors.paper2, padding: 16, minHeight: 64, justifyContent: "center", ...curve.card }}
          >
            <Text style={{ color: colors.ink }}>{reward.name}</Text>
            <Text style={muted}>{reward.starCost} stars</Text>
          </Pressable>
        ))}
    </ScrollView>
  );
}
