import {
  ArrowRight,
  Brain,
  CalendarCheck,
  CheckCircle2,
  Compass,
  Gauge,
  ListChecks,
  Lock,
  NotebookPen,
  Repeat,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
} from "lucide-react";

import { Logo, Wordmark } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/**
 * The marketing page.
 *
 * Two decisions worth stating. First, it reads the session so a signed-in
 * visitor gets "Open dashboard" rather than a second sign-up button — a
 * marketing page that ignores who is looking at it is the most common waste of
 * a homepage. Second, every claim below is something the product actually
 * does. The intelligence section in particular is not "powered by AI"; it
 * describes deterministic computation that runs with no API key, because that
 * is the part users are choosing LIFEOS for and the part a competitor's landing
 * page quietly does not have.
 */

const MODULES = [
  {
    icon: ListChecks,
    name: "Tasks",
    body: "Projects, priorities and a single inbox that actually drains.",
  },
  {
    icon: CalendarCheck,
    name: "Planner",
    body: "Block out a day that fits the hours you really have.",
  },
  {
    icon: Repeat,
    name: "Habits",
    body: "Boolean or counted, with streaks that survive a missed day.",
  },
  {
    icon: Gauge,
    name: "Wellbeing",
    body: "Mood, energy and stress in thirty seconds a day.",
  },
  {
    icon: Timer,
    name: "Focus",
    body: "Sessions that turn into hours you can actually look back on.",
  },
  {
    icon: NotebookPen,
    name: "Journal",
    body: "One entry, tagged and searchable, not a folder of drafts.",
  },
  {
    icon: Target,
    name: "Goals & projects",
    body: "Outcomes broken into the next concrete action.",
  },
  {
    icon: Compass,
    name: "Routines",
    body: "Morning, evening and reset routines you can follow.",
  },
  {
    icon: TrendingUp,
    name: "Insights",
    body: "Patterns from your own data, shown with their confidence.",
  },
];

const INTELLIGENCE = [
  {
    icon: Brain,
    title: "It reads plain language",
    body: 'Write "run 3km every Tuesday morning" and it becomes a recurring task on your planner, on your calendar, with the reminder already set.',
  },
  {
    icon: Gauge,
    title: "It scores what matters to you",
    body: "Life Balance weighs your categories the way you set them, so the number reflects your week rather than a generic template.",
  },
  {
    icon: Sparkles,
    title: "It finds your patterns",
    body: "Correlations across what you have logged, each shown with a confidence level and a plain-English explanation of how it was found.",
  },
  {
    icon: ListChecks,
    title: "It breaks goals down",
    body: "An outcome becomes a milestone, a milestone becomes a task, and the task lands in a week that has room for it.",
  },
];

const PRINCIPLES = [
  {
    icon: Lock,
    title: "Your data is yours",
    body: "We do not sell it, and there is no third-party advertising or analytics script watching what you type.",
  },
  {
    icon: CheckCircle2,
    title: "Every number explains itself",
    body: "Scores say what they were computed from. Nothing is presented as more certain than the data behind it allows.",
  },
  {
    icon: NotebookPen,
    title: "Not medical advice",
    body: "Mood and energy tracking is for your own reflection. LIFEOS does not diagnose, treat, or make claims about your health.",
  },
  {
    icon: Gauge,
    title: "No dark patterns",
    body: "No streak guilt, no artificial urgency, and no feature held hostage to a subscription you did not choose.",
  },
];

/**
 * Sets a child's position in a `.reveal-stagger` group. The custom property is
 * what the CSS reads to work out the delay, so the cast tells TypeScript it is
 * intentional rather than a typo.
 */
const stagger = (i: number) => ({ "--i": i }) as React.CSSProperties;

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="reveal mx-auto max-w-2xl text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-lime">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
        {title}
      </h2>
      {body ? (
        <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">{body}</p>
      ) : null}
    </div>
  );
}

/**
 * A static impression of the dashboard, built from the same primitives the real
 * screen uses. Deliberately not a screenshot: it stays sharp, it follows the
 * light and dark themes, and it cannot go stale against a layout change the way
 * an image does.
 */
function ProductPreview() {
  return (
    <div className="gradient-border rounded-card border border-line bg-surface p-2 shadow-pop">
      <div className="rounded-card bg-canvas p-4">
        <div className="flex items-center justify-between">
          {/*
            The mark sits where AppShell puts it, at the size AppShell uses. That
            is the whole trick: the preview is a mock of the real product, so the
            logo reads as something already in the system rather than a badge
            added to a landing page.
          */}
          <div className="flex items-center gap-2">
            <Logo size={14} />
            <div>
              <p className="text-[11px] text-ink-subtle">Monday 14 September</p>
              <p className="mt-0.5 text-sm font-semibold">Good morning, Alex</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {["bg-lime", "bg-iris", "bg-aqua"].map((c) => (
              <span key={c} className={`size-2 rounded-full ${c}`} />
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: "Open tasks", value: "12", tint: "text-lime" },
            { label: "Habits today", value: "75%", tint: "text-iris" },
            { label: "Focus logged", value: "3h 20m", tint: "text-aqua" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-control border border-line bg-surface px-2.5 py-2"
            >
              <p className="truncate text-[10px] text-ink-subtle">{stat.label}</p>
              <p className={`mt-0.5 text-[15px] font-semibold ${stat.tint}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-control border border-line bg-surface p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold">Today&apos;s schedule</p>
            <p className="text-[10px] text-ink-subtle">6 blocks</p>
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {[
              { time: "07:00", title: "Morning walk", accent: "bg-positive" },
              { time: "09:30", title: "Deep work", accent: "bg-lime" },
              { time: "11:00", title: "Team standup", accent: "bg-iris" },
              { time: "14:00", title: "Inbox and admin", accent: "bg-amber" },
            ].map((block) => (
              <li key={block.time} className="flex items-center gap-2.5">
                <span className="w-9 shrink-0 font-mono text-[10px] text-ink-subtle">
                  {block.time}
                </span>
                <span className={`h-4 w-0.5 shrink-0 rounded-full ${block.accent}`} />
                <span className="truncate text-[12px]">{block.title}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-3 rounded-control border border-line border-lime/30 bg-lime-soft p-3">
          <p className="text-[11px] font-semibold text-ink">Mornings carry your week</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
            You complete 71% more tasks before noon than after 4pm. Observed across
            121 days of your own logs — a pattern, not a cause.
          </p>
        </div>
      </div>
    </div>
  );
}

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-5">
          <Wordmark />
          <nav aria-label="Sections" className="hidden items-center gap-6 sm:flex">
            <a
              href="#intelligence"
              className="link-underline text-[13px] text-ink-muted transition-colors hover:text-ink"
            >
              Intelligence
            </a>
            <a
              href="#modules"
              className="link-underline text-[13px] text-ink-muted transition-colors hover:text-ink"
            >
              What&apos;s inside
            </a>
            <a
              href="#principles"
              className="link-underline text-[13px] text-ink-muted transition-colors hover:text-ink"
            >
              Principles
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <Button variant="lime" size="sm" asChild>
                <a href="/dashboard">
                  Open dashboard
                  <ArrowRight aria-hidden />
                </a>
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <a href="/sign-in">Sign in</a>
                </Button>
                <Button variant="lime" size="sm" asChild>
                  <a href="/sign-up">Get started</a>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-16 sm:pt-24">
        {/* Decorative only: an accent wash and a faint grid fading out below
            the fold. */}
        <div
          aria-hidden
          className="aurora pointer-events-none absolute inset-x-0 top-0 h-[460px]"
        />
        <div
          aria-hidden
          className="grid-veil pointer-events-none absolute inset-x-5 top-0 h-[420px]"
        />
        <div className="relative grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <Badge variant="lime" className="reveal-load gap-1.5">
              <Sparkles aria-hidden className="size-3" />
              Works with no API key
            </Badge>
            <h1
              style={stagger(1)}
              className="reveal-load mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl"
            >
              Run your life
              <br />
              <span className="text-gradient">with intelligence.</span>
            </h1>
            <p
              style={stagger(2)}
              className="reveal-load mt-5 max-w-xl text-[15px] leading-relaxed text-ink-muted"
            >
              LIFEOS is one workspace for your tasks, habits, focus, wellbeing and
              goals — and it turns what you log into a plan for tomorrow. The
              intelligence is built in, so nothing stops working because you have
              not connected an account.
            </p>
            <div style={stagger(3)} className="reveal-load mt-8 flex flex-wrap items-center gap-3">
              <Button variant="lime" size="lg" asChild>
                <a href={user ? "/dashboard" : "/sign-up"}>
                  {user ? "Open dashboard" : "Start free"}
                  <ArrowRight aria-hidden />
                </a>
              </Button>
              <Button variant="secondary" size="lg" asChild>
                <a href={user ? "/dashboard" : "/sign-in"}>
                  {user ? "Keep working" : "Sign in"}
                </a>
              </Button>
            </div>
            <p
              style={stagger(4)}
              className="reveal-load mt-4 text-[13px] text-ink-subtle"
            >
              Free while in preview. No card, no trial timer.
            </p>
          </div>
          <div className="reveal-scale">
            <ProductPreview />
          </div>
        </div>
      </section>

      <section
        id="intelligence"
        className="border-y border-line bg-surface/40 py-20 sm:py-24"
      >
        <div className="mx-auto w-full max-w-6xl px-5">
          <SectionHeading
            eyebrow="The intelligence"
            title="It does real work, not autocomplete"
            body="Most trackers store what you type. LIFEOS reads it, scores it and argues with it — using deterministic computation that runs on your data, with no external model required."
          />
          <div className="reveal-stagger mt-12 grid gap-4 sm:grid-cols-2">
            {INTELLIGENCE.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  style={stagger(i)}
                  className="group rounded-card border border-line bg-surface p-6 transition-[border-color,transform,box-shadow] duration-200 ease-out-expo hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
                >
                  <div
                    className="grid size-10 place-items-center rounded-control border border-line text-lime"
                    style={{
                      backgroundImage:
                        "linear-gradient(135deg, var(--lime-soft), var(--iris-soft))",
                    }}
                  >
                    <Icon aria-hidden className="size-4.5" />
                  </div>
                  <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                    {item.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="modules" className="py-20 sm:py-24">
        <div className="mx-auto w-full max-w-6xl px-5">
          <SectionHeading
            eyebrow="What's inside"
            title="One system, not nine subscriptions"
            body="Every module writes to the same data, so a morning walk shows up in your energy patterns and your routine at the same time."
          />
          <ul className="reveal-stagger mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((mod, i) => {
              const Icon = mod.icon;
              return (
                <li
                  key={mod.name}
                  style={stagger(i)}
                  className="flex gap-3 rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-2"
                >
                  <Icon aria-hidden className="mt-0.5 size-4.5 shrink-0 text-lime" />
                  <div>
                    <p className="text-[14px] font-semibold">{mod.name}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                      {mod.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section
        id="principles"
        className="border-t border-line bg-surface/40 py-20 sm:py-24"
      >
        <div className="mx-auto w-full max-w-6xl px-5">
          <SectionHeading
            eyebrow="Principles"
            title="What we will not do to you"
            body="A tracker is only worth keeping if you trust what it tells you. These are the commitments that make that possible."
          />
          <div className="reveal-stagger mt-12 grid gap-4 sm:grid-cols-2">
            {PRINCIPLES.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  style={stagger(i)}
                  className="flex gap-4 rounded-card border border-line bg-surface p-6"
                >
                  <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-aqua" />
                  <div>
                    <h3 className="text-[15px] font-semibold tracking-[-0.01em]">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                      {item.body}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-24">
        <div className="gradient-border reveal rounded-card border border-line bg-surface px-6 py-14 text-center shadow-pop sm:px-12">
          <h2 className="text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
            Start with today.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-ink-muted">
            You do not need to backfill a year. Log one day and LIFEOS starts
            working from there.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button variant="lime" size="lg" asChild>
              <a href={user ? "/dashboard" : "/sign-up"}>
                {user ? "Open dashboard" : "Create your account"}
                <ArrowRight aria-hidden />
              </a>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center">
          <Wordmark size={24} />
          <p className="text-[12px] leading-relaxed text-ink-subtle sm:ml-auto sm:max-w-md sm:text-right">
            LIFEOS is a productivity and self-reflection tool. It is not a medical
            device and does not provide diagnosis or treatment. Insights describe
            patterns in your own logged data; correlation is not causation.
          </p>
        </div>
      </footer>
    </main>
  );
}
