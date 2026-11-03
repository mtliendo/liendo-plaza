import { eq } from "drizzle-orm";
import { FAMILY } from "@liendo/shared";
import { addDays, startOfWeekSunday } from "@liendo/shared";
import { hashPin } from "../lib/auth";
import { getDb, getPool, schema } from "../lib/db";
import { todayIso } from "../lib/time";

const SEED_PINS = {
  focus: "123456",
  jess: "123456",
  sofia: "1234",
  noah: "1234",
  xavier: "1234",
} as const;

async function main() {
  const db = getDb();

  for (const person of FAMILY) {
    const pin = SEED_PINS[person.slug];
    await db
      .insert(schema.people)
      .values({
        slug: person.slug,
        name: person.name,
        role: person.role,
        color: person.color,
        avatarKey: person.avatarKey,
        pinHash: await hashPin(pin),
      })
      .onConflictDoUpdate({
        target: schema.people.slug,
        set: {
          name: person.name,
          role: person.role,
          color: person.color,
          avatarKey: person.avatarKey,
          pinHash: await hashPin(pin),
          pinFailedAttempts: 0,
          pinLockedUntil: null,
        },
      });
  }

  const people = await db.select().from(schema.people);
  const bySlug = Object.fromEntries(people.map((row) => [row.slug, row]));

  const existingChores = await db.select().from(schema.chores);
  if (existingChores.length === 0) {
    await db.insert(schema.chores).values([
      {
        title: "Make your bed",
        assignedPersonId: bySlug.sofia.id,
        stars: 1,
        requiresPhoto: false,
        repeatType: "daily",
        description: "Pull the quilt smooth so the pillows sit at the head, the way we leave it on school mornings.",
        steps: ["Pull the sheet flat", "Smooth the quilt", "Put the pillows at the head"],
      },
      {
        title: "Unload the dishwasher",
        assignedPersonId: bySlug.noah.id,
        stars: 2,
        requiresPhoto: false,
        repeatType: "daily",
        description: "Empty the clean dishwasher and start a new load if the sink is full.",
        steps: ["Put away plates and bowls", "Put away cups and silverware", "Start a load if the sink is full"],
      },
      {
        title: "Feed the fish",
        assignedPersonId: bySlug.xavier.id,
        stars: 1,
        requiresPhoto: true,
        repeatType: "daily",
        description: "One pinch of flakes, then a photo so we can see the tank.",
        steps: ["One pinch of flakes", "Watch them eat for a minute", "Take a photo of the tank"],
      },
      {
        title: "Take out recycling",
        assignedPersonId: bySlug.noah.id,
        stars: 3,
        requiresPhoto: false,
        repeatType: "weekly",
        weeklyWeekday: 0,
        description: "Blue bin to the curb before dinner on Sunday.",
        steps: ["Break down boxes", "Carry the blue bin to the curb"],
      },
      {
        title: "Practice piano",
        assignedPersonId: bySlug.sofia.id,
        stars: 2,
        requiresPhoto: false,
        repeatType: "weekdays",
        weekdays: [1, 3, 5],
        description: "Fifteen minutes. Scales first, then whatever you’re working on.",
        steps: ["Scales for five minutes", "Play your piece twice"],
      },
    ]);
  }

  const existingRewards = await db.select().from(schema.rewards);
  if (existingRewards.length === 0) {
    await db.insert(schema.rewards).values([
      { name: "One-on-one ice cream", starCost: 12 },
      { name: "Pick Friday movie", starCost: 8 },
      { name: "Stay up 30 minutes late", starCost: 10 },
      { name: "Choose Saturday breakfast", starCost: 6 },
    ]);
  }

  const today = todayIso();
  const week = startOfWeekSunday(today);
  const dinners = [
    "Tacos",
    "Sheet-pan chicken",
    "Spaghetti",
    "Grilled cheese and soup",
    "Leftovers",
    "Pizza night",
    "Breakfast for dinner",
  ];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(week, i);
    await db
      .insert(schema.meals)
      .values({ date, name: dinners[i] ?? "Dinner" })
      .onConflictDoNothing({ target: schema.meals.date });
  }

  const [tonight] = await db.select().from(schema.meals).where(eq(schema.meals.date, today)).limit(1);
  if (tonight && !tonight.photoPath) {
    await db
      .update(schema.meals)
      .set({ photoPath: "/meals/tacos.jpg", updatedAt: new Date() })
      .where(eq(schema.meals.date, today));
  }

  await db
    .insert(schema.settings)
    .values({ key: "choreReminderHour", value: "18" })
    .onConflictDoNothing({ target: schema.settings.key });

  await getPool().end();
  console.log("seeded Focus, Jess, Sofia, Noah, Xavier");
  console.log("seed PINs: parents 123456, kids 1234");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
