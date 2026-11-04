import { DateTime } from "luxon";
import { expandIcsText, normalizeFamilyIcalUrl } from "../lib/calendar";
import { TIMEZONE } from "@liendo/shared";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function icsEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function buildLargeFeed() {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Liendo Plaza//Calendar Test//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VTIMEZONE",
    "TZID:America/Chicago",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0600",
    "TZNAME:CST",
    "DTSTART:20241103T020000",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0600",
    "TZOFFSETTO:-0500",
    "TZNAME:CDT",
    "DTSTART:20250309T020000",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:sunday-catchup@test.liendo.plaza",
    "DTSTART;TZID=America/Chicago:20200105T100000",
    "DTEND;TZID=America/Chicago:20200105T110000",
    "RRULE:FREQ=WEEKLY;BYDAY=SU",
    "EXDATE;TZID=America/Chicago:20251102T100000",
    "SUMMARY:Sunday catch-up",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:house-reset@test.liendo.plaza",
    "DTSTART;VALUE=DATE:20200104",
    "RRULE:FREQ=WEEKLY;BYDAY=SA",
    "SUMMARY:House reset",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:old-once@test.liendo.plaza",
    "DTSTART;TZID=America/Chicago:20190501T180000",
    "DTEND;TZID=America/Chicago:20190501T190000",
    "SUMMARY:Ancient picnic",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:cancelled-week@test.liendo.plaza",
    "DTSTART;TZID=America/Chicago:20200106T090000",
    "DTEND;TZID=America/Chicago:20200106T100000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "STATUS:CANCELLED",
    "SUMMARY:Cancelled Monday",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:sunday-catchup@test.liendo.plaza",
    "RECURRENCE-ID;TZID=America/Chicago:20251109T100000",
    "DTSTART;TZID=America/Chicago:20251109T150000",
    "DTEND;TZID=America/Chicago:20251109T160000",
    "SUMMARY:Sunday catch-up at 3",
    "END:VEVENT",
  ];

  for (let i = 0; i < 520; i += 1) {
    const year = 2018 + (i % 8);
    const month = String((i % 12) + 1).padStart(2, "0");
    const day = String((i % 28) + 1).padStart(2, "0");
    lines.push(
      "BEGIN:VEVENT",
      `UID:bulk-${i}@test.liendo.plaza`,
      `DTSTART;TZID=America/Chicago:${year}${month}${day}T120000`,
      `DTEND;TZID=America/Chicago:${year}${month}${day}T130000`,
      `SUMMARY:${icsEscape(`Bulk ${i}`)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function main() {
  assert(normalizeFamilyIcalUrl("webcal://cal.example/family.ics") === "https://cal.example/family.ics", "webcal should become https");
  assert(normalizeFamilyIcalUrl("https://cal.example/family.ics") === "https://cal.example/family.ics", "https should stay https");
  assert(normalizeFamilyIcalUrl("WEBCAL://cal.example/family.ics") === "https://cal.example/family.ics", "WEBCAL should become https");

  const text = buildLargeFeed();
  const started = Date.now();
  const events = expandIcsText(text, "2025-11-02", "2025-11-08");
  const elapsed = Date.now() - started;
  assert(elapsed < 1500, `expanding a 500+ event feed took ${elapsed}ms`);

  const titles = events.map((event) => event.title);
  assert(!titles.includes("Ancient picnic"), "old one-off leaked into the window");
  assert(!titles.includes("Cancelled Monday"), "cancelled recurring event leaked");
  assert(
    !events.some((event) => event.title === "Sunday catch-up" && event.start.startsWith("2025-11-02")),
    "EXDATE Sunday should be skipped",
  );

  const house = events.filter((event) => event.title === "House reset");
  assert(house.length >= 1, "all-day Saturday recurrence missing");
  assert(house.every((event) => event.allDay), "House reset should stay all-day");
  assert(house.every((event) => event.start === "2025-11-08" || event.start.startsWith("2025-11-08")), "all-day Saturday should land on Nov 8 Chicago");

  const sundays = events.filter((event) => event.title.startsWith("Sunday catch-up"));
  assert(
    sundays.every((event) => {
      const start = DateTime.fromISO(event.start, { setZone: true }).setZone(TIMEZONE);
      return start.weekday === 7 || event.allDay;
    }),
    "Sunday catch-up left America/Chicago",
  );

  assert(
    events.every((event) => event.start.slice(0, 10) >= "2025-11-02" && event.start.slice(0, 10) <= "2025-11-08"),
    "events leaked outside the requested window",
  );

  const later = expandIcsText(text, "2025-11-09", "2025-11-09");
  const moved = later.find((event) => event.title === "Sunday catch-up at 3");
  assert(moved, "recurrence override missing");
  const movedHour = DateTime.fromISO(moved.start, { setZone: true }).setZone(TIMEZONE).hour;
  assert(movedHour === 15, `override should be 3 PM Chicago, got ${movedHour}`);

  console.log(`calendar tests passed (${events.length} events in window, ${elapsed}ms)`);
}

main();
