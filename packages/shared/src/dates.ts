export const TIMEZONE = "America/Chicago";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfWeekSunday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - date.getDay());
  return isoDate(date);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

export function weekDates(iso: string): string[] {
  const start = startOfWeekSunday(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** "Sun, Nov 1" — dense dinner and week labels. */
export function weekdayDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAY_LABELS[new Date(y, m - 1, d).getDay()]}, ${MONTH_SHORT[m - 1]} ${d}`;
}

export function weekdayLongLabel(iso: string): string {
  return WEEKDAY_LONG[weekdayIndex(iso)];
}

export function repeatLabel(input: {
  repeatType: "daily" | "weekdays" | "weekly" | "once";
  weekdays?: number[] | null;
  weeklyWeekday?: number | null;
  onceDate?: string | null;
}): string {
  if (input.repeatType === "daily") return "Every day";
  if (input.repeatType === "weekdays") {
    const days = input.weekdays?.length ? input.weekdays : [1, 2, 3, 4, 5];
    if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) return "Weekdays";
    return days.map((day) => WEEKDAY_LABELS[day]).join(", ");
  }
  if (input.repeatType === "weekly") {
    const days = input.weekdays?.length
      ? input.weekdays
      : input.weeklyWeekday != null
        ? [input.weeklyWeekday]
        : [];
    if (days.length === 0) return "Weekly";
    return days.map((day) => WEEKDAY_LABELS[day]).join(", ");
  }
  if (input.onceDate) return `Once on ${weekdayDateLabel(input.onceDate)}`;
  return "Once";
}

export function isDimHours(hour: number): boolean {
  return hour >= 22 || hour < 6;
}

export function weatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunder";
  return "Outside";
}
