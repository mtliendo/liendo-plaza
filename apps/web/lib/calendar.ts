import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ical, { type CalendarComponent, type VEvent } from "node-ical";
import { DateTime } from "luxon";
import type { CalendarEvent } from "@liendo/shared";
import { TIMEZONE } from "@liendo/shared";
import { calendarWindow, endOfDayCt, startOfDayCt } from "./time";

const CACHE_TTL_MS = 4 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

type ParsedCalendar = Record<string, CalendarComponent>;

type CalendarCache = {
  fetchedAt: number;
  parsed: ParsedCalendar;
  source: "env" | "sample";
};

let cache: CalendarCache | null = null;
let inflight: Promise<CalendarCache> | null = null;

function publicIcalUrl(): string | null {
  const raw = process.env.FAMILY_ICAL_URL?.trim();
  if (!raw) return null;
  return raw.replace(/^webcal:/i, "https:");
}

async function loadSample(): Promise<string> {
  return readFile(join(process.cwd(), "data", "sample.ics"), "utf8");
}

async function fetchFamilyIcs(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "LiendoPlaza/1.0" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`calendar fetch failed: ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadCalendar(): Promise<CalendarCache> {
  const url = publicIcalUrl();
  try {
    const text = url ? await fetchFamilyIcs(url) : await loadSample();
    const parsed = ical.sync.parseICS(text) as ParsedCalendar;
    const next: CalendarCache = {
      fetchedAt: Date.now(),
      parsed,
      source: url ? "env" : "sample",
    };
    cache = next;
    return next;
  } catch (error) {
    if (cache) {
      console.warn("calendar refresh failed; serving cached parse", error);
      return cache;
    }
    if (url) {
      console.warn("calendar fetch failed; falling back to sample", error);
      const text = await loadSample();
      const parsed = ical.sync.parseICS(text) as ParsedCalendar;
      const next: CalendarCache = { fetchedAt: Date.now(), parsed, source: "sample" };
      cache = next;
      return next;
    }
    throw error;
  }
}

async function getParsedCalendar(): Promise<CalendarCache> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  if (!inflight) {
    inflight = loadCalendar().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value && "toJSDate" in value) {
    try {
      const date = (value as { toJSDate: () => Date }).toJSDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }
  return null;
}

function isAllDay(event: VEvent): boolean {
  const start = event.start as Date & { dateOnly?: boolean };
  if (start?.dateOnly) return true;
  const type = (event as VEvent & { datetype?: string }).datetype;
  if (type === "date") return true;
  return false;
}

function occurrenceIso(date: Date, allDay: boolean): string {
  if (allDay) {
    return DateTime.fromJSDate(date, { zone: "utc" }).toISODate() ?? date.toISOString();
  }
  return DateTime.fromJSDate(date).setZone(TIMEZONE).toISO() ?? date.toISOString();
}

function durationMs(event: VEvent): number {
  const start = asDate(event.start);
  const end = asDate(event.end);
  if (start && end && end.getTime() > start.getTime()) {
    return end.getTime() - start.getTime();
  }
  return isAllDay(event) ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
}

function excluded(event: VEvent, occurrence: Date): boolean {
  const exdate = (event as VEvent & { exdate?: Record<string, Date> }).exdate;
  if (!exdate) return false;
  const key = occurrence.toISOString().slice(0, 10);
  return Object.values(exdate).some((stamp) => {
    if (!(stamp instanceof Date)) return false;
    return stamp.toISOString().slice(0, 10) === key;
  });
}

function overrideFor(event: VEvent, occurrence: Date): VEvent | null {
  const recurrences = (event as VEvent & { recurrences?: Record<string, VEvent> }).recurrences;
  if (!recurrences) return null;
  const key = DateTime.fromJSDate(occurrence).toFormat("yyyy-MM-dd");
  return recurrences[key] ?? recurrences[occurrence.toISOString()] ?? null;
}

function mapEvent(event: VEvent, start: Date, end: Date): CalendarEvent {
  const allDay = isAllDay(event);
  return {
    uid: String(event.uid ?? `${event.summary}-${start.toISOString()}`),
    title: String(event.summary ?? "Busy"),
    start: occurrenceIso(start, allDay),
    end: occurrenceIso(end, allDay),
    allDay,
    location: event.location ? String(event.location) : undefined,
  };
}

function rruleUntil(event: VEvent): Date | null {
  const rule = event.rrule as { options?: { until?: Date } } | undefined;
  return rule?.options?.until ?? null;
}

function expandWindow(parsed: ParsedCalendar, fromIso: string, toIso: string): CalendarEvent[] {
  const windowStart = startOfDayCt(fromIso).toUTC().toJSDate();
  const windowEnd = endOfDayCt(toIso).toUTC().toJSDate();
  const out: CalendarEvent[] = [];

  for (const item of Object.values(parsed)) {
    if (!item || item.type !== "VEVENT") continue;
    const event = item as VEvent;
    const start = asDate(event.start);
    if (!start) continue;

    if (event.rrule) {
      const until = rruleUntil(event);
      if (until && until < windowStart) continue;
      if (start > windowEnd) continue;

      const dates = event.rrule.between(windowStart, windowEnd, true);
      for (const date of dates) {
        if (excluded(event, date)) continue;
        const override = overrideFor(event, date);
        if (override) {
          const oStart = asDate(override.start) ?? date;
          const oEnd = asDate(override.end) ?? new Date(oStart.getTime() + durationMs(override));
          if (oEnd < windowStart || oStart > windowEnd) continue;
          out.push(mapEvent(override, oStart, oEnd));
          continue;
        }
        const end = new Date(date.getTime() + durationMs(event));
        out.push(mapEvent(event, date, end));
      }
      continue;
    }

    const end = asDate(event.end) ?? new Date(start.getTime() + durationMs(event));
    if (end < windowStart || start > windowEnd) continue;
    if ((event as VEvent & { recurrenceid?: Date }).recurrenceid) continue;
    out.push(mapEvent(event, start, end));
  }

  out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return out;
}

export async function getCalendarEvents(fromIso?: string, toIso?: string): Promise<CalendarEvent[]> {
  const window = calendarWindow(fromIso, toIso);
  const { parsed } = await getParsedCalendar();
  return expandWindow(parsed, window.from, window.to);
}

export function calendarCacheMeta() {
  return {
    ageMs: cache ? Date.now() - cache.fetchedAt : null,
    source: cache?.source ?? null,
  };
}
