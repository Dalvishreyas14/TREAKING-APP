/**
 * Deterministic demo seed.
 *
 * Generates ~120 days of plausible history for one demo account so the
 * dashboard, analytics and AI surfaces have real data to render instead of
 * empty states. Deterministic on purpose: a fixed PRNG seed means repeated runs
 * produce identical data, which keeps screenshots and tests stable.
 *
 * Idempotent by deletion - the demo user's records are removed and rebuilt, and
 * every other user is left untouched.
 *
 * Runs under plain tsx rather than the Next.js runtime, so it cannot import
 * anything marked `server-only`.
 */
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash as argonHash } from "@node-rs/argon2";

import { PrismaClient } from "../src/generated/prisma/client";
import { ARGON_OPTIONS } from "../src/lib/auth/argon-params";

const DEMO_EMAIL = "demo@lifeos.app";
const DEMO_PASSWORD = "LIFEOSdemo2026";
const HISTORY_DAYS = 120;

// ----------------------------------------------------------------- rng

/** mulberry32: small, fast, and reproducible across runs and platforms. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(0x11fe05);

const int = (min: number, max: number) =>
  Math.floor(rng() * (max - min + 1)) + min;

const pick = <T,>(items: readonly T[]): T => items[int(0, items.length - 1)]!;

const chance = (probability: number) => rng() < probability;

/**
 * Builds a `ReportSection` in the exact shape `src/lib/ai/reports.ts` produces.
 * The `highlights`/`misses`/`patterns`/`recommendations` columns are untyped
 * `Json`, so seeding them as bare strings produces rows the report panel cannot
 * read - `section.kind` comes back undefined and the page throws. Keeping the
 * demo data in the real shape means the seeded reports exercise the same
 * rendering path as generated ones.
 */
const section = (
  kind: "PATTERN" | "CORRELATION" | "OBSERVATION" | "RECOMMENDATION",
  title: string,
  body: string,
  confidence: number,
  sampleSize: number,
) => ({ kind, title, body, confidence, sampleSize });

// --------------------------------------------------------------- dates

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight, which is what Prisma expects for `@db.Date` columns. */
function dateOnly(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}

const today = dateOnly(new Date());
const dayOffset = (days: number) => new Date(today.getTime() + days * DAY_MS);

/** A wall-clock time on a given day, expressed as minutes past midnight. */
function atMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setUTCMinutes(minutes);
  return d;
}

const isWeekend = (day: Date) => {
  const dow = day.getUTCDay();
  return dow === 0 || dow === 6;
};

// ---------------------------------------------------------------- setup

function databaseUrl(): string {
  const raw = readFileSync(".env", "utf8");
  const line = raw.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in .env");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl(), max: 5 }),
});

// -------------------------------------------------------------- content

const CATEGORIES = [
  { slug: "health", name: "Health", kind: "HEALTH", color: "#4ECDC4", icon: "heart" },
  { slug: "fitness", name: "Fitness", kind: "FITNESS", color: "#C8F751", icon: "dumbbell" },
  { slug: "study", name: "Study", kind: "STUDY", color: "#7C6BFF", icon: "book" },
  { slug: "career", name: "Career", kind: "CAREER", color: "#FFB020", icon: "briefcase" },
  { slug: "finance", name: "Finance", kind: "FINANCE", color: "#34D399", icon: "wallet" },
  { slug: "relationships", name: "Relationships", kind: "RELATIONSHIPS", color: "#FF6B9D", icon: "users" },
  { slug: "growth", name: "Personal growth", kind: "PERSONAL_GROWTH", color: "#8B5CF6", icon: "sparkles" },
  { slug: "rest", name: "Rest", kind: "REST", color: "#60A5FA", icon: "moon" },
  { slug: "hobbies", name: "Hobbies", kind: "HOBBIES", color: "#F472B6", icon: "palette" },
] as const;

const HABITS = [
  { name: "Morning walk", icon: "footprints", color: "#C8F751", type: "COUNT", unit: "km", target: 3, difficulty: "EASY", minutes: 420, category: "fitness" },
  { name: "Read", icon: "book-open", color: "#7C6BFF", type: "DURATION", unit: "min", target: 20, difficulty: "MEDIUM", minutes: 1260, category: "study" },
  { name: "Drink water", icon: "droplet", color: "#4ECDC4", type: "COUNT", unit: "glasses", target: 8, difficulty: "EASY", minutes: null, category: "health" },
  { name: "Journal", icon: "pen-line", color: "#FF6B9D", type: "BOOLEAN", unit: null, target: 1, difficulty: "MEDIUM", minutes: 1320, category: "growth" },
  { name: "Meditate", icon: "wind", color: "#8B5CF6", type: "DURATION", unit: "min", target: 10, difficulty: "MEDIUM", minutes: 420, category: "rest" },
  { name: "No screens after 10pm", icon: "smartphone", color: "#60A5FA", type: "BOOLEAN", unit: null, target: 1, difficulty: "HARD", minutes: null, category: "rest" },
  { name: "Strength training", icon: "dumbbell", color: "#FFB020", type: "BOOLEAN", unit: null, target: 1, difficulty: "HARD", minutes: 1020, category: "fitness" },
  { name: "Practice guitar", icon: "music", color: "#F472B6", type: "DURATION", unit: "min", target: 15, difficulty: "MEDIUM", minutes: 1140, category: "hobbies" },
] as const;

/**
 * Per-habit adherence. Deliberately varied: a uniform rate everywhere would make
 * the analytics page look synthetic and would flatten the very variation the
 * correlation engine needs as input.
 */
const HABIT_BASE_RATE: Record<string, number> = {
  "Morning walk": 0.72,
  Read: 0.63,
  "Drink water": 0.88,
  Journal: 0.55,
  Meditate: 0.48,
  "No screens after 10pm": 0.34,
  "Strength training": 0.41,
  "Practice guitar": 0.57,
};

/**
 * The shared system exercise library (userId null, isSystem true). Modest but
 * covering every muscle group the UI offers, so a fresh user can build a
 * session without typing every movement themselves.
 */
const SYSTEM_EXERCISES = [
  { name: "Bench Press", muscleGroup: "CHEST", equipment: "Barbell" },
  { name: "Incline Dumbbell Press", muscleGroup: "CHEST", equipment: "Dumbbell" },
  { name: "Push-up", muscleGroup: "CHEST", equipment: "Bodyweight" },
  { name: "Cable Fly", muscleGroup: "CHEST", equipment: "Cable" },
  { name: "Deadlift", muscleGroup: "BACK", equipment: "Barbell" },
  { name: "Pull-up", muscleGroup: "BACK", equipment: "Bodyweight" },
  { name: "Barbell Row", muscleGroup: "BACK", equipment: "Barbell" },
  { name: "Lat Pulldown", muscleGroup: "BACK", equipment: "Cable" },
  { name: "Overhead Press", muscleGroup: "SHOULDERS", equipment: "Barbell" },
  { name: "Lateral Raise", muscleGroup: "SHOULDERS", equipment: "Dumbbell" },
  { name: "Face Pull", muscleGroup: "SHOULDERS", equipment: "Cable" },
  { name: "Biceps Curl", muscleGroup: "ARMS", equipment: "Dumbbell" },
  { name: "Triceps Pushdown", muscleGroup: "ARMS", equipment: "Cable" },
  { name: "Hammer Curl", muscleGroup: "ARMS", equipment: "Dumbbell" },
  { name: "Plank", muscleGroup: "CORE", equipment: "Bodyweight" },
  { name: "Hanging Leg Raise", muscleGroup: "CORE", equipment: "Bodyweight" },
  { name: "Russian Twist", muscleGroup: "CORE", equipment: "Bodyweight" },
  { name: "Back Squat", muscleGroup: "LEGS", equipment: "Barbell" },
  { name: "Romanian Deadlift", muscleGroup: "LEGS", equipment: "Barbell" },
  { name: "Leg Press", muscleGroup: "LEGS", equipment: "Machine" },
  { name: "Walking Lunge", muscleGroup: "LEGS", equipment: "Dumbbell" },
  { name: "Leg Curl", muscleGroup: "LEGS", equipment: "Machine" },
  { name: "Hip Thrust", muscleGroup: "GLUTES", equipment: "Barbell" },
  { name: "Glute Bridge", muscleGroup: "GLUTES", equipment: "Bodyweight" },
  { name: "Treadmill Run", muscleGroup: "CARDIO", equipment: "Machine" },
  { name: "Rowing Machine", muscleGroup: "CARDIO", equipment: "Machine" },
  { name: "Stationary Bike", muscleGroup: "CARDIO", equipment: "Machine" },
  { name: "Jump Rope", muscleGroup: "CARDIO", equipment: "Bodyweight" },
  { name: "Kettlebell Swing", muscleGroup: "FULL_BODY", equipment: "Kettlebell" },
  { name: "Burpee", muscleGroup: "FULL_BODY", equipment: "Bodyweight" },
  { name: "Hip Flexor Stretch", muscleGroup: "OTHER", equipment: "Bodyweight" },
  { name: "Cat-Cow", muscleGroup: "OTHER", equipment: "Bodyweight" },
  { name: "Downward Dog", muscleGroup: "OTHER", equipment: "Bodyweight" },
] as const;

/**
 * Workout sessions. A strength set carries reps and weight; a timed set carries
 * seconds. The two are kept apart rather than collapsed into a single "amount"
 * so the seeded data has the same shape the app writes and reads.
 */
const WORKOUT_TEMPLATES = [
  {
    key: "push",
    name: "Push day",
    minutes: 55,
    exercises: [
      { name: "Bench Press", sets: 4, reps: [6, 10], weight: [40, 70] },
      { name: "Incline Dumbbell Press", sets: 3, reps: [8, 12], weight: [14, 22] },
      { name: "Overhead Press", sets: 3, reps: [8, 12], weight: [20, 32] },
      { name: "Triceps Pushdown", sets: 3, reps: [10, 15], weight: [15, 25] },
    ],
  },
  {
    key: "pull",
    name: "Pull day",
    minutes: 60,
    exercises: [
      { name: "Deadlift", sets: 3, reps: [5, 8], weight: [60, 100] },
      { name: "Pull-up", sets: 3, reps: [5, 10] },
      { name: "Barbell Row", sets: 3, reps: [8, 12], weight: [30, 50] },
      { name: "Biceps Curl", sets: 3, reps: [10, 15], weight: [10, 18] },
    ],
  },
  {
    key: "legs",
    name: "Leg day",
    minutes: 65,
    exercises: [
      { name: "Back Squat", sets: 4, reps: [6, 10], weight: [50, 90] },
      { name: "Romanian Deadlift", sets: 3, reps: [8, 12], weight: [40, 70] },
      { name: "Leg Press", sets: 3, reps: [10, 15], weight: [80, 140] },
      { name: "Walking Lunge", sets: 3, reps: [10, 14], weight: [10, 20] },
    ],
  },
  {
    key: "conditioning",
    name: "Conditioning",
    minutes: 40,
    exercises: [
      { name: "Treadmill Run", sets: 1, seconds: [1200, 2400] },
      { name: "Rowing Machine", sets: 1, seconds: [600, 1200] },
      { name: "Plank", sets: 3, seconds: [30, 90] },
    ],
  },
  {
    key: "mobility",
    name: "Mobility & core",
    minutes: 30,
    exercises: [
      { name: "Cat-Cow", sets: 2, seconds: [60, 120] },
      { name: "Downward Dog", sets: 3, seconds: [30, 60] },
      { name: "Hip Flexor Stretch", sets: 2, seconds: [45, 90] },
      { name: "Plank", sets: 3, seconds: [30, 75] },
    ],
  },
] as const;

/** Day of week (0 = Sunday) to the session trained that day, if any. */
const WORKOUT_SCHEDULE: Record<number, (typeof WORKOUT_TEMPLATES)[number]["key"] | null> = {
  0: "mobility",
  1: "push",
  2: "conditioning",
  3: null,
  4: "pull",
  5: null,
  6: "legs",
};

const GOALS = [
  {
    title: "Run a half marathon",
    description: "Build to 21 km without injury. Consistency over speed.",
    horizon: "LONG",
    color: "#C8F751",
    category: "fitness",
    progress: 62,
    startOffset: -75,
    targetOffset: 75,
    milestones: [
      { title: "Comfortable at 10 km", progress: 100, status: "DONE", offset: -30 },
      { title: "First 15 km long run", progress: 100, status: "DONE", offset: 5 },
      { title: "16 km continuous", progress: 45, status: "IN_PROGRESS", offset: 25 },
      { title: "Peak week taper", progress: 0, status: "PENDING", offset: 65 },
    ],
  },
  {
    title: "Ship the LIFEOS release",
    description: "Everything through hardening, then a public beta.",
    horizon: "MEDIUM",
    color: "#7C6BFF",
    category: "career",
    progress: 78,
    startOffset: -60,
    targetOffset: 40,
    milestones: [
      { title: "Auth and data model", progress: 100, status: "DONE", offset: -40 },
      { title: "Core tracking surfaces", progress: 100, status: "DONE", offset: -10 },
      { title: "AI surfaces", progress: 40, status: "IN_PROGRESS", offset: 20 },
      { title: "Public beta", progress: 0, status: "PENDING", offset: 40 },
    ],
  },
  {
    title: "Read 24 books this year",
    description: "Two a month, mostly non-fiction, some fiction for contrast.",
    horizon: "LONG",
    color: "#4ECDC4",
    category: "study",
    progress: 45,
    startOffset: -140,
    targetOffset: 165,
    milestones: [
      { title: "First six books", progress: 100, status: "DONE", offset: -100 },
      { title: "Twelve books", progress: 70, status: "IN_PROGRESS", offset: 10 },
      { title: "Twenty-four books", progress: 0, status: "PENDING", offset: 165 },
    ],
  },
  {
    title: "Three months of calm mornings",
    description: "Wake before 7, no phone for the first thirty minutes.",
    horizon: "SHORT",
    color: "#FF6B9D",
    category: "rest",
    progress: 30,
    startOffset: -40,
    targetOffset: 50,
    milestones: [
      { title: "Seven day streak", progress: 100, status: "DONE", offset: -25 },
      { title: "Thirty day streak", progress: 40, status: "IN_PROGRESS", offset: 10 },
    ],
  },
] as const;

const TASK_TEMPLATES = [
  { title: "Review the analytics dashboard", priority: "HIGH", energy: "MEDIUM", est: 45, category: "career", goal: 1 },
  { title: "Write the weekly review", priority: "MEDIUM", energy: "LOW", est: 25, category: "growth", goal: null },
  { title: "Fix the timezone bug in recurring tasks", priority: "URGENT", energy: "HIGH", est: 90, category: "career", goal: 1 },
  { title: "Plan meals for the week", priority: "LOW", energy: "LOW", est: 20, category: "health", goal: null },
  { title: "Read two chapters", priority: "MEDIUM", energy: "LOW", est: 30, category: "study", goal: 2 },
  { title: "Long run", priority: "HIGH", energy: "HIGH", est: 90, category: "fitness", goal: 0 },
  { title: "Reply to Sam about the weekend", priority: "MEDIUM", energy: "LOW", est: 10, category: "relationships", goal: null },
  { title: "Tidy the desk", priority: "LOW", energy: "LOW", est: 15, category: "rest", goal: null },
  { title: "Practice scales on guitar", priority: "MEDIUM", energy: "MEDIUM", est: 25, category: "hobbies", goal: null },
  { title: "Update the monthly budget", priority: "MEDIUM", energy: "MEDIUM", est: 40, category: "finance", goal: null },
  { title: "Call Mum", priority: "HIGH", energy: "LOW", est: 20, category: "relationships", goal: null },
  { title: "Refactor the auth service", priority: "HIGH", energy: "HIGH", est: 120, category: "career", goal: 1 },
] as const;

const JOURNAL_NOTES = [
  "Slow start, but the walk cleared my head before work.",
  "Too many meetings. The deep work block I wanted never happened.",
  "Ran further than expected. Small win.",
  "Read for twenty minutes before bed and it made the evening feel less wasteful.",
  "Argument with Sam that I could have handled better. Noted for next time.",
  "Good rhythm today. Protect the morning block.",
  "Low energy. Kept it light and that was the right call.",
  "Finished the refactor. Feels like real progress on the release.",
  "Slept badly, everything felt harder than it was.",
  "Tried the new scheduling. Much better than deciding in the moment.",
  "Rest day guilt again. Rest is part of the plan.",
  "Called Mum properly for once instead of texting.",
] as const;

async function main() {
  console.log("Seeding LIFEOS demo data...\n");

  const passwordHash = await argonHash(DEMO_PASSWORD, ARGON_OPTIONS);

  // Idempotency: remove the previous demo user. Cascades clear every
  // user-scoped record, so this cannot leave orphans behind.
  const existing = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true },
  });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
    console.log("removed previous demo user");
  }

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Alex Rivera",
      passwordHash,
      // Pre-verified so the demo account can sign in without an email round trip.
      emailVerified: new Date(),
      // Establishes the session-revocation baseline for the seeded password, so
      // a later reset has something to invalidate against.
      passwordChangedAt: new Date(),
      onboardedAt: dayOffset(-HISTORY_DAYS),
      timezone: "UTC",
      weekStartsOn: 1,
      theme: "DARK",
    },
  });
  console.log(`created user ${user.email}`);

  await prisma.profile.create({
    data: {
      userId: user.id,
      ageRange: "25-34",
      occupation: "Software engineer",
      wakeMinutes: 6 * 60 + 30,
      sleepMinutes: 23 * 60,
      availableWeekdayMinutes: 240,
      availableWeekendMinutes: 300,
      studyTargetMinutes: 60,
      fitnessFrequency: 4,
      productivityStyle: "Deep work before noon, admin after lunch",
      focusPreference: "Pomodoro for warmups, long blocks for hard problems",
      workLabel: "Remote engineering",
      workStartMinutes: 9 * 60 + 30,
      workEndMinutes: 18 * 60,
      workDays: [1, 2, 3, 4, 5],
      importantHabits: ["Morning walk", "Read", "No screens after 10pm"],
      goalsSummary: "Half marathon, ship LIFEOS, read more, calmer mornings.",
    },
  });

  await prisma.userStats.create({
    data: {
      userId: user.id,
      xp: 4820,
      level: 12,
      currentStreak: 9,
      longestStreak: 23,
      freezeTokens: 2,
      lastActivityDate: today,
      tasksCompleted: 214,
      habitsCompleted: 968,
      focusMinutes: 3180,
      goalsAchieved: 1,
    },
  });

  // Categories are system-wide (userId null). Postgres treats NULLs as
  // distinct in a unique index, so a compound-unique upsert could create
  // duplicates. Resolving by hand keeps this idempotent.
  const categoryIds = new Map<string, string>();
  for (const [index, c] of CATEGORIES.entries()) {
    let row = await prisma.category.findFirst({
      where: { slug: c.slug, userId: null },
      select: { id: true },
    });
    if (!row) {
      row = await prisma.category.create({
        data: {
          userId: null,
          name: c.name,
          slug: c.slug,
          kind: c.kind,
          color: c.color,
          icon: c.icon,
          isSystem: true,
          sortOrder: index,
        },
        select: { id: true },
      });
    }
    categoryIds.set(c.slug, row.id);
  }
  console.log(`resolved ${categoryIds.size} system categories`);

  // ------------------------------------------------- exercise library
  //
  // System exercises are shared (userId null) and therefore outlive the demo
  // user's deletion. `(userId, name)` is unique, but Postgres treats NULLs as
  // distinct, so - exactly like categories - they are resolved by hand rather
  // than upserted, or a second seed run would create a duplicate library.

  const exerciseIdByName = new Map<string, string>();
  for (const e of SYSTEM_EXERCISES) {
    let row = await prisma.exercise.findFirst({
      where: { userId: null, name: e.name },
      select: { id: true },
    });
    if (!row) {
      row = await prisma.exercise.create({
        data: {
          userId: null,
          isSystem: true,
          name: e.name,
          muscleGroup: e.muscleGroup,
          equipment: e.equipment,
        },
        select: { id: true },
      });
    }
    exerciseIdByName.set(e.name, row.id);
  }
  console.log(`resolved ${exerciseIdByName.size} system exercises`);

  const tagIds: string[] = [];
  for (const t of [
    { name: "deep-work", color: "#7C6BFF" },
    { name: "quick-win", color: "#34D399" },
    { name: "waiting-on", color: "#FFB020" },
    { name: "recurring", color: "#4ECDC4" },
  ]) {
    const row = await prisma.tag.create({
      data: { userId: user.id, name: t.name, slug: t.name, color: t.color },
      select: { id: true },
    });
    tagIds.push(row.id);
  }

  // ------------------------------------------------------------- goals

  const goalIds: string[] = [];
  for (const g of GOALS) {
    const goal = await prisma.goal.create({
      data: {
        userId: user.id,
        title: g.title,
        description: g.description,
        horizon: g.horizon,
        status: "ACTIVE",
        color: g.color,
        progress: g.progress,
        startDate: dayOffset(g.startOffset),
        targetDate: dayOffset(g.targetOffset),
        categoryId: categoryIds.get(g.category) ?? null,
        xpReward: 250,
      },
      select: { id: true },
    });
    goalIds.push(goal.id);

    for (const [i, m] of g.milestones.entries()) {
      await prisma.goalMilestone.create({
        data: {
          goalId: goal.id,
          title: m.title,
          status: m.status,
          progress: m.progress,
          targetDate: dayOffset(m.offset),
          completedAt: m.status === "DONE" ? dayOffset(m.offset) : null,
          sortOrder: i,
        },
      });
    }

    // Weekly check-ins, walking backwards from the present, so the progress
    // curve has a history rather than a single point.
    for (let week = 1; week <= 4; week++) {
      await prisma.goalCheckIn.create({
        data: {
          goalId: goal.id,
          progress: Math.max(0, g.progress - week * 4 - int(0, 3)),
          note: week === 1 ? "On track this week." : null,
        },
      });
    }
  }
  console.log(`created ${goalIds.length} goals with milestones and check-ins`);

  // ------------------------------------------------------------ habits

  const habitIds: string[] = [];
  for (const h of HABITS) {
    const habit = await prisma.habit.create({
      data: {
        userId: user.id,
        name: h.name,
        description: null,
        icon: h.icon,
        color: h.color,
        type: h.type,
        difficulty: h.difficulty,
        frequency: "DAILY",
        unit: h.unit,
        targetValue: h.target,
        targetMinutes: h.minutes,
        preferredMinutes: h.minutes,
        startDate: dayOffset(-HISTORY_DAYS),
        categoryId: categoryIds.get(h.category) ?? null,
      },
      select: { id: true, name: true, type: true, targetValue: true },
    });
    habitIds.push(habit.id);

    // Habit logs for the whole history window. Volume is high on purpose: this
    // is what the streak, heatmap and correlation surfaces read from.
    const logs: {
      userId: string;
      habitId: string;
      date: Date;
      value: number;
      completed: boolean;
    }[] = [];

    for (let back = HISTORY_DAYS; back >= 0; back--) {
      const day = dayOffset(-back);
      // Weekends are consistently worse, which is true of most people's habits
      // and gives the analytics something honest to surface.
      const base = HABIT_BASE_RATE[h.name] ?? 0.6;
      const rate = isWeekend(day) ? base * 0.72 : base;
      const hit = chance(rate);

      let value = 0;
      if (hit) {
        if (h.type === "BOOLEAN") value = 1;
        else if (h.type === "DURATION") value = h.target * (0.7 + rng() * 0.9);
        // COUNT and QUANTITY both accumulate towards a numeric target.
        else value = Math.max(1, Math.round(h.target * (0.6 + rng() * 0.8)));
      }
      value = Math.round(value * 100) / 100;

      logs.push({
        userId: user.id,
        habitId: habit.id,
        date: day,
        value,
        completed: hit,
      });
    }

    await prisma.habitLog.createMany({ data: logs });
  }
  console.log(`created ${habitIds.length} habits with ${(HISTORY_DAYS + 1) * habitIds.length} logs`);

  // ------------------------------------------------------------ workouts
  //
  // Strength and cardio history, scheduled by day of week with a realistic miss
  // rate. This is what the fitness log, the personal-best table and the weekly
  // chart read from; without it those surfaces are empty on first load.

  let workoutCount = 0;
  let workoutSetCount = 0;

  for (let back = HISTORY_DAYS; back >= 0; back--) {
    const day = dayOffset(-back);
    const key = WORKOUT_SCHEDULE[day.getUTCDay()];
    if (!key) continue;
    // Roughly one session in five is skipped, which keeps streaks and weekly
    // totals from reading as a perfect, obviously-synthetic record.
    if (back !== 0 && chance(0.2)) continue;

    const template = WORKOUT_TEMPLATES.find((t) => t.key === key)!;
    const startAt = atMinutes(day, (key === "mobility" ? 9 : 18) * 60);
    const minutes = template.minutes + int(-1, 1) * 5;

    const workout = await prisma.workout.create({
      data: {
        userId: user.id,
        name: template.name,
        date: day,
        startAt,
        minutes,
        status: "COMPLETED",
        completedAt: new Date(startAt.getTime() + minutes * 60_000),
        categoryId: categoryIds.get("fitness") ?? null,
        // Conditioning is the training that serves the half-marathon goal.
        goalId: key === "conditioning" ? (goalIds[0] ?? null) : null,
      },
      select: { id: true },
    });
    workoutCount++;

    for (const [i, exercise] of template.exercises.entries()) {
      const row = await prisma.workoutExercise.create({
        data: {
          workoutId: workout.id,
          exerciseId: exerciseIdByName.get(exercise.name) ?? null,
          name: exercise.name,
          position: i,
        },
        select: { id: true },
      });

      const sets: {
        workoutExerciseId: string;
        position: number;
        reps?: number;
        weight?: number;
        durationSeconds?: number;
        restSeconds: number;
        completed: boolean;
      }[] = [];

      for (let s = 0; s < exercise.sets; s++) {
        if ("reps" in exercise) {
          const set: (typeof sets)[number] = {
            workoutExerciseId: row.id,
            position: s,
            reps: int(exercise.reps[0], exercise.reps[1]),
            restSeconds: int(60, 120),
            completed: true,
          };
          if ("weight" in exercise) {
            const raw = int(exercise.weight[0], exercise.weight[1]);
            // Plates go up in 2.5 kg steps, so a 43.7 kg lift would be a lie.
            set.weight = Math.round(raw / 2.5) * 2.5;
          }
          sets.push(set);
        } else {
          sets.push({
            workoutExerciseId: row.id,
            position: s,
            durationSeconds: int(exercise.seconds[0], exercise.seconds[1]),
            restSeconds: int(30, 60),
            completed: true,
          });
        }
      }

      await prisma.workoutSet.createMany({ data: sets });
      workoutSetCount += sets.length;
    }
  }
  console.log(`created ${workoutCount} completed workouts with ${workoutSetCount} sets`);

  // One planned session in the near future, placed on the planner in the same
  // way the API does, so "planned vs logged" and the planner link both have
  // something real to render.
  const planDay = dayOffset(1);
  const planMinutes = 50;
  const planStart = atMinutes(planDay, 18 * 60);
  const plannedWorkout = await prisma.workout.create({
    data: {
      userId: user.id,
      name: "Push day",
      date: planDay,
      startAt: planStart,
      minutes: planMinutes,
      status: "PLANNED",
      categoryId: categoryIds.get("fitness") ?? null,
      exercises: {
        create: [
          {
            name: "Bench Press",
            position: 0,
            exerciseId: exerciseIdByName.get("Bench Press") ?? null,
            sets: {
              create: [
                { position: 0, reps: 8, weight: 40, restSeconds: 90 },
                { position: 1, reps: 8, weight: 40, restSeconds: 90 },
                { position: 2, reps: 6, weight: 42.5, restSeconds: 120 },
              ],
            },
          },
          {
            name: "Overhead Press",
            position: 1,
            exerciseId: exerciseIdByName.get("Overhead Press") ?? null,
            sets: {
              create: [
                { position: 0, reps: 10, weight: 22.5, restSeconds: 90 },
                { position: 1, reps: 10, weight: 22.5, restSeconds: 90 },
              ],
            },
          },
        ],
      },
    },
    select: { id: true },
  });
  await prisma.timeBlock.create({
    data: {
      userId: user.id,
      title: "Push day",
      date: planDay,
      startAt: planStart,
      endAt: new Date(planStart.getTime() + planMinutes * 60_000),
      color: "#C8F751",
      source: "MANUAL",
      workoutId: plannedWorkout.id,
    },
  });
  console.log("created 1 planned workout scheduled on the planner");

  // A ready-made weekly routine, active, so the weekly planner has a real
  // template behind it on first load. `generatedThrough` is deliberately left
  // null: the first schedule read materialises the week lazily, which is the
  // exact path a user's own routine takes.
  const routineExercise = (
    name: string,
    sets: { reps?: number; weight?: number; durationSeconds?: number; restSeconds?: number }[],
  ) => ({
    exerciseId: exerciseIdByName.get(name) ?? null,
    name,
    restSeconds: null,
    sets: {
      create: sets.map((set, index) => ({
        position: index,
        reps: set.reps ?? null,
        weight: set.weight ?? null,
        durationSeconds: set.durationSeconds ?? null,
        restSeconds: set.restSeconds ?? null,
      })),
    },
  });

  await prisma.workoutRoutine.create({
    data: {
      userId: user.id,
      name: "Push · Pull · Legs",
      description: "Three strength days with active recovery, repeating weekly.",
      color: "#C8F751",
      isActive: true,
      activatedAt: new Date(),
      days: {
        create: [
          {
            weekday: 0,
            name: "Push",
            muscleGroups: ["Chest", "Shoulders", "Triceps"],
            position: 0,
            targetMinutes: 55,
            exercises: {
              create: [
                routineExercise("Bench Press", [
                  { reps: 8, weight: 45, restSeconds: 120 },
                  { reps: 8, weight: 45, restSeconds: 120 },
                  { reps: 6, weight: 50, restSeconds: 150 },
                ]),
                routineExercise("Overhead Press", [
                  { reps: 10, weight: 25, restSeconds: 90 },
                  { reps: 10, weight: 25, restSeconds: 90 },
                ]),
                routineExercise("Triceps Pushdown", [
                  { reps: 12, weight: 20, restSeconds: 60 },
                  { reps: 12, weight: 20, restSeconds: 60 },
                ]),
              ],
            },
          },
          { weekday: 1, name: "Rest", isRest: true, position: 1 },
          {
            weekday: 2,
            name: "Pull",
            muscleGroups: ["Back", "Biceps"],
            position: 2,
            targetMinutes: 60,
            exercises: {
              create: [
                routineExercise("Deadlift", [
                  { reps: 6, weight: 80, restSeconds: 180 },
                  { reps: 6, weight: 80, restSeconds: 180 },
                  { reps: 5, weight: 90, restSeconds: 180 },
                ]),
                routineExercise("Barbell Row", [
                  { reps: 10, weight: 40, restSeconds: 90 },
                  { reps: 10, weight: 40, restSeconds: 90 },
                ]),
                routineExercise("Biceps Curl", [
                  { reps: 12, weight: 14, restSeconds: 60 },
                  { reps: 12, weight: 14, restSeconds: 60 },
                ]),
              ],
            },
          },
          { weekday: 3, name: "Rest", isRest: true, position: 3 },
          {
            weekday: 4,
            name: "Legs",
            muscleGroups: ["Legs", "Glutes", "Abs"],
            position: 4,
            targetMinutes: 60,
            exercises: {
              create: [
                routineExercise("Back Squat", [
                  { reps: 8, weight: 60, restSeconds: 150 },
                  { reps: 8, weight: 60, restSeconds: 150 },
                  { reps: 6, weight: 70, restSeconds: 180 },
                ]),
                routineExercise("Romanian Deadlift", [
                  { reps: 10, weight: 50, restSeconds: 90 },
                  { reps: 10, weight: 50, restSeconds: 90 },
                ]),
                routineExercise("Plank", [
                  { durationSeconds: 60, restSeconds: 45 },
                  { durationSeconds: 60, restSeconds: 45 },
                ]),
              ],
            },
          },
          { weekday: 5, name: "Rest", isRest: true, position: 5 },
          {
            weekday: 6,
            name: "Mobility",
            muscleGroups: ["Mobility", "Core"],
            position: 6,
            targetMinutes: 30,
            exercises: {
              create: [
                routineExercise("Cat-Cow", [{ durationSeconds: 90, restSeconds: 30 }]),
                routineExercise("Downward Dog", [{ durationSeconds: 45, restSeconds: 30 }]),
                routineExercise("Hip Flexor Stretch", [{ durationSeconds: 60, restSeconds: 30 }]),
              ],
            },
          },
        ],
      },
    },
    select: { id: true },
  });
  console.log("created 1 active weekly routine (Push · Pull · Legs)");

  // -------------------------------------------------- mood and energy

  /**
   * Mood and energy are correlated with each other and inversely with stress,
   * and both dip on weekends and after poor sleep. Without that structure the
   * correlation engine would have nothing true to find, so the relationships
   * are modelled rather than randomised independently.
   */
  const wellbeing: {
    userId: string;
    date: Date;
    mood: number;
    energy: number;
    stress: number;
    sleepQuality: number;
    sleepHours: number;
    note: string | null;
  }[] = [];

  for (let back = HISTORY_DAYS; back >= 0; back--) {
    const day = dayOffset(-back);
    const sleepQuality = Math.min(5, Math.max(1, int(1, 5)));
    const sleepHours = Math.round((5.5 + sleepQuality * 0.45 + (rng() - 0.5)) * 10) / 10;
    const base = sleepQuality >= 4 ? 4 : sleepQuality === 3 ? 3 : 2;
    const mood = Math.min(5, Math.max(1, base + (chance(0.6) ? 1 : 0) - (isWeekend(day) ? 0 : 0)));
    const energy = Math.min(5, Math.max(1, base + (chance(0.5) ? 0 : 1)));
    const stress = Math.min(5, Math.max(1, 6 - base + (chance(0.4) ? 1 : 0)));

    wellbeing.push({
      userId: user.id,
      date: day,
      mood,
      energy,
      stress,
      sleepQuality,
      sleepHours,
      note: chance(0.18) ? pick(JOURNAL_NOTES) : null,
    });
  }
  await prisma.moodEnergyEntry.createMany({ data: wellbeing });
  console.log(`created ${wellbeing.length} wellbeing entries`);

  // ------------------------------------------------------------ journal

  // Roughly every third day, which is a believable journalling habit rather
  // than a daily one.
  const journal: {
    userId: string;
    date: Date;
    title: string | null;
    content: string;
    mood: number | null;
    energy: number | null;
    tags: string[];
    wordCount: number;
  }[] = [];

  for (let back = HISTORY_DAYS; back >= 0; back -= int(2, 4)) {
    const day = dayOffset(-back);
    const content = pick(JOURNAL_NOTES);
    const w = wellbeing.find((entry) => entry.date.getTime() === day.getTime());
    journal.push({
      userId: user.id,
      date: day,
      title: null,
      content,
      mood: w?.mood ?? null,
      energy: w?.energy ?? null,
      tags: [],
      wordCount: content.split(/\s+/).length,
    });
  }
  await prisma.journalEntry.createMany({ data: journal });
  console.log(`created ${journal.length} journal entries`);

  // ------------------------------------------------------ focus sessions

  const focus: {
    userId: string;
    startedAt: Date;
    endedAt: Date;
    plannedSeconds: number;
    actualSeconds: number;
    type: "POMODORO" | "DEEP_WORK" | "CUSTOM";
    rating: number | null;
    endedEarly: boolean;
    xpAwarded: number;
  }[] = [];

  for (let back = HISTORY_DAYS; back >= 0; back--) {
    const day = dayOffset(-back);
    const sessions = isWeekend(day) ? int(0, 2) : int(1, 3);
    for (let s = 0; s < sessions; s++) {
      const planned = chance(0.25) ? 50 * 60 : 25 * 60;
      // Most sessions finish; the rest are cut short, which is what the
      // "actual vs planned" analytics need to be meaningful.
      const endedEarly = chance(0.22);
      const actual = endedEarly ? Math.round(planned * (0.3 + rng() * 0.4)) : planned;
      const startMinutes = 8 * 60 + int(0, 9) * 60 + int(0, 5) * 15 + s * 60;
      const startedAt = atMinutes(day, startMinutes);
      focus.push({
        userId: user.id,
        startedAt,
        endedAt: new Date(startedAt.getTime() + actual * 1000),
        plannedSeconds: planned,
        actualSeconds: actual,
        type: planned > 30 * 60 ? "DEEP_WORK" : "POMODORO",
        rating: endedEarly ? int(2, 3) : int(3, 5),
        endedEarly,
        xpAwarded: Math.round(actual / 60) * 2,
      });
    }
  }
  await prisma.focusSession.createMany({ data: focus });
  console.log(`created ${focus.length} focus sessions`);

  // ------------------------------------------------------------- tasks

  const taskIds: string[] = [];

  // Open tasks, spread across today and the next fortnight.
  for (let offset = 0; offset < 14; offset++) {
    const count = int(2, 5);
    for (let n = 0; n < count; n++) {
      const t = pick(TASK_TEMPLATES);
      const due = dayOffset(offset);
      const task = await prisma.task.create({
        data: {
          userId: user.id,
          title: t.title,
          status: offset === 0 && chance(0.4) ? "IN_PROGRESS" : "TODO",
          priority: t.priority,
          energy: t.energy,
          importance: t.priority === "URGENT" ? 5 : t.priority === "HIGH" ? 4 : 3,
          urgency: t.priority === "URGENT" ? 5 : t.priority === "HIGH" ? 4 : 2,
          estimatedMinutes: t.est,
          startAt: atMinutes(due, int(8, 18) * 60),
          dueAt: atMinutes(due, int(8, 19) * 60 + int(0, 11) * 60),
          categoryId: categoryIds.get(t.category) ?? null,
          goalId: t.goal === null ? null : (goalIds[t.goal] ?? null),
          sortOrder: n,
        },
        select: { id: true },
      });
      taskIds.push(task.id);
    }
  }

  // History: completed work over the last six weeks, so streaks and
  // "tasks completed" charts are not empty.
  let completedCount = 0;
  for (let back = 42; back >= 1; back--) {
    const day = dayOffset(-back);
    for (let n = 0; n < int(1, 4); n++) {
      const t = pick(TASK_TEMPLATES);
      const doneAt = atMinutes(day, int(9, 19) * 60);
      await prisma.task.create({
        data: {
          userId: user.id,
          title: t.title,
          status: chance(0.08) ? "CANCELLED" : "DONE",
          priority: t.priority,
          energy: t.energy,
          estimatedMinutes: t.est,
          actualMinutes: Math.round(t.est * (0.7 + rng() * 0.8)),
          dueAt: atMinutes(day, 18 * 60),
          completedAt: doneAt,
          categoryId: categoryIds.get(t.category) ?? null,
        },
      });
      completedCount++;
    }
  }

  // A couple of blocked and archived tasks, so those states are represented.
  await prisma.task.createMany({
    data: [
      {
        userId: user.id,
        title: "Waiting on the design review",
        notes: "Blocked until Sam sends the updated mockups.",
        status: "BLOCKED",
        priority: "HIGH",
        energy: "LOW",
        estimatedMinutes: 45,
        categoryId: categoryIds.get("career") ?? null,
      },
      {
        userId: user.id,
        title: "Old sprint cleanup",
        status: "ARCHIVED",
        priority: "LOW",
        energy: "LOW",
        categoryId: categoryIds.get("career") ?? null,
      },
    ],
  });

  // Tag a few tasks so tag filters have something to filter.
  for (const taskId of taskIds.slice(0, 4)) {
    await prisma.taskTag.create({
      data: { taskId, tagId: tagIds[0]! },
    });
  }
  console.log(`created ${taskIds.length} open tasks and ${completedCount} historical tasks`);

  // ---------------------------------------------------------- projects

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: "LIFEOS public beta",
      description: "Ship the hardening phase and open the beta to fifty people.",
      status: "ACTIVE",
      color: "#7C6BFF",
      icon: "rocket",
      // The beta is how the release goal actually gets done, so the link is
      // seeded rather than left null. Without it every goal reads as having no
      // project work beneath it and the goal -> project view is untestable.
      goalId: goalIds[1] ?? null,
      startAt: dayOffset(-30),
      dueAt: dayOffset(30),
      sortOrder: 0,
    },
    select: { id: true },
  });

  const projectMilestones = await Promise.all(
    [
      { title: "Data model and auth", status: "DONE" },
      { title: "Core tracking surfaces", status: "DONE" },
      { title: "Analytics and reports", status: "IN_PROGRESS" },
      { title: "Beta launch", status: "PENDING" },
    ].map((m, i) =>
      prisma.projectMilestone.create({
        data: {
          projectId: project.id,
          title: m.title,
          status: m.status as "DONE" | "IN_PROGRESS" | "PENDING",
          dueAt: dayOffset(10 + i * 7),
          completedAt: m.status === "DONE" ? dayOffset(10 + i * 7) : null,
          sortOrder: i,
        },
        select: { id: true },
      }),
    ),
  );

  for (const [i, taskId] of taskIds.slice(0, 6).entries()) {
    await prisma.projectTask.create({
      data: {
        userId: user.id,
        projectId: project.id,
        taskId,
        milestoneId: projectMilestones[Math.min(2, Math.floor(i / 2))]!.id,
        sortOrder: i,
      },
    });
  }
  console.log("created project with milestones and task links");

  // A second project, under a different goal, so the hierarchy is a real tree
  // rather than one project hanging off one goal. A single project proves
  // nothing about whether the boards group or link correctly.
  const trainingProject = await prisma.project.create({
    data: {
      userId: user.id,
      name: "Half marathon build",
      description: "Sixteen weeks of base miles, long runs, and two race rehearsals.",
      status: "ACTIVE",
      color: "#F2A03D",
      icon: "run",
      goalId: goalIds[0] ?? null,
      startAt: dayOffset(-28),
      dueAt: dayOffset(70),
      sortOrder: 1,
    },
    select: { id: true },
  });

  await prisma.projectTask.createMany({
    data: taskIds.slice(6, 10).map((taskId, i) => ({
      userId: user.id,
      projectId: trainingProject.id,
      taskId,
      sortOrder: i,
    })),
  });
  console.log("created training project with task links");

  // Focus sessions were created before the projects existed, so attribution is
  // backfilled here. The most recent work goes to the beta, an earlier block to
  // the training block, and the remainder is deliberately left unattributed:
  // "focus spent with no project attached" is a real state the dashboard
  // reports on, and seeding every session would quietly delete that signal.
  const recentFocus = await prisma.focusSession.findMany({
    where: { userId: user.id, projectId: null },
    orderBy: { startedAt: "desc" },
    select: { id: true },
    take: 30,
  });

  if (recentFocus.length > 0) {
    const split = Math.max(1, Math.floor(recentFocus.length * 0.7));
    await prisma.focusSession.updateMany({
      where: { id: { in: recentFocus.slice(0, split).map((f) => f.id) } },
      data: { projectId: project.id },
    });
    await prisma.focusSession.updateMany({
      where: { id: { in: recentFocus.slice(split).map((f) => f.id) } },
      data: { projectId: trainingProject.id },
    });
    console.log(`attributed ${recentFocus.length} focus sessions to projects`);
  }

  // ----------------------------------------------------------- routines

  const morningRoutine = await prisma.routine.create({
    data: {
      userId: user.id,
      name: "Morning routine",
      description: "How the day starts, before email and messages.",
      kind: "MORNING",
      timeOfDay: 6 * 60 + 40,
      color: "#FFB020",
      icon: "sunrise",
      sortOrder: 0,
    },
    select: { id: true },
  });

  const morningItems = [
    { title: "Walk 3 km", minutes: 45, habit: "Morning walk", category: "fitness" },
    { title: "Shower and dress", minutes: 15, habit: null, category: "rest" },
    { title: "Read 20 minutes", minutes: 20, habit: "Read", category: "study" },
    { title: "Meditate", minutes: 10, habit: "Meditate", category: "rest" },
    { title: "Write the day's top three", minutes: 10, habit: null, category: "growth" },
  ] as const;

  for (const [i, item] of morningItems.entries()) {
    const habit = item.habit
      ? await prisma.habit.findFirst({
          where: { userId: user.id, name: item.habit },
          select: { id: true },
        })
      : null;
    await prisma.routineItem.create({
      data: {
        routineId: morningRoutine.id,
        title: item.title,
        estimatedMinutes: item.minutes,
        categoryId: categoryIds.get(item.category) ?? null,
        habitId: habit?.id ?? null,
        sortOrder: i,
      },
    });
  }

  const eveningRoutine = await prisma.routine.create({
    data: {
      userId: user.id,
      name: "Evening shutdown",
      description: "Close the laptop, clear the head, sleep on time.",
      kind: "EVENING",
      timeOfDay: 21 * 60 + 30,
      color: "#7C6BFF",
      icon: "moon",
      sortOrder: 1,
    },
    select: { id: true },
  });

  for (const [i, item] of [
    { title: "Tidy the desk", minutes: 10 },
    { title: "Journal", minutes: 10 },
    { title: "Lay out tomorrow's clothes", minutes: 5 },
    { title: "Screens off", minutes: 0 },
  ].entries()) {
    await prisma.routineItem.create({
      data: {
        routineId: eveningRoutine.id,
        title: item.title,
        estimatedMinutes: item.minutes,
        sortOrder: i,
      },
    });
  }
  console.log("created 2 routines with items");

  // ------------------------------------------------- today's time blocks

  // A believable day: some scheduled work, a routine block, and a deliberate
  // gap. The AI planner needs free space to be able to schedule into.
  const blocks = [
    { title: "Morning walk", start: 7 * 60, length: 45, source: "ROUTINE", color: "#C8F751", routine: morningRoutine.id },
    { title: "Deep work: auth hardening", start: 9 * 60 + 30, length: 120, source: "FOCUS", color: "#7C6BFF", task: taskIds[0]! },
    { title: "Team standup", start: 12 * 60, length: 20, source: "CALENDAR", color: "#5BA8FF" },
    { title: "Lunch", start: 12 * 60 + 45, length: 45, source: "MANUAL", color: "#34D399" },
    { title: "Inbox and admin", start: 14 * 60, length: 60, source: "MANUAL", color: "#FFB020" },
    { title: "Deep work: analytics", start: 15 * 60 + 30, length: 90, source: "AI", color: "#7C6BFF", task: taskIds[1]! },
    { title: "Read 20 minutes", start: 19 * 60, length: 20, source: "ROUTINE", color: "#4ECDC4", routine: eveningRoutine.id },
  ] as const;

  for (const b of blocks) {
    const startAt = atMinutes(today, b.start);
    await prisma.timeBlock.create({
      data: {
        userId: user.id,
        date: today,
        title: b.title,
        startAt,
        endAt: new Date(startAt.getTime() + b.length * 60_000),
        source: b.source,
        color: b.color,
        // The standup is a real-world commitment: the planner must not move it.
        locked: b.source === "CALENDAR",
        taskId: "task" in b ? b.task : null,
        routineId: "routine" in b ? b.routine : null,
      },
    });
  }
  console.log(`created ${blocks.length} time blocks for today`);

  // ------------------------------------------------- calendar and notices

  await prisma.calendarEvent.createMany({
    data: [
      {
        userId: user.id,
        title: "Design review",
        startAt: atMinutes(today, 14 * 60),
        endAt: atMinutes(today, 15 * 60),
        color: "#5BA8FF",
        source: "LOCAL",
      },
      {
        userId: user.id,
        title: "Dentist",
        description: "Six month check-up.",
        startAt: atMinutes(dayOffset(3), 11 * 60),
        endAt: atMinutes(dayOffset(3), 12 * 60),
        color: "#FF6B9D",
        source: "LOCAL",
      },
    ],
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: user.id,
        type: "TASK",
        title: "Fix the timezone bug in recurring tasks",
        body: "Marked urgent and due today.",
        actionUrl: "/tasks",
        readAt: null,
      },
      {
        userId: user.id,
        type: "HABIT",
        title: "Nine day streak",
        body: "Longest run so far is 23 days. Keep it going.",
        actionUrl: "/habits",
        readAt: new Date(),
      },
      {
        userId: user.id,
        type: "AI",
        title: "Your mornings are your strongest hours",
        body: "You complete 71% more tasks before noon than after 4pm.",
        actionUrl: "/analytics",
        readAt: null,
      },
      {
        userId: user.id,
        type: "ACHIEVEMENT",
        title: "Halfway to 24 books",
        body: "Eleven books logged this year.",
        actionUrl: "/goals",
        readAt: new Date(),
      },
    ],
  });

  await prisma.reminder.createMany({
    data: [
      {
        userId: user.id,
        type: "TASK",
        targetType: "TASK",
        targetId: taskIds[0] ?? "",
        title: "Deep work starts soon",
        body: "Block reserved from 9:30.",
        scheduledFor: atMinutes(today, 9 * 60 + 15),
        channel: "IN_APP",
      },
      {
        userId: user.id,
        type: "HABIT",
        targetType: "HABIT",
        targetId: habitIds[0] ?? "",
        title: "Evening walk",
        scheduledFor: atMinutes(dayOffset(0), 18 * 60),
        channel: "IN_APP",
      },
      {
        userId: user.id,
        type: "REVIEW",
        targetType: "REVIEW",
        title: "Weekly review",
        body: "Sunday afternoon is usually when you do this.",
        scheduledFor: atMinutes(dayOffset(5), 16 * 60),
        channel: "IN_APP",
      },
    ],
  });

  // ------------------------------------------------------- achievements

  const achievements = [
    { key: "first_task", name: "First step", description: "Complete your first task.", category: "tasks", rarity: "COMMON", xp: 50 },
    { key: "streak_7", name: "One week", description: "Hold a seven day streak.", category: "streaks", rarity: "COMMON", xp: 100 },
    { key: "streak_30", name: "One month", description: "Hold a thirty day streak.", category: "streaks", rarity: "RARE", xp: 300 },
    { key: "focus_10h", name: "Deep worker", description: "Log ten hours of focused work.", category: "focus", rarity: "RARE", xp: 250 },
    { key: "early_bird", name: "Early bird", description: "Complete a task before 7am for ten days.", category: "tasks", rarity: "EPIC", xp: 500 },
    { key: "goal_getter", name: "Goal getter", description: "Achieve a full goal.", category: "goals", rarity: "RARE", xp: 400 },
    { key: "reflective", name: "Reflective", description: "Write fifty journal entries.", category: "journal", rarity: "RARE", xp: 350 },
    { key: "full_streak_year", name: "Unbroken", description: "Hold a streak for a full year.", category: "streaks", rarity: "LEGENDARY", xp: 2000 },
  ] as const;

  const unlocked = new Set(["first_task", "streak_7", "focus_10h", "goal_getter", "reflective"]);

  for (const [i, a] of achievements.entries()) {
    // Achievements are a global catalogue - the model has no userId and `key`
    // is globally unique - so they are not removed with the demo user. Upsert
    // rather than create, otherwise a second seed run collides on the key.
    const row = await prisma.achievement.upsert({
      where: { key: a.key },
      create: {
        key: a.key,
        name: a.name,
        description: a.description,
        category: a.category,
        rarity: a.rarity,
        xpReward: a.xp,
        sortOrder: i,
        criteria: { kind: a.category },
      },
      update: {
        name: a.name,
        description: a.description,
        category: a.category,
        rarity: a.rarity,
        xpReward: a.xp,
        sortOrder: i,
        criteria: { kind: a.category },
      },
      select: { id: true },
    });
    await prisma.userAchievement.create({
      data: {
        userId: user.id,
        achievementId: row.id,
        progress: unlocked.has(a.key) ? 100 : int(10, 75),
        unlockedAt: unlocked.has(a.key) ? dayOffset(-int(5, 60)) : null,
      },
    });
  }
  console.log(`created ${achievements.length} achievements (${unlocked.size} unlocked)`);

  // -------------------------------------------------- AI and insights

  // Prisma derives the delegate name from the model, which capitalises each
  // leading letter: `AIConversation` becomes `aIConversation`.
  const conversation = await prisma.aIConversation.create({
    data: {
      userId: user.id,
      title: "Why do my afternoons collapse?",
      provider: "local",
    },
    select: { id: true },
  });

  await prisma.aIMessage.createMany({
    data: [
      {
        userId: user.id,
        conversationId: conversation.id,
        role: "USER",
        content: "Why do my afternoons collapse? I plan a good morning and then nothing gets done after lunch.",
        source: "LOCAL",
        provider: "local",
        latencyMs: 12,
      },
      {
        userId: user.id,
        conversationId: conversation.id,
        role: "ASSISTANT",
        content:
          "Looking at your last 30 days: on days where you complete a task before noon, you finish 71% more by the end of the day. On days you skip the morning walk, your afternoon completion rate drops to 34% and your logged energy averages 2.4 out of 5.\n\nThe pattern is consistent enough to act on. Two suggestions:\n\n1. Protect 9:30 to 11:00 as deep work. You already do this on 22 of the last 30 days, and those are your highest output days.\n2. Schedule admin and communication after 14:00 rather than before it. Your low-energy tasks cluster there, which matches your own energy readings.\n\nThis is a correlation in your own logged data, not a causal claim.",
        source: "LOCAL",
        provider: "local",
        tokensIn: 42,
        tokensOut: 210,
        latencyMs: 38,
      },
    ],
  });

  // A few insights the deterministic engine can plausibly have produced, so
  // the insights surface is not empty on first load.
  await prisma.insight.createMany({
    data: [
      {
        userId: user.id,
        kind: "CORRELATION",
        status: "NEW",
        title: "Mornings carry your week",
        body: "You complete 71% more tasks before noon than after 4pm. On days with a morning walk, afternoon energy is 0.8 points higher on average.",
        confidence: 0.82,
        sampleSize: 30,
        source: "LOCAL",
        relatedCategoryId: null,
        validUntil: dayOffset(14),
        evidence: { windowDays: 30, morningCompletion: 0.71, afternoonCompletion: 0.41 },
      },
      {
        userId: user.id,
        kind: "PATTERN",
        status: "NEW",
        title: "Reading slips at weekends",
        body: "You read on 63% of weekdays but only 41% of weekend days. Moving the session to Saturday morning would close most of that gap.",
        confidence: 0.74,
        sampleSize: 24,
        source: "LOCAL",
        validUntil: dayOffset(14),
        evidence: { weekdayRate: 0.63, weekendRate: 0.41 },
      },
      {
        userId: user.id,
        kind: "RECOMMENDATION",
        status: "NEW",
        title: "Protect 9:30 to 11:00",
        body: "Your two highest-output blocks both fall in the morning. Something already scheduled there is a scheduling conflict, not a time-management problem.",
        confidence: 0.68,
        sampleSize: 22,
        source: "LOCAL",
        actionKind: "BLOCK_TIME",
        actionPayload: { startMinutes: 570, endMinutes: 660 },
        validUntil: dayOffset(7),
      },
      {
        userId: user.id,
        kind: "OBSERVATION",
        status: "SEEN",
        title: "Long sessions get cut short",
        body: "22% of your deep work blocks end early. Most of those are over 40 minutes. Try 25 minute blocks on days when you have less runway.",
        confidence: 0.59,
        sampleSize: 47,
        source: "LOCAL",
        validUntil: dayOffset(7),
      },
    ],
  });

  // -------------------------------------------------------- weekly review

  const weekStart = dayOffset(-7);
  await prisma.weeklyReview.create({
    data: {
      userId: user.id,
      weekStart,
      weekEnd: dayOffset(-1),
      periodLabel: "Last week",
      summary:
        "A strong week overall. Deep work held up, but the afternoon kept slipping and sleep was short on four nights.",
      // Keys must match `ReportMetrics` in src/lib/ai/reports.ts. `MetricGrid`
      // renders a fixed list of labels, so any key outside that list is silently
      // dropped and the report shows an almost-empty metrics table.
      metrics: {
        tasksCompleted: 17,
        tasksCreated: 21,
        tasksStillOpen: 9,
        tasksOverdue: 2,
        habitLogs: 38,
        habitExpected: 53,
        habitRatePercent: 72,
        focusSessions: 11,
        focusMinutes: 640,
        focusMinutesPerDay: 91,
        planningMinutes: 145,
        journalEntries: 5,
        journalWords: 1840,
        moodAverage: 3.8,
        energyAverage: 3.4,
        stressAverage: 2.6,
        sleepAverage: 6.8,
        activeGoals: 4,
        goalsClosed: 1,
        activeProjects: 3,
        projectsClosed: 1,
        routinesCompleted: 9,
      },
      highlights: [
        section("OBSERVATION", "Analytics dashboard shipped", "Finished the analytics screen end to end.", 0.95, 1),
        section("OBSERVATION", "Nine day streak", "Held the morning run streak for nine consecutive days.", 0.9, 9),
        section("OBSERVATION", "15 km without stopping", "Longest continuous run so far this quarter.", 1, 1),
      ],
      misses: [
        section("OBSERVATION", "Four evenings past 11pm", "Sleep logged after 23:00 on four nights.", 0.8, 4),
        section("OBSERVATION", "Guitar practice skipped five times", "Weekly guitar target missed on five occasions.", 0.75, 5),
      ],
      patterns: [
        section("PATTERN", "Morning is the productive window", "Tasks completed before noon: 13 of 17.", 0.85, 17),
        section("CORRELATION", "Late nights cost next-day energy", "Evening energy below 2.5 on four nights, each after a short night.", 0.7, 4),
      ],
      recommendations: [
        section("RECOMMENDATION", "Move guitar practice to Saturday morning", "Morning is the window where completion already happens most often.", 0.7, 0),
        section("RECOMMENDATION", "Set a hard screens-off time", "A fixed after-10pm boundary targets the pattern the data actually shows.", 0.75, 0),
      ],
      narrative:
        "You did most of the week's important work before lunch, and the habit streaks held. The pattern to watch is the evening: short sleep on four nights, which shows up the next morning as lower energy and fewer completed tasks. Nothing here needs a bigger effort, just a tighter boundary after 10pm.",
    },
  });

  // ------------------------------------------------------------- summary

  const [taskCount, habitCount, focusCount, wellbeingCount] = await Promise.all([
    prisma.task.count({ where: { userId: user.id } }),
    prisma.habit.count({ where: { userId: user.id } }),
    prisma.focusSession.count({ where: { userId: user.id } }),
    prisma.moodEnergyEntry.count({ where: { userId: user.id } }),
  ]);

  console.log(`
Seed complete.

  Sign in with:
    email:    ${DEMO_EMAIL}
    password: ${DEMO_PASSWORD}

  Records created:
    tasks         ${taskCount}
    habits        ${habitCount} (with ${(HISTORY_DAYS + 1) * habitCount} logs)
    focus sessions${String(focusCount).padStart(5)}
    wellbeing     ${wellbeingCount} days
    goals         ${goalIds.length}
    time blocks   ${blocks.length} (today)
`);
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
