import { addDays, WEEKDAY_LABELS } from "./dates";
import type { CalendarEvent, Person } from "./types";

export type EventFixture = "events-0" | "events-3" | "events-12";

export type EventPhase = "past" | "now" | "upcoming";

export type TodayEventModel = {
  event: CalendarEvent;
  phase: EventPhase;
  timeLabel: string;
  color?: string;
};

export function parseEventFixture(value: string | null | undefined): EventFixture | null {
  if (value === "events-0" || value === "events-3" || value === "events-12") return value;
  return null;
}

export function fixturesAllowed(env: { nodeEnv?: string; flag?: string } = {}): boolean {
  const nodeEnv = env.nodeEnv ?? (typeof process !== "undefined" ? process.env.NODE_ENV : undefined);
  const flag =
    env.flag ??
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_ALLOW_EVENT_FIXTURES ?? process.env.ALLOW_EVENT_FIXTURES
      : undefined);
  return nodeEnv !== "production" || flag === "1";
}

export function eventDay(iso: string) {
  return iso.slice(0, 10);
}

export function eventPhase(event: CalendarEvent, nowIso: string): EventPhase {
  if (event.allDay) return "upcoming";
  const now = new Date(nowIso).getTime();
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end) return "now";
  if (Number.isFinite(end) && end <= now) return "past";
  return "upcoming";
}

export function eventTimeLabel(event: CalendarEvent, phase: EventPhase) {
  if (phase === "now") return "Now";
  if (event.allDay) return "All day";
  return new Date(event.start).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

export function eventColor(event: CalendarEvent, people: Person[]): string | undefined {
  if (event.color) return event.color;
  const title = event.title.toLowerCase();
  return people.find((person) => title.includes(person.name.toLowerCase()))?.color;
}

export function nextUpcomingLabel(event: CalendarEvent): string {
  const date = eventDay(event.start);
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAY_LABELS[new Date(y, m - 1, d).getDay()];
  const time = event.allDay ? "All day" : eventTimeLabel(event, "upcoming");
  return `Next: ${weekday}, ${event.title} ${time}`;
}

export function planTodayEvents(
  events: CalendarEvent[],
  nowIso: string,
  people: Person[],
  maxVisible: number,
): {
  today: TodayEventModel[];
  visible: TodayEventModel[];
  moreCount: number;
  next: CalendarEvent | null;
} {
  const today = eventDay(nowIso);
  const todayEvents = events
    .filter((event) => eventDay(event.start) === today)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    })
    .map((event) => {
      const phase = eventPhase(event, nowIso);
      return {
        event,
        phase,
        timeLabel: eventTimeLabel(event, phase),
        color: eventColor(event, people),
      };
    });

  const next =
    events
      .filter((event) => eventDay(event.start) > today)
      .sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;

  if (todayEvents.length === 0) {
    return { today: [], visible: [], moreCount: 0, next };
  }

  const many = todayEvents.length >= 6;
  const pool = many ? todayEvents.filter((item) => item.phase !== "past") : todayEvents;
  const hiddenPast = many ? todayEvents.length - pool.length : 0;
  const visible = pool.slice(0, maxVisible);
  const moreCount = hiddenPast + Math.max(0, pool.length - visible.length);
  return { today: todayEvents, visible, moreCount, next };
}

type FixtureSpec = {
  title: string;
  hour?: number;
  minute?: number;
  durationMin?: number;
  allDay?: boolean;
  daysFromToday?: number;
};

function chicagoStamp(date: string, hour: number, minute: number) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date}T${pad(hour)}:${pad(minute)}:00-06:00`;
}

function fromSpecs(specs: FixtureSpec[], today: string, nowIso: string, people: Person[]): CalendarEvent[] {
  const now = new Date(nowIso);
  return specs.map((spec, index) => {
    const date = addDays(today, spec.daysFromToday ?? 0);
    const allDay = Boolean(spec.allDay);
    let start: string;
    let end: string;
    if (allDay) {
      start = date;
      end = addDays(date, 1);
    } else if (spec.hour === undefined) {
      const begin = new Date(now.getTime() - 40 * 60 * 1000);
      const finish = new Date(now.getTime() + 35 * 60 * 1000);
      start = begin.toISOString();
      end = finish.toISOString();
    } else {
      start = chicagoStamp(date, spec.hour, spec.minute ?? 0);
      const duration = spec.durationMin ?? 60;
      const endHour = spec.hour + Math.floor(((spec.minute ?? 0) + duration) / 60);
      const endMinute = ((spec.minute ?? 0) + duration) % 60;
      end = chicagoStamp(date, endHour, endMinute);
    }
    const event: CalendarEvent = {
      uid: `fixture-${index}-${spec.title}`,
      title: spec.title,
      start,
      end,
      allDay,
    };
    const color = eventColor(event, people);
    return color ? { ...event, color } : event;
  });
}

export function buildEventFixture(kind: EventFixture, nowIso: string, people: Person[]): CalendarEvent[] {
  const today = eventDay(nowIso);
  if (kind === "events-0") {
    return fromSpecs([{ title: "Noah's game", hour: 18, minute: 0, daysFromToday: 2 }], today, nowIso, people);
  }
  if (kind === "events-3") {
    return fromSpecs(
      [
        { title: "Sofia at grandma's", allDay: true },
        { title: "Sunday catch-up" },
        { title: "Family walk", hour: 19, minute: 30 },
      ],
      today,
      nowIso,
      people,
    );
  }
  return fromSpecs(
    [
      { title: "Library books due", allDay: true },
      { title: "Xavier home day", allDay: true },
      { title: "Drop-off", hour: 8, minute: 0, durationMin: 30 },
      { title: "Jess dentist", hour: 9, minute: 30, durationMin: 45 },
      { title: "Lunch with Focus", hour: 12, minute: 0, durationMin: 45 },
      { title: "Sunday catch-up" },
      { title: "Noah soccer", hour: 18, minute: 15, durationMin: 60 },
      {
        title: "Sofia band practice that runs quite late tonight at North High after rehearsal",
        hour: 18,
        minute: 45,
        durationMin: 75,
      },
      { title: "Xavier library hour", hour: 19, minute: 15 },
      { title: "Call grandma", hour: 19, minute: 45, durationMin: 30 },
      { title: "Family movie", hour: 20, minute: 0, durationMin: 90 },
      { title: "Bedtime stories", hour: 20, minute: 45, durationMin: 20 },
    ],
    today,
    nowIso,
    people,
  );
}
