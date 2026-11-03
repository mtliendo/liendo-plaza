import { ScrollView, Text, View } from "react-native";
import { WEEKDAY_LABELS, weekdayDateLabel, weekDates } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useSnapshot } from "@/lib/query";
import { accentLabel, body, colors, h1, muted, screen, type } from "@/lib/theme";

export default function CalendarScreen() {
  const snapshot = useSnapshot().data ?? null;
  const today = snapshot?.now.slice(0, 10) ?? "";
  const week = weekDates(today);
  return (
    <ScrollView contentContainerStyle={screen} contentInsetAdjustmentBehavior="automatic">
      <Text style={h1}>This week at a glance</Text>
      {week.map((iso, index) => {
        const dayEvents = snapshot?.events.filter((event) => event.start.slice(0, 10) === iso) ?? [];
        const dayChores = snapshot?.chores.filter((item) => item.date === iso) ?? [];
        const meal = snapshot?.meals.find((row) => row.date === iso);
        const isToday = iso === today;
        return (
          <View
            key={iso}
            style={{
              gap: 6,
              padding: 12,
              backgroundColor: isToday ? "#F3E6D6" : colors.paper2,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text style={{ ...accentLabel, fontSize: 18 }}>{isToday ? "Today" : WEEKDAY_LABELS[index]}</Text>
              <Text style={muted}>{weekdayDateLabel(iso)}</Text>
            </View>
            {dayEvents.length === 0 ? <Text style={muted}>No events</Text> : null}
            {dayEvents.map((event) => (
              <Text key={`${event.uid}-${event.start}`} style={body}>
                {event.title}
              </Text>
            ))}
            <Text style={{ fontFamily: type.displayItalic, color: colors.ink2, fontSize: 16 }}>
              {meal?.name ?? "Dinner not written"}
            </Text>
            {dayChores.map((chore) => {
              const person = snapshot?.people.find((row) => row.id === chore.personId);
              return (
                <View key={chore.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {person ? <PersonAvatar person={person} size={28} /> : null}
                  <Text style={{ ...body, color: chore.status === "done" ? colors.muted : colors.ink }}>
                    {chore.status === "done" ? "✓ " : ""}
                    {chore.title}
                  </Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}
