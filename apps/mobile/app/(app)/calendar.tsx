import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { DisplaySnapshot } from "@liendo/shared";
import { WEEKDAY_LABELS, weekDates } from "@liendo/shared";
import { api } from "@/lib/api";

export default function CalendarScreen() {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  useEffect(() => {
    void (async () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const week = weekDates(today);
      setSnapshot((await api(`snapshot?from=${week[0]}&to=${week[6]}`)) as DisplaySnapshot);
    })();
  }, []);
  const today = snapshot?.now.slice(0, 10) ?? "";
  const week = weekDates(today);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={{ fontFamily: "Georgia", fontSize: 32 }}>This week</Text>
      {week.map((iso, index) => (
        <View key={iso}>
          <Text style={{ fontWeight: "600" }}>{WEEKDAY_LABELS[index]}</Text>
          {snapshot?.events
            .filter((event) => event.start.slice(0, 10) === iso)
            .map((event) => (
              <Text key={`${event.uid}-${event.start}`}>{event.title}</Text>
            ))}
        </View>
      ))}
    </ScrollView>
  );
}
