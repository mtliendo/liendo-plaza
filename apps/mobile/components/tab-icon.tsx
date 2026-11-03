import { SymbolView } from "expo-symbols";
import { colors } from "@/lib/theme";

type TabName = "today" | "calendar" | "meals" | "stars" | "parent";

const ICONS: Record<TabName, { idle: string; active: string }> = {
  today: { idle: "sun.max", active: "sun.max.fill" },
  calendar: { idle: "calendar", active: "calendar.circle.fill" },
  meals: { idle: "fork.knife", active: "fork.knife.circle.fill" },
  stars: { idle: "star", active: "star.fill" },
  parent: { idle: "slider.horizontal.3", active: "gearshape.fill" },
}

export function TabIcon({ name, focused }: { name: TabName; focused: boolean }) {
  const icon = ICONS[name];
  return (
    <SymbolView
      name={(focused ? icon.active : icon.idle) as never}
      tintColor={focused ? colors.accent : colors.muted}
      weight={focused ? "semibold" : "regular"}
      size={24}
    />
  );
}
