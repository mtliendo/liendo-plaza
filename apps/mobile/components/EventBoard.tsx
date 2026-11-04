import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { nextUpcomingParts, planTodayEvents, type CalendarEvent, type Person } from "@liendo/shared";
import { accentLabel, body, colors, type } from "@/lib/theme";

export function EventBoard({
  events,
  now,
  people,
}: {
  events: CalendarEvent[];
  now: string;
  people: Person[];
}) {
  const plan = planTodayEvents(events, now, people, 5);
  const next = plan.next ? nextUpcomingParts(plan.next) : null;
  if (plan.today.length === 0) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={accentLabel}>On the calendar</Text>
        <Text style={body}>Nothing on the calendar today</Text>
        {next ? (
          <View style={{ gap: 2 }}>
            <Text style={{ ...accentLabel, fontSize: 14 }}>Next up {next.weekday}</Text>
            <Text style={{ fontFamily: type.display, fontSize: 20, color: colors.ink }}>{next.title}</Text>
            <Text style={{ color: colors.muted, fontSize: 14 }}>{next.time}</Text>
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={accentLabel}>On the calendar</Text>
      {plan.visible.map((item) => (
        <View key={`${item.event.uid}-${item.event.start}`} style={{ paddingVertical: 6, opacity: item.phase === "past" ? 0.55 : 1, gap: 2 }}>
          <Text
            style={{
              fontFamily: type.body,
              color: item.phase === "now" ? colors.accent : colors.ink2,
              fontSize: 14,
            }}
          >
            {item.timeLabel}
          </Text>
          <Text style={{ fontFamily: type.body, color: colors.ink, fontSize: 18 }} numberOfLines={2}>
            {item.event.title}
          </Text>
        </View>
      ))}
      {plan.moreCount > 0 ? (
        <Link href="/calendar" asChild>
          <Pressable style={{ minHeight: 64, justifyContent: "center" }}>
            <Text style={{ color: colors.ink2, fontFamily: type.body }}>+{plan.moreCount} more</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}
