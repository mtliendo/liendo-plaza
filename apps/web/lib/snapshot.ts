import { and, gte, lte } from "drizzle-orm";
import type { DisplaySnapshot, Meal, Person } from "@liendo/shared";
import { weekDates } from "@liendo/shared";
import { getCalendarEvents } from "./calendar";
import { ensureInstances } from "./chores";
import { getDb, schema } from "./db";
import { getSettings } from "./settings";
import { starSummaries } from "./stars";
import { calendarWindow, nowCt, todayIso } from "./time";
import { asPerson, toMeal } from "./person";
import { getWeather } from "./weather";
import { householdCached } from "./household-cache";

export async function peopleList(): Promise<Person[]> {
  const db = getDb();
  const rows = await db.select().from(schema.people);
  return rows.map(asPerson);
}

export async function mealsInRange(from: string, to: string): Promise<Meal[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.meals)
    .where(and(gte(schema.meals.date, from), lte(schema.meals.date, to)));
  return rows.map(toMeal);
}

export async function mealSuggestions(q: string): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ name: schema.meals.name }).from(schema.meals);
  const seen = new Set<string>();
  const needle = q.trim().toLowerCase();
  for (const row of rows) {
    if (!needle || row.name.toLowerCase().includes(needle)) {
      seen.add(row.name);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b)).slice(0, 12);
}

async function householdParts(from: string, to: string) {
  const [chores, meals, stars, people, settings] = await Promise.all([
    ensureInstances(from, to),
    mealsInRange(from, to),
    starSummaries(),
    peopleList(),
    getSettings(),
  ]);
  return { chores, meals, stars, people, settings };
}

const cachedHouseholdParts = householdCached(householdParts, "snapshot-household");

export async function buildSnapshot(
  fromIso?: string,
  toIso?: string,
  options: { cached?: boolean } = {},
): Promise<DisplaySnapshot> {
  const window = calendarWindow(fromIso, toIso);
  const parts = options.cached ? cachedHouseholdParts : householdParts;
  const [weather, events, household] = await Promise.all([
    getWeather(),
    getCalendarEvents(window.from, window.to),
    parts(window.from, window.to),
  ]);

  return {
    now: nowCt().toISO() ?? new Date().toISOString(),
    timezone: "America/Chicago",
    weather,
    events,
    ...household,
  };
}

export async function todaySnapshot(): Promise<DisplaySnapshot> {
  const today = todayIso();
  const week = weekDates(today);
  const snapshot = await buildSnapshot(week[0], week[6]);
  return {
    ...snapshot,
    events: snapshot.events.filter((event) => event.start.slice(0, 10) === today || (event.allDay && event.start === today)),
    chores: snapshot.chores.filter((chore) => chore.date === today),
    meals: snapshot.meals.filter((meal) => meal.date === today),
  };
}
