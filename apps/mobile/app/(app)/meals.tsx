import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { mealPhotoSrc, weekdayDateLabel, weekDates } from "@liendo/shared";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { useMe, useSnapshot } from "@/lib/query";
import { accentLabel, body, colors, h1, input, muted, screen, type } from "@/lib/theme";

export default function MealsScreen() {
  const me = useMe().data?.actor.person ?? null;
  const snapshotQuery = useSnapshot();
  const snapshot = snapshotQuery.data ?? null;
  const today = snapshot?.now.slice(0, 10) ?? "";
  const week = weekDates(today);
  const isParent = me?.role === "parent";
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!snapshot) return;
    setNames(Object.fromEntries(snapshot.meals.map((meal) => [meal.date, meal.name])));
  }, [snapshot]);

  async function save(date: string, name: string) {
    await api("meals", { method: "PUT", body: JSON.stringify({ date, name }) });
    await snapshotQuery.refetch();
  }

  return (
    <ScrollView contentContainerStyle={screen} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <Text style={h1}>Dinner</Text>
      {week.map((iso) => {
        const meal = snapshot?.meals.find((row) => row.date === iso);
        const thumb = mealPhotoSrc(meal?.photoPath);
        const uri = thumb?.startsWith("http") ? thumb : thumb ? `${API_URL}${thumb}` : null;
        const isTonight = iso === today;
        return (
          <View
            key={iso}
            style={{
              gap: 8,
              padding: isTonight ? 12 : 0,
              backgroundColor: isTonight ? "#F3E6D6" : undefined,
            }}
          >
            {isTonight ? <Text style={accentLabel}>Tonight</Text> : null}
            <Text style={accentLabel}>{weekdayDateLabel(iso)}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {uri ? <Image source={{ uri }} style={{ width: 48, height: 48 }} /> : null}
              {isParent ? (
                <View style={{ flex: 1, gap: 8 }}>
                  <TextInput
                    value={names[iso] ?? ""}
                    placeholder="What’s for dinner?"
                    onChangeText={(value) => setNames((current) => ({ ...current, [iso]: value }))}
                    onEndEditing={() => void save(iso, names[iso] ?? "")}
                    style={input}
                  />
                  {names[iso] ? (
                    <Pressable onPress={() => void save(iso, "")}>
                      <Text style={muted}>Clear</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <Text style={{ fontFamily: type.display, fontSize: 20, color: colors.ink, flex: 1 }}>
                  {meal?.name ?? "Not written yet"}
                </Text>
              )}
            </View>
          </View>
        );
      })}
      {isParent ? <Text style={body}>Type a dinner and leave the field. Kids see it on the board.</Text> : null}
    </ScrollView>
  );
}
