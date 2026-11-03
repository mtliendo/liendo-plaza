import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Reward } from "@liendo/shared";
import { SwipeRow } from "@/components/swipe-row";
import { UndoToast } from "@/components/undo-toast";
import { api } from "@/lib/api";
import { body, btn, btnLabel, colors, input, muted, screen } from "@/lib/theme";

export default function ParentRewardsScreen() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [name, setName] = useState("");
  const [starCost, setStarCost] = useState("8");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [undo, setUndo] = useState<Reward | null>(null);

  const load = async () => setRewards(((await api("rewards")) as { rewards: Reward[] }).rewards);
  useEffect(() => {
    void load();
  }, []);

  function startEdit(reward: Reward) {
    setEditingId(reward.id);
    setName(reward.name);
    setStarCost(String(reward.starCost));
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={screen} keyboardShouldPersistTaps="handled">
        <TextInput value={name} onChangeText={setName} placeholder="Reward name" style={input} />
        <TextInput value={starCost} onChangeText={setStarCost} keyboardType="number-pad" placeholder="Stars" style={input} />
        <Pressable
          onPress={async () => {
            if (!name.trim()) return;
            if (editingId) {
              await api(`rewards/${editingId}`, { method: "PATCH", body: JSON.stringify({ name, starCost: Number(starCost) || 8 }) });
            } else {
              await api("rewards", { method: "POST", body: JSON.stringify({ name, starCost: Number(starCost) || 8 }) });
            }
            setName("");
            setStarCost("8");
            setEditingId(null);
            await load();
          }}
          style={btn}
        >
          <Text style={btnLabel}>{editingId ? "Save reward" : "Add reward"}</Text>
        </Pressable>
        {editingId ? (
          <Pressable
            onPress={() => {
              setEditingId(null);
              setName("");
              setStarCost("8");
            }}
          >
            <Text style={muted}>Cancel</Text>
          </Pressable>
        ) : null}
        {rewards
          .filter((reward) => reward.active)
          .map((reward) => (
            <SwipeRow
              key={reward.id}
              enabled
              onEdit={() => startEdit(reward)}
              onDelete={() => {
                void (async () => {
                  await api(`rewards/${reward.id}`, { method: "DELETE" });
                  setUndo(reward);
                  await load();
                })();
              }}
            >
              <View style={{ backgroundColor: colors.paper2, padding: 16, gap: 8 }}>
                <Text style={body}>
                  {reward.name} · {reward.starCost} stars
                </Text>
                <View style={{ flexDirection: "row", gap: 16 }}>
                  <Pressable onPress={() => startEdit(reward)}>
                    <Text style={{ color: colors.accent }}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      await api(`rewards/${reward.id}`, { method: "DELETE" });
                      setUndo(reward);
                      await load();
                    }}
                  >
                    <Text style={{ color: colors.error }}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            </SwipeRow>
          ))}
      </ScrollView>
      {undo ? (
        <UndoToast
          message={`${undo.name} removed`}
          onUndo={() => {
            void (async () => {
              await api(`rewards/${undo.id}`, { method: "PATCH", body: JSON.stringify({ active: true }) });
              setUndo(null);
              await load();
            })();
          }}
          onGone={() => setUndo(null)}
        />
      ) : null}
    </View>
  );
}
