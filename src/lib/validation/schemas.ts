import { z } from "zod";

/**
 * Shared validation contracts.
 *
 * These schemas are the single source of truth for both the React Hook Form
 * resolvers on the client and the `withApi` body parsers on the server, so a
 * field can never be validated one way in the form and another way at the API.
 */

const email = z
  .string()
  .trim()
  .min(1, "Email is required")
  .max(254, "That email address is too long")
  .email("Enter a valid email address");

const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "That password is too long")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[0-9]/, "Include a number");

const name = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "That name is too long");

export const signUpSchema = z.object({
  name,
  email,
  password,
});

export const signInSchema = z.object({
  email,
  // Deliberately permissive: an old account may predate the current policy, and
  // rejecting it at the door would leak that the account exists.
  password: z.string().min(1, "Password is required").max(200),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(10, "This reset link is not valid"),
  password,
});

export const resendVerificationSchema = z.object({ email });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ------------------------------------------------------------------ tasks

const minutes = z.coerce.number().int().min(0).max(24 * 60).nullable().optional();

/**
 * Onboarding.
 *
 * Everything except the name is optional in the sense that the schema allows
 * null, but the form supplies a sensible default for each, so a user who
 * clicks straight through still gets a usable profile. Times are stored as
 * minutes from midnight rather than as `Date`s, because "I wake at 06:30" is a
 * recurring local time and not an instant — storing it as a timestamp is what
 * makes planners drift by a day per timezone.
 */
export const onboardingSchema = z
  .object({
    name: name.optional(),
    timezone: z.string().trim().min(1).max(64).default("UTC"),
    // 0 = Sunday, 1 = Monday.
    weekStartsOn: z.coerce.number().int().min(0).max(1).default(1),
    dailySummaryTime: z.coerce.number().int().min(0).max(24 * 60).default(20 * 60),
    gamificationOn: z.coerce.boolean().default(true),

    wakeMinutes: z.coerce.number().int().min(0).max(24 * 60).default(7 * 60),
    sleepMinutes: z.coerce.number().int().min(0).max(24 * 60).default(23 * 60),
    availableWeekdayMinutes: z.coerce.number().int().min(0).max(24 * 60).default(4 * 60),
    availableWeekendMinutes: z.coerce.number().int().min(0).max(24 * 60).default(4 * 60),

    occupation: z.string().trim().max(80).nullable().optional(),
    workLabel: z.string().trim().max(80).nullable().optional(),
    workStartMinutes: z.coerce.number().int().min(0).max(24 * 60).nullable().optional(),
    workEndMinutes: z.coerce.number().int().min(0).max(24 * 60).nullable().optional(),
    workDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),

    importantHabits: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
    goalsSummary: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (v) => (v.workStartMinutes == null) === (v.workEndMinutes == null),
    { message: "Give both a start and an end time, or neither", path: ["workStartMinutes"] },
  )
  .refine((v) => v.wakeMinutes !== v.sleepMinutes, {
    message: "Wake and sleep times cannot be the same",
    path: ["sleepMinutes"],
  });

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(200),
  notes: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED", "ARCHIVED"]).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  energy: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  importance: z.coerce.number().int().min(1).max(5).default(3),
  urgency: z.coerce.number().int().min(1).max(5).default(3),
  estimatedMinutes: minutes,
  startAt: z.coerce.date().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  goalId: z.string().min(1).nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  goalMilestoneId: z.string().min(1).nullable().optional(),
  tagIds: z.array(z.string().min(1)).max(20).default([]),
  isRecurring: z.boolean().default(false),
  recurrence: z.record(z.string(), z.unknown()).nullable().optional(),
  reminderLeadMinutes: z.coerce.number().int().min(0).max(10080).nullable().optional(),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = taskCreateSchema
  .partial()
  .extend({
    sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
    snoozedUntil: z.coerce.date().nullable().optional(),
  });
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

export const taskListQuerySchema = z.object({
  status: z
    .enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED", "ARCHIVED", "all"])
    .default("TODO"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  categoryId: z.string().optional(),
  goalId: z.string().optional(),
  parentId: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

// ----------------------------------------------------------------- habits

export const habitCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the habit a name").max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  icon: z.string().trim().max(40).default("target"),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #C8F751").default("#C8F751"),
  type: z.enum(["BOOLEAN", "COUNT", "DURATION", "DISTANCE", "QUANTITY"]).default("BOOLEAN"),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).default("MEDIUM"),
  frequency: z.enum(["DAILY", "WEEKLY", "CUSTOM"]).default("DAILY"),
  unit: z.string().trim().max(24).nullable().optional(),
  targetValue: z.coerce.number().min(0).max(100000).default(1),
  targetMinutes: minutes,
  timesPerPeriod: z.coerce.number().int().min(1).max(7).nullable().optional(),
  preferredMinutes: z.coerce.number().int().min(0).max(1439).nullable().optional(),
  reminderEnabled: z.boolean().default(false),
  reminderMinutes: z.coerce.number().int().min(0).max(1439).nullable().optional(),
  startDate: z.coerce.date(),
  categoryId: z.string().min(1).nullable().optional(),
  goalId: z.string().min(1).nullable().optional(),
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
});
export type HabitCreateInput = z.infer<typeof habitCreateSchema>;

export const habitUpdateSchema = habitCreateSchema.partial().extend({
  /**
   * Archive or restore. Exposed as one boolean rather than the `isActive` and
   * `archivedAt` columns, because those two have to move together — a client
   * that sets only one of them produces a habit that is neither active nor
   * meaningfully archived, and nothing in the UI can explain that state.
   *
   * It has to be declared here rather than inferred from the model: an unknown
   * key is silently stripped by Zod, so a PATCH that sent `archivedAt` directly
   * would return 200 and do nothing at all.
   */
  archived: z.boolean().optional(),
});
export type HabitUpdateInput = z.infer<typeof habitUpdateSchema>;

export const habitLogSchema = z.object({
  /**
   * Defaults to the server's current instant rather than being required.
   *
   * Logging "today" is the overwhelmingly common case and the client should not
   * have to compute a date to express it: every caller sends a bare `{ value }`.
   * Making the field required here meant every log from the UI failed validation
   * before reaching the handler. The route still collapses the value to a
   * UTC-midnight `@db.Date`, so a caller sending a full timestamp still means
   * "that calendar day" rather than "that moment".
   *
   * A function default is required rather than `new Date()` — the latter is
   * evaluated once when the module loads, so the "default" would freeze at the
   * moment the server booted.
   */
  date: z.coerce.date().default(() => new Date()),
  value: z.coerce.number().min(0).max(100000).default(1),
  completed: z.boolean().default(true),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type HabitLogInput = z.infer<typeof habitLogSchema>;

// ---------------------------------------------------------------- time blocks

/**
 * The planner.
 *
 * A block's time is sent as `date` (a `yyyy-MM-dd` day) plus `startMinutes`
 * (minutes from local midnight) plus `durationMinutes`, rather than as
 * `startAt`/`endAt` instants. That is a deliberate mismatch with the Prisma
 * model's shape and it buys three things:
 *
 * - A client cannot send a block whose `end` precedes its `start`, because it
 *   never sends an end. Duration is a positive integer, so the impossible state
 *   is unrepresentable instead of validated after the fact.
 * - "9:00 for 30 minutes" is what a person means. Two `datetime-local` inputs
 *   invite 9:00-8:00 typos, and a 23-hour block that passes a naive check is a
 *   block that quietly swallows the whole day.
 * - The server derives the timestamps in one place, which is the only place that
 *   has to know about the local-versus-UTC split described in `src/lib/date.ts`.
 *
 * `date` is validated as a real calendar day rather than coerced to a `Date`,
 * because `new Date("2026-02-30")` is not the 28th of March or an error — it is
 * the 2nd of March, silently, and a block saved for a day that does not exist
 * reappears in the wrong place.
 */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-27")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const probe = new Date(Date.UTC(y, m - 1, d));
    // Round-tripping is the only way to reject the overflow days: 31 February
    // becomes 3 March, and 3 March is not 31 February.
    return (
      probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
    );
  }, "That date does not exist");

export const timeBlockCreateSchema = z.object({
  title: z.string().trim().min(1, "Give the block a title").max(200),
  date: isoDay,
  startMinutes: z.coerce.number().int().min(0).max(1439),
  durationMinutes: z.coerce
    .number()
    .int()
    .min(5, "Give it at least 5 minutes")
    .max(720, "A block cannot be longer than 12 hours"),
  notes: z.string().trim().max(2000).nullable().optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #C8F751").default("#C8F751"),
  taskId: z.string().min(1).nullable().optional(),
  habitId: z.string().min(1).nullable().optional(),
  /**
   * "Do not move this." The column exists so an auto-scheduler can respect a
   * fixed commitment, and it is exposed now rather than left dead until one
   * ships — a user setting it today keeps their intent when that arrives.
   */
  locked: z.boolean().default(false),
});
export type TimeBlockCreateInput = z.infer<typeof timeBlockCreateSchema>;

export const timeBlockUpdateSchema = timeBlockCreateSchema
  .partial()
  .extend({
    /**
     * Moving a block can cross midnight, so a patch that changes `date` without
     * a `startMinutes` is allowed — the time of day is preserved and only the
     * day changes.
     */
    startMinutes: z.coerce.number().int().min(0).max(1439).optional(),
  });
export type TimeBlockUpdateInput = z.infer<typeof timeBlockUpdateSchema>;

export const timeBlockListQuerySchema = z.object({
  from: isoDay,
  to: isoDay.optional(),
});
export type TimeBlockListQuery = z.infer<typeof timeBlockListQuerySchema>;


// ------------------------------------------------------------------ goals

export const goalCreateSchema = z.object({
  title: z.string().trim().min(1, "Give the goal a title").max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  horizon: z.enum(["SHORT", "MEDIUM", "LONG"]).default("MEDIUM"),
  status: z.enum(["ACTIVE", "PAUSED", "ACHIEVED", "ABANDONED"]).default("ACTIVE"),
  startDate: z.coerce.date().nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  icon: z.string().trim().max(40).default("target"),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default("#7C6BFF"),
});
export type GoalCreateInput = z.infer<typeof goalCreateSchema>;

export const goalUpdateSchema = goalCreateSchema
  .partial()
  .extend({ progress: z.coerce.number().min(0).max(100).optional() });
export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>;

// --------------------------------------------------------------- wellbeing

export const moodEnergySchema = z.object({
  date: z.coerce.date(),
  mood: z.coerce.number().int().min(1).max(5),
  energy: z.coerce.number().int().min(1).max(5),
  stress: z.coerce.number().int().min(1).max(5),
  sleepQuality: z.coerce.number().int().min(1).max(5),
  sleepHours: z.coerce.number().min(0).max(24).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type MoodEnergyInput = z.infer<typeof moodEnergySchema>;

export const journalEntrySchema = z.object({
  date: z.coerce.date(),
  title: z.string().trim().max(200).nullable().optional(),
  content: z.string().trim().min(1, "Write something first").max(50000),
  mood: z.coerce.number().int().min(1).max(5).nullable().optional(),
  energy: z.coerce.number().int().min(1).max(5).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});
export type JournalEntryInput = z.infer<typeof journalEntrySchema>;

// ------------------------------------------------------------------ focus

export const focusCompleteSchema = z.object({
  plannedSeconds: z.coerce.number().int().min(60).max(4 * 60 * 60),
  actualSeconds: z.coerce.number().int().min(0).max(8 * 60 * 60),
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  endedEarly: z.boolean().default(false),
  taskId: z.string().min(1).nullable().optional(),
  type: z.enum(["POMODORO", "CUSTOM", "DEEP_WORK"]).default("POMODORO"),
});
export type FocusCompleteInput = z.infer<typeof focusCompleteSchema>;

// ------------------------------------------------------- natural language

export const nlTaskSchema = z.object({
  text: z.string().trim().min(2, "Describe the task").max(500),
});
export const nlChatSchema = z.object({
  message: z.string().trim().min(1, "Ask something").max(2000),
  conversationId: z.string().min(1).nullable().optional(),
});
export const aiPlanSchema = z.object({
  date: z.coerce.date().optional(),
  /** Free minutes the user is willing to schedule. */
  availableMinutes: z.coerce.number().int().min(30).max(960).nullable().optional(),
});

// ----------------------------------------------------------------- routines

export const routineItemCreateSchema = z.object({
  title: z.string().trim().min(1, "Name the step").max(200),
  estimatedMinutes: z.coerce.number().int().min(1).max(600).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  habitId: z.string().min(1).nullable().optional(),
  /**
   * Whether running this step should hand the user a task. On by default, and off
   * for the steps that are ritual rather than work — a glass of water is not
   * something that belongs on a task list.
   */
  createsTask: z.coerce.boolean().default(true),
});
export type RoutineItemCreateInput = z.infer<typeof routineItemCreateSchema>;

export const routineItemUpdateSchema = routineItemCreateSchema.partial();
export type RoutineItemUpdateInput = z.infer<typeof routineItemUpdateSchema>;

export const routineCreateSchema = z.object({
  name: z.string().trim().min(1, "Name the routine").max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: z
    .enum(["MORNING", "STUDY", "WORKOUT", "EVENING", "NIGHT", "WORK", "COLLEGE", "CUSTOM"])
    .default("CUSTOM"),
  /** Minutes from local midnight, so a time is never re-zoned out from under the user. */
  timeOfDay: z.coerce.number().int().min(0).max(1439).nullable().optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default("#4ECDC4"),
  icon: z.string().trim().max(40).default("repeat"),
  isActive: z.boolean().default(true),
  items: z.array(routineItemCreateSchema).max(40).default([]),
});
export type RoutineCreateInput = z.infer<typeof routineCreateSchema>;

export const routineUpdateSchema = routineCreateSchema.partial().omit({ items: true });
export type RoutineUpdateInput = z.infer<typeof routineUpdateSchema>;

// ---------------------------------------------------------------- milestones

/** Goal milestones are dated, project milestones have a timestamp. Kept apart
 *  so neither can be handed a field the other column doesn't have. */
export const goalMilestoneCreateSchema = z.object({
  title: z.string().trim().min(1, "Name the milestone").max(200),
  detail: z.string().trim().max(2000).nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
});
export type GoalMilestoneCreateInput = z.infer<typeof goalMilestoneCreateSchema>;

export const projectMilestoneCreateSchema = z.object({
  title: z.string().trim().min(1, "Name the milestone").max(200),
  detail: z.string().trim().max(2000).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
});
export type ProjectMilestoneCreateInput = z.infer<typeof projectMilestoneCreateSchema>;

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, "Name the project").max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  status: z
    .enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"])
    .default("PLANNING"),
  startAt: z.coerce.date().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default("#7C6BFF"),
  icon: z.string().trim().max(40).default("folder"),
});
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;

export const projectUpdateSchema = projectCreateSchema
  .partial()
  .extend({
    progress: z.coerce.number().min(0).max(100).optional(),
  });
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;

// ----------------------------------------------------------------- calendar

export const calendarEventCreateSchema = z
  .object({
    title: z.string().trim().min(1, "Name the event").max(200),
    description: z.string().trim().max(2000).nullable().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    allDay: z.boolean().default(false),
    location: z.string().trim().max(200).nullable().optional(),
    color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default("#5BA8FF"),
  })
  .refine((value) => value.endAt.getTime() > value.startAt.getTime(), {
    message: "An event has to end after it starts",
    path: ["endAt"],
  });
export type CalendarEventCreateInput = z.infer<typeof calendarEventCreateSchema>;

export const calendarEventUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    allDay: z.boolean().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .refine(
    (value) =>
      value.startAt === undefined ||
      value.endAt === undefined ||
      value.endAt.getTime() > value.startAt.getTime(),
    { message: "An event has to end after it starts", path: ["endAt"] },
  );
export type CalendarEventUpdateInput = z.infer<typeof calendarEventUpdateSchema>;

// ----------------------------------------------------------------- insights

export const insightUpdateSchema = z.object({
  status: z.enum(["NEW", "SEEN", "APPLIED", "DISMISSED"]),
});
export type InsightUpdateInput = z.infer<typeof insightUpdateSchema>;

// ---------------------------------------------------------------- settings

/**
 * Preferences live on `User`, and the numbers are minutes-from-midnight or
 * hour-of-day ints. Validating them here keeps a bad value from reaching the
 * database and quietly breaking the planner's day boundaries later.
 */
export const settingsUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).nullable().optional(),
    theme: z.enum(["LIGHT", "DARK", "SYSTEM"]),
    timezone: z.string().trim().min(1).max(64),
    locale: z.string().trim().min(2).max(10),
    aiEnabled: z.boolean(),
    gamificationOn: z.boolean(),
    weekStartsOn: z.coerce.number().int().min(0).max(6),
    dailySummaryTime: z.coerce.number().int().min(0).max(23),
    quietHoursStart: z.coerce.number().int().min(0).max(23),
    quietHoursEnd: z.coerce.number().int().min(0).max(23),
  })
  .partial();
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

export const profileUpdateSchema = z
  .object({
    ageRange: z.string().trim().max(40).nullable().optional(),
    occupation: z.string().trim().max(120).nullable().optional(),
    wakeMinutes: z.coerce.number().int().min(0).max(1439).nullable().optional(),
    sleepMinutes: z.coerce.number().int().min(0).max(1439).nullable().optional(),
    availableWeekdayMinutes: z.coerce.number().int().min(0).max(1440).nullable().optional(),
    availableWeekendMinutes: z.coerce.number().int().min(0).max(1440).nullable().optional(),
    studyTargetMinutes: z.coerce.number().int().min(0).max(1440).nullable().optional(),
    fitnessFrequency: z.coerce.number().int().min(0).max(14).nullable().optional(),
    productivityStyle: z.string().trim().max(60).nullable().optional(),
    focusPreference: z.string().trim().max(60).nullable().optional(),
    workLabel: z.string().trim().max(80).nullable().optional(),
    workStartMinutes: z.coerce.number().int().min(0).max(1439).nullable().optional(),
    workEndMinutes: z.coerce.number().int().min(0).max(1439).nullable().optional(),
    workDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).nullable().optional(),
    collegeLabel: z.string().trim().max(80).nullable().optional(),
    collegeStartMinutes: z.coerce.number().int().min(0).max(1439).nullable().optional(),
    collegeEndMinutes: z.coerce.number().int().min(0).max(1439).nullable().optional(),
    collegeDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).nullable().optional(),
    importantHabits: z.array(z.string().trim().min(1).max(80)).max(20).nullable().optional(),
    goalsSummary: z.string().trim().max(2000).nullable().optional(),
  })
  .partial();
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(10, "Use at least 10 characters").max(200),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "The new password has to be different",
    path: ["newPassword"],
  });
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

/**
 * A URL that is optional but must be usable if given.
 *
 * `z.url()` is not enough on its own: it accepts anything with a scheme, so
 * `javascript:alert(1)` and `data:text/html,...` are both "valid" and both get
 * rendered into an `href`. Since a resource link is shown to whoever has this
 * account and could plausibly come from an imported list, the scheme is
 * allowlisted to the three that mean "a page you can visit".
 */
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (value) => {
      if (value === "") return true;
      try {
        const { protocol } = new URL(value);
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Enter a link starting with http:// or https://" },
  );

export const noteCreateSchema = z.object({
  title: z.string().trim().min(1, "Give the note a title").max(200),
  body: z.string().trim().max(20_000).default(""),
  pinned: z.coerce.boolean().default(false),
  // Every link is optional. A note is allowed to be loose, and detaching one from
  // its subject must never destroy it.
  taskId: z.string().min(1).nullable().optional(),
  goalId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  resourceId: z.string().min(1).nullable().optional(),
});
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;

export const noteUpdateSchema = noteCreateSchema.partial();
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;

export const resourceCreateSchema = z.object({
  title: z.string().trim().min(1, "Name the resource").max(200),
  kind: z
    .enum(["BOOK", "COURSE", "ARTICLE", "VIDEO", "PODCAST", "PAPER", "TOOL", "OTHER"])
    .default("OTHER"),
  status: z.enum(["WANTING", "IN_PROGRESS", "ON_HOLD", "FINISHED", "DROPPED"]).default("WANTING"),
  url: httpUrl.nullable().optional(),
  author: z.string().trim().max(200).nullable().optional(),
  summary: z.string().trim().max(4000).nullable().optional(),
  /**
   * Hand-set 0-100: how far through it you are is a judgement, not a measurement.
   *
   * Optional rather than defaulting to 0, and the difference matters downstream.
   * `resourceTransition` needs to tell "explicitly zero" from "said nothing" so
   * that creating something directly as FINISHED can force the bar to 100 without
   * a default of 0 silently overriding it.
   */
  progress: z.coerce.number().int().min(0).max(100).optional(),
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  goalId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
});
export type ResourceCreateInput = z.infer<typeof resourceCreateSchema>;

export const resourceUpdateSchema = resourceCreateSchema.partial();
export type ResourceUpdateInput = z.infer<typeof resourceUpdateSchema>;

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/**
 * Reminders.
 *
 * `recurrence` is validated as a shape rather than left to the scheduler, so a
 * bad rule is rejected at the door rather than producing a reminder that never
 * fires. `parseRecurrence` still re-checks it on read, because the column is
 * `Json` and rows can predate this schema or be edited outside the app.
 *
 * Only `IN_APP` is offered. The `ReminderChannel` enum has `EMAIL` and `PUSH`,
 * and this app has no sender for either - accepting them would mean storing a
 * promise the system cannot keep, and a user who chose email and got nothing
 * would have less reason to trust the reminders that do work.
 */
export const recurrenceSchema = z
  .object({
    freq: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    interval: z.number().int().min(1).max(1825).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .refine(
    (rule) => rule.freq !== "WEEKLY" || !rule.byWeekday || rule.byWeekday.length > 0,
    { message: "Pick at least one day, or leave the days unset to repeat weekly" },
  );
export type RecurrenceInput = z.infer<typeof recurrenceSchema>;

export const reminderCreateSchema = z.object({
  title: z.string().trim().min(1, "Name the reminder").max(200),
  body: z.string().trim().max(1000).nullable().optional(),
  /** ISO-8601. Interpreted in the browser's own zone; the client sends local time. */
  scheduledFor: z.string().trim().min(1, "Pick a time").pipe(z.coerce.date()),
  recurrence: recurrenceSchema.nullable().optional(),
  targetType: z.enum(["TASK", "HABIT", "GOAL", "REVIEW", "CUSTOM"]).default("CUSTOM"),
  targetId: z.string().min(1).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type ReminderCreateInput = z.infer<typeof reminderCreateSchema>;

export const reminderUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().max(1000).nullable().optional(),
  scheduledFor: z.string().trim().min(1).pipe(z.coerce.date()).optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  targetType: z.enum(["TASK", "HABIT", "GOAL", "REVIEW", "CUSTOM"]).optional(),
  targetId: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type ReminderUpdateInput = z.infer<typeof reminderUpdateSchema>;

/**
 * Marking notifications read.
 *
 * Marking read and marking unread are one endpoint, because the bell badge is a
 * two-way thing and "mark as unread" being a separate route is how it usually
 * goes missing. `read: false` covers the case of having swept everything by
 * accident and wanting the badge back.
 *
 * The refine is what keeps an empty selection from silently meaning "everything":
 * `all: false` with no ids is a client bug, and treating it as mark-all would
 * clear a badge the user never asked to clear.
 */
export const notificationReadSchema = z
  .object({
    all: z.boolean().default(false),
    ids: z.array(z.string().min(1)).optional(),
    read: z.boolean().default(true),
  })
  .refine((value) => value.all || (value.ids && value.ids.length > 0), {
    message: "Nothing selected",
    path: ["ids"],
  });
export type NotificationReadInput = z.infer<typeof notificationReadSchema>;

// ---------------------------------------------------------------------------
// Weekly plans
// ---------------------------------------------------------------------------

/**
 * Weekly plans.
 *
 * The plan's two dates arrive as `yyyy-MM-dd` day strings, not as `Date`s, and
 * that is not cosmetic. `startDate`/`endDate` are `@db.Date` columns and must
 * hold UTC midnight; `new Date("2026-09-28")` does parse to exactly that, but
 * `z.coerce.date()` also happily accepts `"28/09/2026"`, `"Sep 28 2026"` and
 * `Date.now() + 86400000`, so a client sending anything but ISO silently writes
 * whatever the runtime guessed. `isoDay` (already defined above for the planner)
 * rejects the ambiguity and rejects impossible days, which matters here more than
 * anywhere else: a plan filed under the 2nd of March because "February 30"
 * rolled over would report progress against a week that never existed.
 */
const planTargetType = z.enum(["HOURS", "SESSIONS", "TASKS", "COUNT"]);

/**
 * The per-weekday intentions, including rest days.
 *
 * Seven entries max, one per weekday. Capped rather than deduped because a
 * duplicate weekday would silently overwrite the first in the upsert, and the
 * user would lose "Wednesday: rest" without any indication it had happened.
 */
const planDaySchema = z.object({
  /** 0 = Sunday .. 6 = Saturday, matching `Date.getDay()`. */
  dayOfWeek: z.number().int().min(0).max(6),
  note: z.string().trim().max(200).nullable().optional(),
});

export const weeklyPlanCategorySchema = z.enum([
  "STUDY",
  "FITNESS",
  "PERSONAL",
  "WORK",
  "PROJECT",
  "CUSTOM",
]);

/**
 * The categories whose `SESSIONS` target has a real measurement behind it.
 *
 * "Session" means two different things in this app and neither generalises: a gym
 * week is counted by completed habit logs (as `fitness/page.tsx` does) and a study
 * week by finished focus sessions (as `study/page.tsx` does). A work or personal
 * week has neither, so `SESSIONS` is refused there rather than stored with a number
 * the app cannot produce. Kept in step with `SESSION_MEASURABLE` in
 * `@/lib/weekly-plans/progress`, which reports the same rule for a plan that
 * reached the table another way.
 */
export const SESSION_CATEGORIES = ["STUDY", "FITNESS"] as const;

export const weeklyPlanCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Name the plan").max(200),
    description: z.string().trim().max(4000).nullable().optional(),
    category: weeklyPlanCategorySchema.default("CUSTOM"),
    targetType: planTargetType.default("HOURS"),
    /** 0 is allowed: a plan can exist as structure before its target is chosen. */
    targetValue: z.coerce.number().min(0).max(9999).default(0),
    startDate: isoDay,
    endDate: isoDay,
    goalId: z.string().min(1).nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
    days: z.array(planDaySchema).max(7).optional(),
    /** Existing tasks to attach on creation, all of which must belong to the user. */
    taskIds: z.array(z.string().min(1)).max(100).optional(),
    /** Existing habits to attach on creation. Same ownership rule. */
    habitIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "A plan cannot end before it starts",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      value.targetType !== "SESSIONS" ||
      (SESSION_CATEGORIES as readonly string[]).includes(value.category),
    {
      message: "Sessions can only be counted for a study or fitness plan",
      path: ["targetType"],
    },
  )
  // Duplicate weekdays would violate `@@unique([weeklyPlanId, dayOfWeek])` and come
  // back as a raw constraint error. Two rows for one day is a bug in the caller, and
  // saying which day is cheaper than debugging the response.
  .refine(
    (value) => {
      const days = value.days ?? [];
      return new Set(days.map((d) => d.dayOfWeek)).size === days.length;
    },
    { message: "Each day of the week can only be listed once", path: ["days"] },
  );
export type WeeklyPlanCreateInput = z.infer<typeof weeklyPlanCreateSchema>;

export const weeklyPlanUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    category: weeklyPlanCategorySchema.optional(),
    targetType: planTargetType.optional(),
    targetValue: z.coerce.number().min(0).max(9999).optional(),
    /**
     * The user's own progress figure. Only read when `targetType` is `COUNT`, and
     * null is meaningful — it clears the figure back to "not counted yet" rather
     * than recording zero progress.
     */
    manualActual: z.coerce.number().min(0).max(9999).nullable().optional(),
    status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
    startDate: isoDay.optional(),
    endDate: isoDay.optional(),
    goalId: z.string().min(1).nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
    days: z.array(planDaySchema).max(7).optional(),
  })
  .refine(
    (value) =>
      value.startDate === undefined ||
      value.endDate === undefined ||
      value.endDate >= value.startDate,
    { message: "A plan cannot end before it starts", path: ["endDate"] },
  )
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    // An empty PATCH would otherwise return 200 and a full re-serialised plan,
    // looking exactly like a successful edit. That is a client bug, and saying so
    // is cheaper than debugging a form that silently saves nothing.
    { message: "Nothing to update" },
  )
  .refine(
    (value) => {
      const days = value.days ?? [];
      return new Set(days.map((d) => d.dayOfWeek)).size === days.length;
    },
    { message: "Each day of the week can only be listed once", path: ["days"] },
  )
  // Only enforceable when both fields are in this request. A PATCH that changes one
  // of them still has to satisfy the rule, but the *other* value lives on the stored
  // row — so `[id]/route.ts` re-checks the effective pair after merging. Refusing
  // here on partial input would reject a legitimate edit (setting SESSIONS on a plan
  // that is already a fitness plan) for no reason.
  .refine(
    (value) =>
      value.targetType !== "SESSIONS" ||
      value.category === undefined ||
      (SESSION_CATEGORIES as readonly string[]).includes(value.category),
    {
      message: "Sessions can only be counted for a study or fitness plan",
      path: ["targetType"],
    },
  );
export type WeeklyPlanUpdateInput = z.infer<typeof weeklyPlanUpdateSchema>;

/**
 * Copying a plan into the next week.
 *
 * `includeTasks` defaults to true and, when set, creates *new* tasks from the
 * existing plan's titles rather than relinking the originals. That is not an
 * implementation detail, it is the only correct behaviour: completion is a fact
 * about a task, so a task already marked DONE next week would report as finished
 * work in a week the user has not started. The response says how many tasks were
 * created and leaves already-completed ones behind.
 */
export const weeklyPlanCopySchema = z.object({
  includeTasks: z.boolean().default(true),
  /** Offset in weeks from the source plan's window. Defaults to the next one. */
  weeksAhead: z.number().int().min(1).max(52).default(1),
});
export type WeeklyPlanCopyInput = z.infer<typeof weeklyPlanCopySchema>;

/**
 * Reusable plan templates.
 *
 * `configuration` is validated as *titles only* — `{ dayOfWeek, tasks: string[] }`
 * — and never as task or habit ids. That constraint is the whole design of
 * `WeeklyPlanTemplate`: a template that remembered ids would rot silently the
 * first time a task was deleted, and the symptom would be a template quietly
 * applying one fewer task than it displays. Titles cannot go stale.
 */
export const weeklyPlanTemplateSchema = z
  .object({
    name: z.string().trim().min(1, "Name the template").max(200),
    category: weeklyPlanCategorySchema.default("CUSTOM"),
    targetType: planTargetType.default("HOURS"),
    targetValue: z.coerce.number().min(0).max(9999).default(0),
    days: z
      .array(
        planDaySchema.extend({
          tasks: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
        }),
      )
      .max(7)
      .default([]),
  })
  .refine(
    (value) =>
      value.targetType !== "SESSIONS" ||
      (SESSION_CATEGORIES as readonly string[]).includes(value.category),
    {
      message: "Sessions can only be counted for a study or fitness plan",
      path: ["targetType"],
    },
  )
  .refine(
    (value) => new Set(value.days.map((d) => d.dayOfWeek)).size === value.days.length,
    { message: "Each day of the week can only be listed once", path: ["days"] },
  );
export type WeeklyPlanTemplateInput = z.infer<typeof weeklyPlanTemplateSchema>;

/**
 * Applying a template.
 *
 * The target window is sent explicitly rather than inferred from the template, so
 * "apply this to next week" and "apply this to a fortnight starting the 14th" are
 * both one call and neither guesses.
 */
export const weeklyPlanApplyTemplateSchema = z
  .object({
    startDate: isoDay,
    endDate: isoDay,
    name: z.string().trim().min(1).max(200).optional(),
    goalId: z.string().min(1).nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "A plan cannot end before it starts",
    path: ["endDate"],
  });
export type WeeklyPlanApplyTemplateInput = z.infer<typeof weeklyPlanApplyTemplateSchema>;

/** The user's own three answers to a week, stored on the existing `WeeklyReview` row. */
export const weeklyReviewNotesSchema = z.object({
  wentWell: z.string().trim().max(2000).nullable().optional(),
  shouldImprove: z.string().trim().max(2000).nullable().optional(),
  nextWeekFocus: z.string().trim().max(2000).nullable().optional(),
});
export type WeeklyReviewNotesInput = z.infer<typeof weeklyReviewNotesSchema>;
