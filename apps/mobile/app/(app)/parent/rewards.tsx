import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import type { Reward } from "@liendo/shared";
import { api } from "@/lib/api";
import { body, btn, btnLabel, input, screen } from "@/lib/theme";

export default function ParentRewardsScreen() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [name, setName] = useState("");
  const load = async () => setRewards(((await api("rewards")) as { rewards: Reward[] }).rewards);
  useEffect(() => {
    void load();
  }, []);
  return (
    <ScrollView contentContainerStyle={screen}>
      <TextInput value={name} onChangeText={setName} placeholder="Reward name" style={input} />
      <Pressable
        onPress={async () => {
          await api("rewards", { method: "POST", body: JSON.stringify({ name, starCost: 8 }) });
          setName("");
          await load();
        }}
        style={btn}
      >
        <Text style={btnLabel}>Add reward</Text>
      </Pressable>
      {rewards.map((reward) => (
        <Text key={reward.id} style={body}>
          {reward.name} {reward.starCost}
        </Text>
      ))}
    </ScrollView>
  );
}
