import {
  boolean,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  color: text("color").notNull(),
  pinHash: text("pin_hash"),
  pinFailedAttempts: integer("pin_failed_attempts").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  deviceId: uuid("device_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const displayPairings = pgTable("display_pairings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  deviceId: uuid("device_id"),
  label: text("label").notNull().default("Kitchen frame"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const pairingRequests = pgTable(
  "pairing_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    deviceKind: text("device_kind").notNull(),
    shortCode: text("short_code"),
    requestSecretHash: text("request_secret_hash").notNull(),
    inviteTokenHash: text("invite_token_hash"),
    status: text("status").notNull().default("pending"),
    approvedById: uuid("approved_by_id").references(() => people.id),
    deviceLabel: text("device_label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("pairing_requests_invite_token").on(table.inviteTokenHash)],
);

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  displayPairingId: uuid("display_pairing_id").references(() => displayPairings.id, { onDelete: "set null" }),
  createdById: uuid("created_by_id").references(() => people.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const chores = pgTable("chores", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  assignedPersonId: uuid("assigned_person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  stars: integer("stars").notNull(),
  requiresPhoto: boolean("requires_photo").notNull().default(false),
  repeatType: text("repeat_type").notNull(),
  weekdays: integer("weekdays").array(),
  weeklyWeekday: integer("weekly_weekday"),
  onceDate: date("once_date"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const choreInstances = pgTable(
  "chore_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    choreId: uuid("chore_id")
      .notNull()
      .references(() => chores.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: text("status").notNull().default("open"),
    starsAwarded: integer("stars_awarded").notNull().default(0),
    photoPath: text("photo_path"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedById: uuid("reviewed_by_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("chore_instances_chore_date").on(table.choreId, table.date)],
);

export const rewards = pgTable("rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  starCost: integer("star_cost").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rewardRequests = pgTable("reward_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  rewardId: uuid("reward_id")
    .notNull()
    .references(() => rewards.id, { onDelete: "cascade" }),
  personId: uuid("person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedById: uuid("reviewed_by_id").references(() => people.id),
});

export const meals = pgTable("meals", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull().unique(),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("push_tokens_person_token").on(table.personId, table.token)],
);
