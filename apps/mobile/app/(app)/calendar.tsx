import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { DisplaySnapshot } from "@liendo/shared";
import { WEEKDAY_LABELS, weekDates } from "@liendo/shared";
import { api } from "@/lib/api";
import { body, h1, h2, screen } from "@/lib/theme";

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
    <ScrollView contentContainerStyle={screen}>
      <Text style={h1}>This week</Text>
      {week.map((iso, index) => (
        <View key={iso} style={{ gap: 4 }}>
          <Text style={h2}>{WEEKDAY_LABELS[index]}</Text>
          {snapshot?.events
            .filter((event) => event.start.slice(0, 10) === iso)
            .map((event) => (
              <Text key={`${event.uid}-${event.start}`} style={body}>{event.title}</Text>
            ))}
        </View>
      ))}
    </ScrollView>
  );
}
