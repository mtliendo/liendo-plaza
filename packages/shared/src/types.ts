export type RepeatType = "daily" | "weekdays" | "weekly" | "once";

export type ChoreStatus = "open" | "done" | "pending" | "rejected";

export type RewardRequestStatus = "pending" | "approved" | "rejected";

export type Person = {
  id: string;
  slug: string;
  name: string;
  role: "parent" | "kid";
  color: string;
  avatarKey: string | null;
};

export type CalendarEvent = {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  color?: string;
};

export type WeatherSnapshot = {
  temperatureF: number;
  weatherCode: number;
  label: string;
  fetchedAt: string;
};

export type Chore = {
  id: string;
  title: string;
  assignedPersonId: string;
  stars: number;
  requiresPhoto: boolean;
  repeatType: RepeatType;
  weekdays: number[] | null;
  weeklyWeekday: number | null;
  onceDate: string | null;
  active: boolean;
};

export type ChoreInstance = {
  id: string;
  choreId: string;
  personId: string;
  date: string;
  status: ChoreStatus;
  stars: number;
  starsAwarded: number;
  title: string;
  requiresPhoto: boolean;
  photoPath: string | null;
};

export type Reward = {
  id: string;
  name: string;
  starCost: number;
  active: boolean;
};

export type RewardRequest = {
  id: string;
  rewardId: string;
  rewardName: string;
  starCost: number;
  personId: string;
  personName: string;
  status: RewardRequestStatus;
  createdAt: string;
};

export type Meal = {
  date: string;
  name: string;
  photoPath: string | null;
};

export type StarSummary = {
  personId: string;
  personName: string;
  color: string;
  avatarKey: string | null;
  balance: number;
  weekEarned: number;
};

export type FamilySettings = {
  choreReminderHour: number;
  choreReminderMinute: number;
};

export type DisplaySnapshot = {
  now: string;
  timezone: string;
  weather: WeatherSnapshot | null;
  events: CalendarEvent[];
  chores: ChoreInstance[];
  meals: Meal[];
  stars: StarSummary[];
  people: Person[];
  settings: FamilySettings;
};

export type SessionUser = Person & {
  token: string;
};
