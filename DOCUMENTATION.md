# LIFEOS - Project Documentation

> AI Personal Life Tracker. Plan your day. Build your habits. Understand your life.

---

## 1. Overview

LIFEOS is a full-stack, AI-assisted personal life management platform. It brings tasks, habits, goals, projects, routines, focus sessions, fitness, study, journaling, wellbeing, calendar, reminders, analytics, and an AI assistant into one workspace.

| Item | Value |
|---|---|
| Product name | LIFEOS |
| Repository folder | `TREAKING APP` |
| Package name | `lifeos` |
| Version | `0.1.0` |
| App ID (Android) | `com.lifeos.app` |
| Default theme | Dark (`next-themes`, system supported) |
| Default AI provider | `local` (deterministic, no API key) |
| Node requirement | `>= 20.9.0` |
| Database | PostgreSQL |
| Current commit | `2019e3f` - Add study timetable and fitness planner; retire knowledge module |

Core promise: **one intelligent workspace for goals, habits, tasks, fitness, study, routines, and personal growth.**

---

## 2. Technology Stack

### Framework and runtime
- **Next.js 16.3.6** - App Router, Server Components, Route Handlers, Server Actions
- **React 19.3.0** / **React DOM 19.3.0**
- **TypeScript 5.9.3** (strict, path alias `@/*` -> `src/*`)
- **Turbopack** for development and builds
- **Node.js >= 20.9.0**

### Data layer
- **PostgreSQL**
- **Prisma 7.10.0**
  - Generator `prisma-client` with explicit output at `src/generated/prisma`
  - Driver adapter `@prisma/adapter-pg` (pg connection pool)
  - Connection string comes from `prisma.config.ts` / env, not the schema
- **Prisma migrations** in `prisma/migrations`
- **Seed script** at `prisma/seed.ts`

### Authentication and security
- **Auth.js / NextAuth 5.0.0-beta.32**
- **@auth/prisma-adapter**
- Credentials provider (email + password) and optional Google OAuth
- **@node-rs/argon2** for password hashing (argon2id)
- **jose** for JWT handling
- Session revocation via `passwordChangedAt` claim comparison
- Rate limiting (in-process fixed window)

### UI and styling
- **Tailwind CSS 4.3.3** with `@tailwindcss/postcss`
- **Radix UI** primitives (dialog, dropdown, tabs, select, slider, tooltip, etc.)
- **shadcn-style** component layer in `src/components/ui`
- **lucide-react** icons
- **framer-motion 13.4.4** for motion
- **next-themes** for light/dark/system theme
- **sonner** for toasts
- **cmdk** for the command palette
- **@dnd-kit** for drag-and-drop (planner, boards, lists)
- **recharts 3.10.1** for analytics charts
- **react-day-picker** + **date-fns 4.4.0** for dates
- **Geist** and **Geist Mono** fonts

### Forms, validation, state
- **react-hook-form 7.89.0**
- **@hookform/resolvers**
- **zod 4.6.5** - every request body/query and form contract
- **@tanstack/react-query 5.104.0**
- **zustand 5.0.15**

### AI
- Provider abstraction: `local` | `openai` | `anthropic` | `google`
- Local deterministic engine needs no key
- External LLM use is gated by user consent (`User.aiConsentAt`)
- Assistant, task parser, day planner, insight generator, report generator

### Notifications and email
- **nodemailer** and **resend**
- Dev email transport writes to `.dev-mail/`
- In-app, email, and push reminder channels modelled
- Recurrence engine in `src/lib/notifications/recurrence.ts`

### PWA and mobile
- **Serwist** (`serwist`, `@serwist/turbopack`) service worker and offline page
- Web app manifest at `/manifest.webmanifest`
- Installable PWA with maskable icons
- **Capacitor** Android shell in `mobile/` (`capacitor.config.json`, Gradle project)
- Built APK: `mobile/LIFEOS-test.apk`

### Testing and quality
- **Vitest 5.0.2** (unit/integration), jsdom, Testing Library
- **Playwright** for E2E
- **ESLint 9** with `eslint-config-next` and TypeScript ESLint
- **Prettier 3.9.9**

---

## 3. Feature Modules

Navigation is defined once in `src/lib/nav.ts` and drives the sidebar, mobile bar, and command palette.

### Today
| Route | Feature |
|---|---|
| `/dashboard` | Daily overview: summary, activity strip, week strip, panels, quick capture, streaks, XP |
| `/planner` | Day timeline, drag-and-drop time blocks, routine/calendar/task scheduling, AI day plan |
| `/tasks` | Task list with priorities, subtasks, tags, categories, recurrence, snooze, bulk actions |
| `/focus` | Pomodoro / custom / deep-work timer, server-stamped elapsed time, pause/resume, ratings, XP |

### Track
| Route | Feature |
|---|---|
| `/habits` | Habit grid, streaks, boolean/count/duration/distance/quantity habits, schedules, logs |
| `/wellbeing` | Daily mood, energy, stress, sleep quality/hours check-in |
| `/journal` | Daily journal entries, mood/energy tags, word count, AI summary field |
| `/fitness` | Exercise library, workout log, sets/reps/weight/duration, weekly planner, routines, reschedule |
| `/study` | Study timetable/series, sessions, subjects, start-to-focus flow, weekly schedule |

### Direction
| Route | Feature |
|---|---|
| `/goals` | Goals with horizons, milestones, check-ins, progress, linked tasks/habits/projects |
| `/projects` | Project boards, statuses, milestones, task links, progress |
| `/analytics` | Charts for tasks, habits, focus, goals, categories, life balance, weekly/monthly reports |
| `/insights` | Generated correlations, patterns, predictions, recommendations, one-tap actions |

### Assist
| Route | Feature |
|---|---|
| `/ai` | AI assistant chat, task parsing, day planning, citations and evidence |
| `/routines` | Morning/evening/etc. step sequences, runs, habit/task creation from steps |
| `/notifications` | Reminders and notifications inbox, read state, recurrence |
| `/calendar` | Local calendar events, calendar connections (Google/Outlook), linked time blocks |

### Account and onboarding
| Route | Feature |
|---|---|
| `/` | Marketing landing page |
| `/sign-in`, `/sign-up` | Credentials auth, optional Google |
| `/forgot-password`, `/reset-password` | Opaque hashed reset tokens |
| `/verify-email` | Email verification token flow |
| `/welcome` | Post-auth welcome |
| `/onboarding` | Profile capture used by the planner and AI |
| `/settings` | Theme, timezone, locale, AI consent, gamification, week start, quiet hours, password, profile |
| `/~offline` | PWA offline fallback |

---

## 4. Architecture

### Layered structure

```
src/
  app/                 Next.js App Router (pages, layouts, route handlers)
  components/          UI and feature components
    app/               Feature screens and shared app widgets
    auth/              Auth forms
    brand/             Splash/brand
    feedback/          Feedback/error states
    providers/         Theme, motion, query providers
    ui/                Reusable primitives (Radix + Tailwind)
  lib/                 Server/domain logic
    ai/                Assistant, parser, planner, insights, reports, snapshots
    analytics/         Chart aggregation
    api/               API envelope, errors, withApi wrapper, client
    auth/              Auth.js config, guards, tokens, passwords, rate limits
    email/             Dev/Resend transports
    fitness/           Workout presets, schedule generation, server logic
    focus/             Elapsed-time math
    format/            Date and duration formatting
    habits/            Completion rules
    notifications/     Dispatch, recurrence, reminder patching
    planner/           Day layout and server logic
    projects/          Progress computation
    routines/          Slot suggestions and time-of-day helpers
    study/             Study presets, schedule generation, server logic
    validation/        Zod schemas for every input
    weekly-plans/      Week math, progress, server logic
    db.ts              Prisma client singleton + pg adapter
    env.ts             Server env validation
    nav.ts             Single source of navigation
    rate-limit.ts      In-process fixed-window limiter
  generated/prisma/    Generated Prisma client (do not edit)
  styles/              Tailwind globals and design tokens
  types/               NextAuth type augmentation
  proxy.ts             Next 16 middleware (Node runtime) for redirect UX
prisma/                Schema, migrations, seed
test/                  Vitest suites
scripts/               PWA/Android icons and runtime check scripts
mobile/                Capacitor Android project and APK
public/                Static assets and icons
```

### Request flow

1. **Page request** -> `src/proxy.ts` checks the session and redirects unauthenticated users.
2. `(app)/layout.tsx` calls `getCurrentUser()` and renders `AppShell`.
3. Server Components read data through service modules in `src/lib/*`.
4. Mutations go to `/api/v1/*` route handlers or Server Actions.
5. Every API route is wrapped by `withApi`, which applies:
   - Session authentication (`requireUser`)
   - Zod body validation
   - Zod query validation
   - Zod route-param validation
   - Per-user + per-IP + per-path rate limiting
   - Uniform success/error envelopes
6. Domain/service functions enforce ownership (`userId`) before every read or write.
7. Prisma + `pg` adapter talks to PostgreSQL.

### API envelope

Success:
```json
{ "ok": true, "data": { ... } }
```

Failure:
```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields need attention.",
    "details": { "field": "message" }
  }
}
```

`Retry-After` is set on rate-limited responses.

### Server-side module rules
- `server-only` is imported by `env`, `db`, and other server modules, so secrets cannot be bundled into client code.
- `src/generated/prisma` is never edited.
- `src/lib/validation/schemas.ts` is the single source of input contracts.
- Every user-owned table is indexed on `(userId, ...)` because every query is scoped to one user.
- Authorization is enforced in the service layer, not by client redirects.

---

## 5. Data Model

Defined in `prisma/schema.prisma`. **55 models**, grouped below.

### Auth and identity
`User`, `Account`, `Session`, `VerificationToken`, `PasswordResetToken`, `EmailVerificationToken`, `Profile`

Key fields on `User`:
- `role` (USER / ADMIN)
- `onboardedAt`, `passwordChangedAt`
- `theme`, `timezone`, `locale`
- `aiEnabled`, `aiConsentAt`
- `gamificationOn`, `weekStartsOn`
- `dailySummaryTime`, `quietHoursStart`, `quietHoursEnd`

### Taxonomy
`Category`, `Tag`, `TaskTag`
- System categories have `userId = null` and `isSystem = true`.
- Category kinds: HEALTH, FITNESS, STUDY, CAREER, FINANCE, RELATIONSHIPS, PERSONAL_GROWTH, REST, HOBBIES, OTHER.

### Tasks and projects
`Task`, `Project`, `ProjectTask`, `ProjectMilestone`
- Tasks support subtasks (`parentId`), tags, recurrence JSON, priority scoring (`importance`, `urgency`, `priorityScore`, `priorityBand`), energy cost, snooze, and links to goals/milestones/categories.
- Projects link tasks through the join table `ProjectTask` and own milestones.

### Habits
`Habit`, `HabitSchedule`, `HabitLog`
- Habit types: BOOLEAN, COUNT, DURATION, DISTANCE, QUANTITY
- Frequencies: DAILY, WEEKLY, CUSTOM
- `HabitLog` is unique per `(habitId, date)`.
- `workoutId` and `studySessionId` are double-count guards: an auto-created log is excluded from fitness/study totals to avoid counting the same effort twice.

### Goals
`Goal`, `GoalMilestone`, `GoalCheckIn`
- Horizons: SHORT, MEDIUM, LONG
- Statuses: ACTIVE, PAUSED, ACHIEVED, ABANDONED
- Progress, XP reward, AI-generated flag, source goal for breakdowns

### Weekly plans
`WeeklyPlan`, `WeeklyPlanTask`, `WeeklyPlanHabit`, `WeeklyPlanDay`, `WeeklyPlanTemplate`
- A plan is an intention across a date span; it links existing tasks/habits rather than copying them.
- Target types: HOURS, SESSIONS, TASKS, COUNT.
- Categories: STUDY, FITNESS, PERSONAL, WORK, PROJECT, CUSTOM.
- Days support explicit rest days (`note`), and template configuration stores titles only so it cannot rot.

### Study timetable
`StudySeries`, `StudySession`, `StudySeriesSkip`
- `StudySeries` is the recurring rule (subject, start minutes, duration, weekdays, repeat).
- `StudySession` is one occurrence with status: PLANNED, IN_PROGRESS, COMPLETED, MISSED, RESCHEDULED.
- `StudySeriesSkip` is a tombstone preventing deleted occurrences from being regenerated.
- `generatedThrough` is the rolling-horizon marker.
- Completing a session can write a `HabitLog` and can be driven by a `FocusSession`.

### Routines
`Routine`, `RoutineItem`, `RoutineRun`
- A routine is a sequence of steps for one sitting (morning, evening, etc.).
- Steps can link habits/tasks and optionally create tasks on run.
- Runs track completed/total items.

### Time blocks and focus
`TimeBlock`, `FocusSession`
- Time blocks carry a source: AI, MANUAL, ROUTINE, CALENDAR, FOCUS, and can be locked from AI moves.
- Focus sessions track planned/actual seconds, type, rating, XP, pause state (`pausedAt`, `pausedSeconds`), and optional study-session/task/project links.
- Elapsed time is derived from server-stamped instants.

### Journal and wellbeing
`JournalEntry`, `MoodEnergyEntry`
- One journal entry and one wellbeing entry per user per date.
- Mood/energy/stress/sleep quality are 1-5 scales.

### Insights and reports
`Insight`, `WeeklyReview`, `MonthlyReport`
- Insight kinds: CORRELATION, PATTERN, PREDICTION, RECOMMENDATION, OBSERVATION.
- Insights support status, confidence, sample size, evidence JSON, source (LOCAL/LLM), and action payloads.
- Weekly review is unique per `(userId, weekStart)` and includes the user's own reflections.
- Monthly report stores metrics, achievements, habit/goal/focus/time/life-balance stats.

### AI
`AIConversation`, `AIMessage`
- Messages record role, source, provider, model, token counts, latency, and error code.

### Gamification
`UserStats`, `Achievement`, `UserAchievement`
- XP, level, current/longest streak, freeze tokens, completed counts.
- Achievements have rarity and JSON criteria.

### Notifications and reminders
`Notification`, `Reminder`
- Notification types: TASK, HABIT, GOAL, AI, SYSTEM, ACHIEVEMENT.
- Reminder channels: IN_APP, EMAIL, PUSH.
- Reminders support recurrence JSON, timezone, targets, and sent timestamps.

### Calendar
`CalendarEvent`, `CalendarConnection`
- Local/Google/Outlook sources.
- Connections store encrypted OAuth tokens (`accessTokenEnc`, `refreshTokenEnc`).
- Events can be linked to time blocks.

### Fitness
`Exercise`, `Workout`, `WorkoutExercise`, `WorkoutSet`
- Exercise library supports system rows (`userId = null`, `isSystem = true`).
- Workout statuses: PLANNED, IN_PROGRESS, COMPLETED, SKIPPED, RESCHEDULED.
- Only COMPLETED counts as training volume/history.
- Exercise names are snapshotted so library edits never rewrite history.

### Fitness routines (weekly training templates)
`WorkoutRoutine`, `WorkoutRoutineDay`, `WorkoutRoutineExercise`, `WorkoutRoutineSet`
- One active routine per user (enforced in the service layer).
- Weekdays are `0 = Monday .. 6 = Sunday` here, intentionally different from JS `getDay()` used elsewhere.
- Rest days are explicit.
- `generatedThrough` prevents deleted sessions from reappearing.

### Enums
`UserRole`, `ThemePreference`, `CategoryKind`, `TaskStatus`, `TaskPriority`, `EnergyCost`, `HabitType`, `HabitDifficulty`, `HabitFrequency`, `GoalHorizon`, `GoalStatus`, `MilestoneStatus`, `ProjectStatus`, `RoutineKind`, `BlockSource`, `FocusType`, `MuscleGroup`, `WorkoutStatus`, `InsightKind`, `InsightStatus`, `AISource`, `NotificationType`, `ReminderChannel`, `ReminderTargetType`, `WeeklyPlanCategory`, `WeeklyPlanTargetType`, `WeeklyPlanStatus`, `CalendarSource`, `StudyRepeat`, `StudySessionStatus`, `AchievementRarity`, `MessageRole`.

---

## 6. API Reference

Base path: `/api/v1`. Auth.js is mounted at `/api/auth/[...nextauth]`.

All `/api/v1` routes go through `withApi` unless noted, use the standard envelope, and return `401` without a valid session.

### Auth
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/auth/sign-up` | Create account, hash password, send verification |
| POST | `/api/v1/auth/verify-email` | Consume verification token |
| POST | `/api/v1/auth/resend-verification` | Re-issue verification email |
| POST | `/api/v1/auth/forgot-password` | Issue password-reset token |
| POST | `/api/v1/auth/reset-password` | Consume reset token, update password |
| * | `/api/auth/[...nextauth]` | Auth.js sign-in/out, OAuth callbacks, session |

### Core resources
| Methods | Path |
|---|---|
| GET, POST | `/api/v1/tasks`, `/api/v1/habits`, `/api/v1/goals`, `/api/v1/projects`, `/api/v1/routines`, `/api/v1/journal`, `/api/v1/wellbeing`, `/api/v1/calendar-events`, `/api/v1/focus`, `/api/v1/time-blocks`, `/api/v1/reminders`, `/api/v1/exercises`, `/api/v1/workouts`, `/api/v1/study-series`, `/api/v1/study-sessions`, `/api/v1/weekly-plans`, `/api/v1/workout-routines` |
| GET, PATCH | `/api/v1/settings`, `/api/v1/notifications` |
| GET | `/api/v1/insights`, `/api/v1/workout-schedule` |

### Item routes
`/api/v1/{resource}/{id}` for tasks, habits, goals, projects, routines, journal, calendar events, reminders, exercises, workouts, study series, study sessions, weekly plans, workout routines.

### Nested and action routes
| Path | Purpose |
|---|---|
| `/api/v1/habits/{id}/log` | Upsert habit log |
| `/api/v1/goals/{id}/milestones` | List/create milestones |
| `/api/v1/goals/{id}/milestones/{milestoneId}` | Update/delete milestone |
| `/api/v1/goals/{id}/check-ins` | List/create check-ins |
| `/api/v1/goals/{id}/check-ins/{checkInId}` | Update/delete check-in |
| `/api/v1/projects/{id}/milestones` | Project milestones |
| `/api/v1/projects/{id}/tasks` | Link/unlink project tasks |
| `/api/v1/routines/{id}/items` | Routine steps |
| `/api/v1/routines/{id}/runs` | Start/complete routine runs |
| `/api/v1/focus/{id}/pause` | Pause focus timer |
| `/api/v1/focus/{id}/resume` | Resume focus timer |
| `/api/v1/study-sessions/{id}/start` | Start a session against the focus timer |
| `/api/v1/study-sessions/{id}/reschedule` | Move a session, preserving history |
| `/api/v1/workouts/{id}/reschedule` | Move a workout, preserving history |
| `/api/v1/weekly-plans/{id}/tasks` | Add/remove/pin tasks |
| `/api/v1/weekly-plans/{id}/habits` | Add/remove linked habits |
| `/api/v1/weekly-plans/{id}/copy` | Copy plan to another week |
| `/api/v1/weekly-plans/templates` | List/create templates |
| `/api/v1/weekly-plans/templates/{id}` | Apply/update/delete template |
| `/api/v1/weekly-plans/reviews/{weekStart}` | Save weekly review notes |
| `/api/v1/workout-routines/from-week` | Build a routine from a planned week |
| `/api/v1/workout-routines/{id}/activate` | Activate routine (pauses others) |
| `/api/v1/workout-routines/{id}/pause` | Pause routine |
| `/api/v1/workout-routines/{id}/apply` | Materialise schedule over horizon |

### AI
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/ai/chat` | Assistant reply with citations/evidence |
| POST | `/api/v1/ai/parse-task` | Natural-language task capture |
| POST | `/api/v1/ai/plan` | Generate a day plan |
| POST | `/api/v1/insights/generate` | Generate insights |
| POST | `/api/v1/insights/{id}/action` | Apply an insight action |
| POST | `/api/v1/reviews/generate` | Generate weekly/monthly report |

### Account and onboarding
| Method | Path |
|---|---|
| POST | `/api/v1/onboarding` |
| PATCH | `/api/v1/settings/profile` |
| PATCH | `/api/v1/settings/password` |

---

## 7. AI Design

The AI layer is deliberately **truth-first**.

### Local engine (default)
- No API key required.
- The assistant classifies a question into a fixed intent (OVERVIEW, WHAT_NOW, TASKS_DUE, OVERDUE, HABITS, HABIT_STREAK, FOCUS, MOOD, GOALS, SCHEDULE, CAPTURE, UNKNOWN).
- It answers from a `LifeSnapshot` using arithmetic and templates.
- Every answer includes:
  - `intent`
  - `reply`
  - `citations` (human-readable sources)
  - `evidence` (rows behind the numbers)
  - optional `capture` draft
  - `suggestions`
- Design reason: a life tracker must not invent its own statistics.

### External LLM mode
- Enabled only when `AI_PROVIDER` is `openai`, `anthropic`, or `google` **and** the key exists **and** the user has consented (`aiConsentAt`).
- `hasLlmProvider()` in `src/lib/env.ts` decides availability.
- Provider/model/token/latency/error metadata is persisted on `AIMessage`.

### Modules
| File | Responsibility |
|---|---|
| `snapshot.ts` | Builds the user's life snapshot |
| `assistant.ts` | Intent classification and templated answers |
| `task-parser.ts` | Natural-language task extraction |
| `when.ts` | Natural-language date/time parsing |
| `day-plan.ts` | Day planning |
| `classify.ts` | Classification helpers |
| `insights.ts` | Correlation/pattern/recommendation generation |
| `reports.ts` | Weekly/monthly report generation |
| `actions.ts` | Declarative action plans and safe writes |
| `action-context.ts` | Validates what an action may touch |
| `stats.ts` | Math/formatting helpers |

---

## 8. Authentication and Security

### Authentication
- Credentials (email + password) via Auth.js.
- Optional Google OAuth, registered only when both `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` exist.
- Unverified email accounts are refused at `authorize`.
- Dummy argon2 hash is verified for unknown emails to prevent timing-based account enumeration.
- JWT session strategy.
- `passwordChangedAt` is embedded as the `pwd` claim; a mismatch invalidates all previously issued sessions.
- `UserStats` is provisioned on every successful sign-in via the Auth.js `signIn` event.

### Authorization
- `src/proxy.ts` is **UX only**; it is not the security boundary.
- Every API route calls `requireUser()`.
- Every service function scopes queries by `userId`.
- A session with no `user.id` is treated as unauthenticated (fail closed).

### Passwords and tokens
- argon2id hashing (`@node-rs/argon2`).
- Password policy in `src/lib/auth/password-policy.ts`.
- Reset and verification tokens are opaque and stored only as SHA-256 hashes.
- Tokens have expiry and `usedAt` markers.

### API hardening
- Zod validation for body, query, and params.
- Uniform error envelope; 5xx details are logged but never returned.
- Per-user/IP/path fixed-window rate limiting.
- Sign-in rate limiting is applied in the Auth.js route handler so it can return a real `429`.

### HTTP headers (next.config.ts)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Secrets
- Server secrets are read only in `src/lib/env.ts`, guarded by `server-only`.
- Calendar OAuth tokens are encrypted at rest with `TOKEN_ENCRYPTION_KEY`.
- `.env` is gitignored; `.env.example` is the template.

---

## 9. Environment Configuration

Copy `.env.example` to `.env`.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | Auth.js signing secret (>= 16 chars) |
| `AUTH_TRUST_HOST` | Recommended | `true` behind proxies |
| `AUTH_URL` | Optional | Canonical auth URL |
| `NEXT_PUBLIC_APP_URL` | Recommended | App URL used in links and metadata |
| `TOKEN_ENCRYPTION_KEY` | Yes | 32-byte base64url key for calendar OAuth tokens |
| `AI_PROVIDER` | Optional | `local` \| `openai` \| `anthropic` \| `google` (default `local`) |
| `OPENAI_API_KEY` | Conditional | Required for `openai` |
| `ANTHROPIC_API_KEY` | Conditional | Required for `anthropic` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Conditional | Required for `google` |
| `AUTH_GOOGLE_ID` | Optional | Enables Google sign-in |
| `AUTH_GOOGLE_SECRET` | Optional | Enables Google sign-in |
| `EMAIL_TRANSPORT` | Optional | `dev` \| `resend` (default `dev`) |
| `RESEND_API_KEY` | Conditional | Required for `resend` |
| `EMAIL_FROM` | Optional | Sender address |

Generate secrets:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`EMAIL_TRANSPORT=dev` writes messages to `./.dev-mail/` and logs links, so the full signup/reset flow works without a mail account.

---

## 10. Getting Started

### Prerequisites
- Node.js >= 20.9.0
- PostgreSQL (local or hosted)
- npm (lockfile: `package-lock.json`)

### Setup
```powershell
npm install
Copy-Item .env.example .env
# edit .env with DATABASE_URL, AUTH_SECRET, TOKEN_ENCRYPTION_KEY
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

### Production build
```powershell
npm run build
npm run start
```

Vercel-style deploy with migrations:
```powershell
npm run vercel-build
```

---

## 11. Scripts

### Application
| Script | Description |
|---|---|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run vercel-build` | `prisma migrate deploy && next build` |
| `npm run lint` | ESLint |
| `npm run lint:fix` | ESLint autofix |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest run |
| `npm run test:watch` | Vitest watch |
| `npm run test:e2e` | Playwright |
| `npm run verify` | typecheck + lint + test + build |

### Database
| Script | Description |
|---|---|
| `npm run db:generate` | Prisma generate |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:deploy` | `prisma migrate deploy` |
| `npm run db:seed` | Seed database |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | Reset database (force) |

### Assets
| Script | Description |
|---|---|
| `npm run icons:pwa` | Generate PWA icons |
| `npm run icons:android` | Generate Android icons |

### Runtime checks
| Script | Description |
|---|---|
| `npm run check:routes` | Route integrity |
| `npm run check:reminders` | Reminder engine |
| `npm run check:reminder-api` | Reminder API |
| `npm run check:weekly-plans` | Weekly plans |
| `npm run check:overflow` | Layout overflow probe |
| `npm run verify:runtime` | All runtime checks |

---

## 12. Testing

Test files live in `test/` and use Vitest.

Coverage areas include:
- Authentication config, password hashing/policy, sign-in limits
- Tokens, rate limiting, proxy matcher
- Task, habit, goal, routine, mood/journal, settings, reminder schemas
- Date and duration formatting
- Progress, dashboard summary, analytics chart aggregation
- Habit rules, routine slots/suggestions, planner layout
- Weekly plan schemas/progress/week math
- Study schedule
- Notification recurrence and reminder patching
- AI: assistant, task parser, "when" parser, classification, actions, insights
- Error envelope

Run:
```powershell
npm run test
npm run test:watch
```

---

## 13. PWA and Mobile

### PWA
- Manifest: `src/app/manifest.ts` -> `/manifest.webmanifest`
- Display: `standalone`, portrait
- Theme/background: `#0a0b0f`
- Icons: 192/512 any + maskable, plus Apple touch icon
- Service worker and offline page via Serwist (`src/app/serwist`, `src/app/~offline`)
- Install prompt component: `src/components/app/install-prompt.tsx`

### Android (Capacitor)
- Config: `mobile/capacitor.config.json`
- App ID: `com.lifeos.app`
- Web directory: `www`
- Dev server URL points to a LAN host (`http://192.168.1.5:3000/welcome`)
- Native project: `mobile/android`
- Test APK: `mobile/LIFEOS-test.apk`

---

## 14. Deployment Notes

- **Database**: run `prisma migrate deploy` before starting the app (`vercel-build` does this).
- **Build output**: Next.js standalone/server build; no custom server.
- **Secrets**: set all required env vars in the hosting provider.
- **Email**: switch `EMAIL_TRANSPORT` to `resend` and set `RESEND_API_KEY` in production.
- **AI**: set `AI_PROVIDER` and the matching key; users must still consent in settings.
- **Rate limiting**: current limiter is in-process. For multiple instances, replace it with a shared store (e.g., Redis) behind the existing `rateLimit` interface.
- **Prisma 7 specifics**:
  - Generator output is required.
  - `datasource` has no `url`; the URL lives in `prisma.config.ts`.
  - Enums intentionally have no `@map`.
  - `@prisma/client`, `@prisma/adapter-pg`, `pg`, and `@node-rs/argon2` are server-external packages.

---

## 15. Conventions and Design Decisions

- **One source of truth for navigation**: `src/lib/nav.ts`.
- **One entry point for APIs**: `withApi`.
- **One source for input validation**: `src/lib/validation/schemas.ts`.
- **Ownership in the service layer**, not in the UI.
- **Intent vs fact separation**: PLANNED is never counted as COMPLETED; scheduled minutes are never copied into actual minutes.
- **Join tables over copies**: weekly plan tasks/habits are links, so deleting a plan never deletes user work.
- **Templates store titles, not IDs**, so they cannot rot.
- **Tombstones for recurring skips**: `StudySeriesSkip` prevents regeneration.
- **Rolling horizons**: `generatedThrough` prevents deleted sessions/workouts from reappearing.
- **Double-count guards**: `HabitLog.workoutId` and `HabitLog.studySessionId`.
- **Server-stamped time**: focus elapsed time never trusts a client counter.
- **Truth-first AI**: cite evidence; never invent statistics.
- **Dates**: calendar days use `@db.Date` (UTC midnight); times of day use minutes from local midnight.
- **Weekday conventions**:
  - JS convention `0 = Sunday` for habits, weekly plans, and study series.
  - `0 = Monday` only for `WorkoutRoutineDay`, stated explicitly.
- **No comments unless they explain a non-obvious invariant** - the codebase documents "why", not "what".

---

## 16. Known Constraints

- The rate limiter is per-process, not distributed.
- Sign-in limiting is in-memory.
- External calendar sync is modelled (`CalendarConnection`, `CalendarEvent`) but provider sync is not a background job.
- Reminder delivery depends on the configured channel; the dev transport writes to disk.
- The Android app currently points at a LAN dev server.
- AI quality in `local` mode is deterministic and intentionally limited to what the data supports.

---

*Generated from the repository source: `package.json`, `prisma/schema.prisma`, `src/proxy.ts`, `src/lib/*`, `src/app/*`, and configuration files.*
