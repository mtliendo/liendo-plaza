import { DateTime } from "luxon";
import { TIMEZONE } from "@liendo/shared";

export { TIMEZONE };

export function nowCt(): DateTime {
  return DateTime.now().setZone(TIMEZONE);
}

export function todayIso(at = nowCt()): string {
  return at.toISODate() ?? "";
}

export function startOfDayCt(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: TIMEZONE }).startOf("day");
}

export function endOfDayCt(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: TIMEZONE }).endOf("day");
}

export function jsWeekday(at: DateTime): number {
  return at.weekday === 7 ? 0 : at.weekday;
}

export function calendarWindow(fromIso?: string, toIso?: string) {
  const today = todayIso();
  const from = fromIso ?? today;
  const maxTo = DateTime.fromISO(from, { zone: TIMEZONE }).plus({ weeks: 5 }).toISODate() ?? today;
  const to = toIso && toIso <= maxTo ? toIso : maxTo;
  return { from, to };
}

export function formatClock(at = nowCt()): string {
  return at.toFormat("h:mm a");
}

export function formatLongDate(at = nowCt()): string {
  return at.toFormat("cccc, LLLL d");
}
