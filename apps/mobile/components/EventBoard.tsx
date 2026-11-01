import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { nextUpcomingLabel, planTodayEvents, type CalendarEvent, type Person } from "@liendo/shared";
import { accentLabel, colors, type } from "@/lib/theme";

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
  if (plan.today.length === 0) {
    return (
      <View style={{ gap: 4 }}>
        <Text style={accentLabel}>Nothing on the calendar today</Text>
        {plan.next ? <Text style={accentLabel}>{nextUpcomingLabel(plan.next)}</Text> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {plan.visible.map((item) => (
        <View
          key={`${item.event.uid}-${item.event.start}`}
          style={{
            borderLeftWidth: 5,
            borderLeftColor: item.color ?? colors.rule,
            paddingLeft: 12,
            paddingVertical: 6,
            opacity: item.phase === "past" ? 0.55 : 1,
          }}
        >
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
