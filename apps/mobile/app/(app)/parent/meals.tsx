import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput } from "react-native";
import { weekDates } from "@liendo/shared";
import { api } from "@/lib/api";

export default function ParentMealsScreen() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const week = weekDates(today);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    void (async () => {
      const body = (await api(`meals?from=${week[0]}&to=${week[6]}`)) as { meals: { date: string; name: string }[] };
      setNames(Object.fromEntries(body.meals.map((meal) => [meal.date, meal.name])));
    })();
  }, [week]);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      {week.map((iso) => (
        <TextInput
          key={iso}
          value={names[iso] ?? ""}
          placeholder={iso}
          onChangeText={(value) => setNames((current) => ({ ...current, [iso]: value }))}
          onEndEditing={() => {
            void api("meals", { method: "PUT", body: JSON.stringify({ date: iso, name: names[iso] ?? "" }) });
          }}
          style={{ borderWidth: 1, padding: 12 }}
        />
      ))}
      <Text style={{ color: "#5C3A24" }}>Type a dinner. Names you have used before will match on the web planner.</Text>
    </ScrollView>
  );
}
