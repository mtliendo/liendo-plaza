import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { weekdayDateLabel, weekDates } from "@liendo/shared";
import { PhotoField } from "@/components/photo-field";
import { SwipeRow } from "@/components/swipe-row";
import { UndoToast } from "@/components/undo-toast";
import { api, photoUri, uploadPhoto } from "@/lib/api";
import { useMe, useSnapshot } from "@/lib/query";
import { accentLabel, body, colors, curve, h1, input, muted, screen, type } from "@/lib/theme";

export default function MealsScreen() {
  const me = useMe().data?.actor.person ?? null;
  const snapshotQuery = useSnapshot();
  const snapshot = snapshotQuery.data ?? null;
  const today = snapshot?.now.slice(0, 10) ?? "";
  const week = weekDates(today);
  const isParent = me?.role === "parent";
  const [names, setNames] = useState<Record<string, string>>({});
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ date: string; name: string } | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    setNames(Object.fromEntries(snapshot.meals.map((meal) => [meal.date, meal.name])));
  }, [snapshot]);

  async function save(date: string, name: string) {
    await api("meals", { method: "PUT", body: JSON.stringify({ date, name }) });
    await snapshotQuery.refetch();
  }

  async function savePhoto(date: string, uri: string) {
    await uploadPhoto(`meals/${date}/photo`, uri);
    await snapshotQuery.refetch();
  }

  async function clearPhoto(date: string) {
    await api(`meals/${date}/photo`, { method: "DELETE" });
    await snapshotQuery.refetch();
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={screen} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        <Text style={h1}>Dinner</Text>
        {week.map((iso) => {
          const meal = snapshot?.meals.find((row) => row.date === iso);
          const uri = photoUri(meal?.photoPath);
          const isTonight = iso === today;
          const row = (
            <View
              style={{
                gap: 8,
                padding: 12,
                backgroundColor: isTonight ? "#F3E6D6" : colors.paper2,
                ...curve.card,
              }}
            >
              {isTonight ? <Text style={accentLabel}>Tonight</Text> : null}
              <Text style={accentLabel}>{weekdayDateLabel(iso)}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                {uri && !isParent ? <Image source={{ uri }} style={{ width: 72, height: 72, ...curve.card }} /> : null}
                {isParent ? (
                  <View style={{ flex: 1, gap: 8 }}>
                    <TextInput
                      value={names[iso] ?? ""}
                      placeholder="What’s for dinner?"
                      onChangeText={(value) => setNames((current) => ({ ...current, [iso]: value }))}
                      onEndEditing={() => void save(iso, names[iso] ?? "")}
                      autoFocus={focusDate === iso}
                      style={input}
                    />
                    <PhotoField
                      uri={uri}
                      onPick={(next) => void savePhoto(iso, next)}
                      onClear={uri ? () => void clearPhoto(iso) : undefined}
                    />
                    {names[iso] ? (
                      <Pressable
                        onPress={() => {
                          const previous = names[iso] ?? "";
                          void save(iso, "");
                          setUndo({ date: iso, name: previous });
                        }}
                      >
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
          return (
            <SwipeRow
              key={iso}
              enabled={isParent}
              onEdit={() => setFocusDate(iso)}
              onDelete={
                names[iso]
                  ? () => {
                      const previous = names[iso] ?? "";
                      void save(iso, "");
                      setUndo({ date: iso, name: previous });
                    }
                  : undefined
              }
            >
              {row}
            </SwipeRow>
          );
        })}
        {isParent ? <Text style={body}>Type a dinner and leave the field. Kids see it on the board.</Text> : null}
      </ScrollView>
      {undo ? (
        <UndoToast
          message={`${undo.name} cleared`}
          onUndo={() => {
            void save(undo.date, undo.name);
            setUndo(null);
          }}
          onGone={() => setUndo(null)}
        />
      ) : null}
    </View>
  );
}
