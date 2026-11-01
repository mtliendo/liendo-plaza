import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import type { Reward } from "@liendo/shared";
import { api } from "@/lib/api";

export default function ParentRewardsScreen() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [name, setName] = useState("");
  const load = async () => setRewards(((await api("rewards")) as { rewards: Reward[] }).rewards);
  useEffect(() => {
    void load();
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <TextInput value={name} onChangeText={setName} placeholder="Reward name" style={{ borderWidth: 1, padding: 12 }} />
      <Pressable
        onPress={async () => {
          await api("rewards", { method: "POST", body: JSON.stringify({ name, starCost: 8 }) });
          setName("");
          await load();
        }}
        style={{ backgroundColor: "#C24A2A", padding: 14 }}
      >
        <Text style={{ color: "#FBF6EA", textAlign: "center" }}>Add reward</Text>
      </Pressable>
      {rewards.map((reward) => (
        <Text key={reward.id}>
          {reward.name} · {reward.starCost}
        </Text>
      ))}
    </ScrollView>
  );
}
