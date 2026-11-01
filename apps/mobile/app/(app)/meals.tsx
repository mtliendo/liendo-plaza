import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { DisplaySnapshot } from "@liendo/shared";
import { weekDates } from "@liendo/shared";
import { api } from "@/lib/api";

export default function MealsScreen() {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  useEffect(() => {
    void (async () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const week = weekDates(today);
      setSnapshot((await api(`snapshot?from=${week[0]}&to=${week[6]}`)) as DisplaySnapshot);
    })();
  }, []);
  const week = weekDates(snapshot?.now.slice(0, 10) ?? "");
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text style={{ fontFamily: "Georgia", fontSize: 32 }}>Dinner</Text>
      {week.map((iso) => (
        <View key={iso} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text>{iso.slice(5)}</Text>
          <Text>{snapshot?.meals.find((meal) => meal.date === iso)?.name ?? "—"}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
