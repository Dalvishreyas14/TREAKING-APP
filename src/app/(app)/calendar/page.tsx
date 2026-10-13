import { CalendarRange } from "lucide-react";

import { CalendarGrid, type CalendarEventRow } from "@/components/app/calendar-grid";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { addDaysUtc, dateOnly } from "@/lib/date";
import { formatMonthYear, formatWeekdayShort } from "@/lib/format/date";

export const dynamic = "force-dynamic";

/**
 * Calendar.
 *
 * The visible month lives in the URL (`?month=2026-09`) rather than in client
 * state. That is what makes the browser's back button step back through months,
 * makes a month linkable, and lets the server render the right month on first
 * paint instead of flashing the current one and correcting itself.
 *
 * **Events are fetched by overlap, not by start date.** `startAt >= monthStart`
 * is the obvious query and it is wrong: a three-day conference starting on the
 * 28th of last month has this month's dates on the grid, and filtering on start
 * silently drops it. So the range is `startAt < monthEnd AND endAt > monthStart`.
 *
 * **An all-day event is stored as a span, not a point.** The client sends
 * `startAt`/`endAt` as local-midnight instants, so an all-day event ends at the
 * end of its own day rather than at its start — otherwise a single-day all-day
 * event would render with zero height.
 *
 * No external connections are fabricated. `CalendarConnection` is empty in this
 * build, and the screen says so instead of offering a Connect button that would
 * have nothing behind it.
 */

const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
  formatWeekdayShort(new Date(Date.UTC(2024, 0, 7 + i))),
);

function parseMonthParam(value: string | undefined): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return new Date(Date.UTC(year, 0, 1));
  }
  return new Date(Date.UTC(year, month - 1, 1));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const monthStart = parseMonthParam(params.month);
  // Grid starts on the Sunday on or before the 1st, so leading days from the
  // previous month are visible rather than blank.
  const gridStart = addDaysUtc(monthStart, -monthStart.getUTCDay());
  const monthEnd = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1),
  );
  const gridEnd = addDaysUtc(monthEnd, 7);

  const [events, connections] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: {
        userId: user.id,
        // The overlap test, expressed so Prisma can use the (userId, startAt,
        // endAt) index for the lower bound.
        startAt: { lt: gridEnd },
        endAt: { gt: gridStart },
      },
      orderBy: [{ allDay: "desc" }, { startAt: "asc" }],
      take: 300,
      select: {
        id: true,
        title: true,
        description: true,
        startAt: true,
        endAt: true,
        allDay: true,
        location: true,
        color: true,
        source: true,
      },
    }),
    prisma.calendarConnection.findMany({
      where: { userId: user.id },
      select: { id: true, provider: true, email: true },
    }),
  ]);

  const rows: CalendarEventRow[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    description: event.description,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    allDay: event.allDay,
    location: event.location,
    color: event.color,
    source: event.source,
  }));

  const today = dateOnly();
  const thisMonthCount = events.filter(
    (e) =>
      e.startAt >= monthStart && e.startAt < monthEnd,
  ).length;

  const monthParam = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`;
  const prevParam = monthParamFor(monthStart, -1);
  const nextParam = monthParamFor(monthStart, 1);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Calendar</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {events.length === 0
            ? "Appointments and commitments, in one place."
            : `${thisMonthCount} ${thisMonthCount === 1 ? "event" : "events"} in ${formatMonthYear(monthStart)}`}
        </p>
      </header>

      {connections.length === 0 ? (
        <p className="flex items-start gap-2 rounded-control border border-line bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-subtle">
          <CalendarRange className="mt-px size-3.5 shrink-0" />
          Events here are the ones you add in LIFEOS. Connecting Google or Outlook is
          not available in this build, so nothing is being synced or read from an
          external account.
        </p>
      ) : (
        <p className="text-[11px] text-ink-subtle">
          Synced from {connections.map((c) => c.provider).join(", ")}.
        </p>
      )}

      <CalendarGrid
        events={rows}
        monthStartIso={monthStart.toISOString()}
        monthLabel={formatMonthYear(monthStart)}
        weekdayLabels={WEEKDAY_LABELS}
        todayIso={today.toISOString()}
        prevHref={`/calendar?month=${prevParam}`}
        nextHref={`/calendar?month=${nextParam}`}
        todayHref={`/calendar?month=${monthParamFor(today, 0)}`}
        isCurrentMonth={monthParam === monthParamFor(today, 0)}
      />
    </div>
  );
}

function monthParamFor(anchor: Date, delta: number): string {
  const d = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + delta, 1),
  );
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
