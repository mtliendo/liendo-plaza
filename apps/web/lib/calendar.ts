import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ical, { type CalendarComponent, type VEvent } from "node-ical";
import { DateTime } from "luxon";
import type { CalendarEvent } from "@liendo/shared";
import { TIMEZONE } from "@liendo/shared";
import { calendarWindow, endOfDayCt, startOfDayCt } from "./time";

const CACHE_TTL_MS = 4 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25_000;
const MAX_WINDOW_EVENTS = 400;

type ParsedCalendar = Record<string, CalendarComponent>;

type CalendarCache = {
  fetchedAt: number;
  parsed: ParsedCalendar;
  source: "env" | "sample";
};

type WindowCache = {
  key: string;
  fetchedAt: number;
  events: CalendarEvent[];
};

let cache: CalendarCache | null = null;
let inflight: Promise<CalendarCache> | null = null;
let windowCache: WindowCache | null = null;

export function normalizeFamilyIcalUrl(raw: string): string {
  return raw.trim().replace(/^webcal:/i, "https:");
}

function publicIcalUrl(): string | null {
  const raw = process.env.FAMILY_ICAL_URL?.trim();
  if (!raw) return null;
  return normalizeFamilyIcalUrl(raw);
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
    const parsed = parseIcsText(text);
    const next: CalendarCache = {
      fetchedAt: Date.now(),
      parsed,
      source: url ? "env" : "sample",
    };
    cache = next;
    windowCache = null;
    return next;
  } catch (error) {
    if (cache) {
      console.warn("calendar refresh failed; serving cached parse", error);
      return cache;
    }
    if (url) {
      console.warn("calendar fetch failed; falling back to sample", error);
      const text = await loadSample();
      const parsed = parseIcsText(text);
      const next: CalendarCache = { fetchedAt: Date.now(), parsed, source: "sample" };
      cache = next;
      windowCache = null;
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

export function parseIcsText(text: string): ParsedCalendar {
  return ical.sync.parseICS(text) as ParsedCalendar;
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

function isCancelled(event: VEvent): boolean {
  const status = String((event as VEvent & { status?: string }).status ?? "").toUpperCase();
  return status === "CANCELLED";
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
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone(TIMEZONE).toISO() ?? date.toISOString();
}

function durationMs(event: VEvent): number {
  const start = asDate(event.start);
  const end = asDate(event.end);
  if (start && end && end.getTime() > start.getTime()) {
    return end.getTime() - start.getTime();
  }
  return isAllDay(event) ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
}

function chicagoStamp(date: Date, allDay: boolean): string {
  if (allDay) {
    return DateTime.fromJSDate(date, { zone: "utc" }).toISODate() ?? "";
  }
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone(TIMEZONE).toFormat("yyyy-MM-dd'T'HH:mm");
}

function exdateList(event: VEvent): Date[] {
  const raw = (event as VEvent & { exdate?: Record<string, Date> | Date[] }).exdate;
  if (!raw) return [];
  // node-ical often stores EXDATE as an Array with date-string keys, so
  // numeric Array#filter misses them. Object.values keeps both shapes.
  return Object.values(raw).filter((stamp): stamp is Date => stamp instanceof Date);
}

function excluded(event: VEvent, occurrence: Date, allDay: boolean): boolean {
  const key = chicagoStamp(occurrence, allDay);
  if (!key) return false;
  return exdateList(event).some((stamp) => chicagoStamp(stamp, allDay) === key);
}

function overrideFor(event: VEvent, occurrence: Date): VEvent | null {
  const recurrences = (event as VEvent & { recurrences?: Record<string, VEvent> }).recurrences;
  if (!recurrences) return null;
  const chicago = DateTime.fromJSDate(occurrence, { zone: "utc" }).setZone(TIMEZONE).toFormat("yyyy-MM-dd");
  const utc = DateTime.fromJSDate(occurrence, { zone: "utc" }).toFormat("yyyy-MM-dd");
  return recurrences[chicago] ?? recurrences[utc] ?? recurrences[occurrence.toISOString()] ?? null;
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

function overlapsWindow(start: Date, end: Date, windowStart: Date, windowEnd: Date): boolean {
  return end >= windowStart && start <= windowEnd;
}

function recurrenceKey(event: VEvent): string | null {
  const stamp = asDate((event as VEvent & { recurrenceid?: Date }).recurrenceid);
  if (!stamp || !event.uid) return null;
  return `${event.uid}|${chicagoStamp(stamp, isAllDay(event))}`;
}

export function expandWindow(parsed: ParsedCalendar, fromIso: string, toIso: string): CalendarEvent[] {
  const windowStart = startOfDayCt(fromIso).toUTC().toJSDate();
  const windowEnd = endOfDayCt(toIso).toUTC().toJSDate();
  const out: CalendarEvent[] = [];
  const overrides = new Map<string, VEvent>();
  for (const item of Object.values(parsed)) {
    if (!item || item.type !== "VEVENT") continue;
    const event = item as VEvent;
    const key = recurrenceKey(event);
    if (key) overrides.set(key, event);
  }

  for (const item of Object.values(parsed)) {
    if (!item || item.type !== "VEVENT") continue;
    const event = item as VEvent;
    if (isCancelled(event)) continue;
    const start = asDate(event.start);
    if (!start) continue;

    if (event.rrule) {
      const until = rruleUntil(event);
      if (until && until < windowStart) continue;
      if (start > windowEnd) continue;

      const dates = event.rrule.between(windowStart, windowEnd, true);
      for (const date of dates) {
        const allDay = isAllDay(event);
        if (excluded(event, date, allDay)) continue;
        const override =
          overrideFor(event, date) ??
          (event.uid ? overrides.get(`${event.uid}|${chicagoStamp(date, allDay)}`) ?? null : null);
        if (override) {
          if (isCancelled(override)) continue;
          const oStart = asDate(override.start) ?? date;
          const oEnd = asDate(override.end) ?? new Date(oStart.getTime() + durationMs(override));
          if (!overlapsWindow(oStart, oEnd, windowStart, windowEnd)) continue;
          out.push(mapEvent(override, oStart, oEnd));
          continue;
        }
        const end = new Date(date.getTime() + durationMs(event));
        out.push(mapEvent(event, date, end));
      }
      continue;
    }

    const end = asDate(event.end) ?? new Date(start.getTime() + durationMs(event));
    if (!overlapsWindow(start, end, windowStart, windowEnd)) continue;
    if ((event as VEvent & { recurrenceid?: Date }).recurrenceid) continue;
    out.push(mapEvent(event, start, end));
  }

  out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return out.slice(0, MAX_WINDOW_EVENTS);
}

export function expandIcsText(text: string, fromIso: string, toIso: string): CalendarEvent[] {
  return expandWindow(parseIcsText(text), fromIso, toIso);
}

export async function getCalendarEvents(fromIso?: string, toIso?: string): Promise<CalendarEvent[]> {
  const window = calendarWindow(fromIso, toIso);
  const key = `${window.from}|${window.to}`;
  const { parsed, fetchedAt } = await getParsedCalendar();
  if (windowCache && windowCache.key === key && windowCache.fetchedAt === fetchedAt) {
    return windowCache.events;
  }
  const events = expandWindow(parsed, window.from, window.to);
  windowCache = { key, fetchedAt, events };
  return events;
}

export function calendarCacheMeta() {
  return {
    ageMs: cache ? Date.now() - cache.fetchedAt : null,
    source: cache?.source ?? null,
  };
}

export function resetCalendarCache() {
  cache = null;
  inflight = null;
  windowCache = null;
}
