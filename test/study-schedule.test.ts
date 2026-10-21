import { describe, expect, it } from "vitest";

import { elapsedFocusSeconds } from "@/lib/focus/elapsed";
import { habitCompletion } from "@/lib/habits/rules";
import {
  completionPercent,
  deriveSessionStatus,
  durationFromTimes,
  findOverlap,
  formatClock,
  groupSessionsByDay,
  isoDayOfWeekday,
  parseClock,
  plannedVersusActual,
  repeatDays,
  repeatLabel,
  sessionsOverlap,
  shiftIsoDay,
  weekDays,
  weekdayOfIsoDay,
} from "@/lib/study/schedule";
import { resolveStudyDuration } from "@/lib/validation/schemas";

/**
 * Study timetable arithmetic.
 *
 * These are the rules the form, the API and the weekly grid all share. A bug in
 * any of them shows up as a session on the wrong day, a duration that disagrees
 * between the preview and the saved row, or a week that reports a failure that
 * has not happened yet - so they are checked directly rather than through the
 * UI.
 */

describe("durationFromTimes", () => {
  it("measures a normal session in minutes", () => {
    expect(durationFromTimes(19 * 60, 20 * 60)).toBe(60);
    expect(durationFromTimes(0, 30)).toBe(30);
  });

  it("rejects an end that is not after the start", () => {
    expect(durationFromTimes(600, 600)).toBeNull();
    expect(durationFromTimes(600, 300)).toBeNull();
  });

  it("rejects a session that would run past midnight", () => {
    expect(durationFromTimes(23 * 60, 24 * 60)).toBe(60);
    // 1441 is past the end of the day, and 0 is not a valid end.
    expect(durationFromTimes(23 * 60, 1441)).toBeNull();
    expect(durationFromTimes(0, 0)).toBeNull();
  });

  it("rejects non-finite and out-of-range input", () => {
    expect(durationFromTimes(Number.NaN, 600)).toBeNull();
    expect(durationFromTimes(-1, 600)).toBeNull();
    expect(durationFromTimes(1500, 1600)).toBeNull();
  });
});

describe("clock formatting and parsing", () => {
  it("formats minutes from midnight", () => {
    expect(formatClock(0)).toBe("12:00 AM");
    expect(formatClock(9 * 60 + 30)).toBe("9:30 AM");
    expect(formatClock(12 * 60)).toBe("12:00 PM");
    expect(formatClock(19 * 60)).toBe("7:00 PM");
  });

  it("treats 1440 as midnight at the end of the day", () => {
    expect(formatClock(1440)).toBe("12:00 AM");
  });

  it("parses both 24-hour and 12-hour input", () => {
    expect(parseClock("19:00")).toBe(1140);
    expect(parseClock("7:00 PM")).toBe(1140);
    expect(parseClock("12:00 AM")).toBe(0);
    expect(parseClock("12:30 pm")).toBe(750);
  });

  it("returns null instead of midnight for bad input", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock("not a time")).toBeNull();
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("19:60")).toBeNull();
    expect(parseClock("13:00 PM")).toBeNull();
  });
});

describe("overlap", () => {
  it("does not treat back-to-back sessions as a clash", () => {
    expect(
      sessionsOverlap(
        { startMinutes: 19 * 60, durationMinutes: 60 },
        { startMinutes: 20 * 60, durationMinutes: 60 },
      ),
    ).toBe(false);
  });

  it("finds a real clash in either order", () => {
    const a = { startMinutes: 19 * 60, durationMinutes: 60 };
    const b = { startMinutes: 19 * 60 + 30, durationMinutes: 60 };
    expect(sessionsOverlap(a, b)).toBe(true);
    expect(sessionsOverlap(b, a)).toBe(true);
  });

  it("ignores the session being edited", () => {
    const candidate = { startMinutes: 600, durationMinutes: 60 };
    const same = { id: "a", startMinutes: 600, durationMinutes: 60 };
    const other = { id: "b", startMinutes: 630, durationMinutes: 60 };
    expect(findOverlap(candidate, [same, other], "a")).toEqual(other);
    expect(findOverlap(candidate, [same], "a")).toBeNull();
  });
});

describe("calendar days", () => {
  it("reads weekdays with the JS convention", () => {
    // 2026-10-19 is a Monday, 2026-10-25 a Sunday.
    expect(weekdayOfIsoDay("2026-10-19")).toBe(1);
    expect(weekdayOfIsoDay("2026-10-25")).toBe(0);
  });

  it("finds a weekday inside the week", () => {
    expect(isoDayOfWeekday("2026-10-19", 1)).toBe("2026-10-19");
    expect(isoDayOfWeekday("2026-10-19", 0)).toBe("2026-10-25");
    expect(isoDayOfWeekday("2026-10-19", 6)).toBe("2026-10-24");
  });

  it("shifts across month, year and leap-day boundaries", () => {
    expect(shiftIsoDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftIsoDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftIsoDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDay("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftIsoDay("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("lists seven days from the week start", () => {
    expect(weekDays("2026-10-19")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });
});

describe("deriveSessionStatus", () => {
  const now = { isoDay: "2026-10-21", minutes: 12 * 60 };

  it("keeps a stored result", () => {
    expect(
      deriveSessionStatus(
        { status: "COMPLETED", date: "2026-10-19", startMinutes: 600, durationMinutes: 60 },
        now,
      ),
    ).toBe("COMPLETED");
    expect(
      deriveSessionStatus(
        { status: "RESCHEDULED", date: "2026-10-19", startMinutes: 600, durationMinutes: 60 },
        now,
      ),
    ).toBe("MISSED");
  });

  it("calls a planned slot that has passed missed", () => {
    expect(
      deriveSessionStatus(
        { status: "PLANNED", date: "2026-10-20", startMinutes: 600, durationMinutes: 60 },
        now,
      ),
    ).toBe("MISSED");
    expect(
      deriveSessionStatus(
        { status: "PLANNED", date: "2026-10-21", startMinutes: 9 * 60, durationMinutes: 60 },
        now,
      ),
    ).toBe("MISSED");
  });

  it("keeps a future or not-yet-ended slot upcoming", () => {
    expect(
      deriveSessionStatus(
        { status: "PLANNED", date: "2026-10-21", startMinutes: 14 * 60, durationMinutes: 60 },
        now,
      ),
    ).toBe("UPCOMING");
    expect(
      deriveSessionStatus(
        { status: "PLANNED", date: "2026-10-22", startMinutes: 9 * 60, durationMinutes: 60 },
        now,
      ),
    ).toBe("UPCOMING");
  });

  it("leaves an in-progress timer alone however long it has run", () => {
    expect(
      deriveSessionStatus(
        { status: "IN_PROGRESS", date: "2026-10-18", startMinutes: 600, durationMinutes: 60 },
        now,
      ),
    ).toBe("IN_PROGRESS");
  });
});

describe("groupSessionsByDay", () => {
  it("keeps empty days and sorts each day by start", () => {
    const days = ["2026-10-19", "2026-10-20"];
    const grouped = groupSessionsByDay(
      [
        { id: "late", date: "2026-10-19", startMinutes: 1200 },
        { id: "early", date: "2026-10-19", startMinutes: 600 },
      ],
      days,
    );
    expect(grouped.get("2026-10-19")!.map((s) => s.id)).toEqual(["early", "late"]);
    expect(grouped.get("2026-10-20")).toEqual([]);
  });
});

describe("plannedVersusActual", () => {
  it("keeps the plan and the record as separate totals", () => {
    expect(
      plannedVersusActual([
        { durationMinutes: 60, actualMinutes: 35, status: "COMPLETED" },
        { durationMinutes: 60, actualMinutes: 0, status: "PLANNED" },
      ]),
    ).toEqual({ plannedMinutes: 120, actualMinutes: 35 });
  });
});

describe("completionPercent", () => {
  const now = { isoDay: "2026-10-21", minutes: 12 * 60 };

  it("reports null when nothing is due yet", () => {
    expect(
      completionPercent(
        [{ status: "PLANNED", date: "2026-10-22", startMinutes: 600, durationMinutes: 60 }],
        now,
      ),
    ).toBeNull();
  });

  it("counts only the sessions whose slot has passed", () => {
    const sessions = [
      { status: "COMPLETED", date: "2026-10-20", startMinutes: 600, durationMinutes: 60 },
      { status: "MISSED", date: "2026-10-21", startMinutes: 9 * 60, durationMinutes: 60 },
      { status: "PLANNED", date: "2026-10-23", startMinutes: 600, durationMinutes: 60 },
    ];
    expect(completionPercent(sessions, now)).toBe(50);
  });

  it("does not count a rescheduled original as a failure", () => {
    const sessions = [
      { status: "RESCHEDULED", date: "2026-10-20", startMinutes: 600, durationMinutes: 60 },
      { status: "COMPLETED", date: "2026-10-20", startMinutes: 900, durationMinutes: 60 },
    ];
    expect(completionPercent(sessions, now)).toBe(100);
  });
});

describe("repeat rules", () => {
  it("maps a repeat mode to the days it covers", () => {
    expect(repeatDays("WEEKLY", 2)).toEqual([2]);
    expect(repeatDays("CUSTOM", 2, [5, 1, 5, 7, -1])).toEqual([1, 5]);
    expect(repeatDays("NONE", 2, [1, 2])).toEqual([]);
  });

  it("labels a repeat in the words the user chose", () => {
    expect(repeatLabel("WEEKLY", [1])).toBe("Every Monday");
    expect(repeatLabel("WEEKLY", [0])).toBe("Every Sunday");
    expect(repeatLabel("CUSTOM", [1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(repeatLabel("CUSTOM", [])).toBe("Custom days");
    expect(repeatLabel("CUSTOM", [0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(repeatLabel("NONE", [])).toBe("Does not repeat");
  });
});

describe("resolveStudyDuration", () => {
  it("prefers an explicit end time", () => {
    expect(resolveStudyDuration(600, 30, 660)).toEqual({ durationMinutes: 60 });
  });

  it("falls back to the duration when no end is sent", () => {
    expect(resolveStudyDuration(600, 45, undefined)).toEqual({ durationMinutes: 45 });
  });

  it("reports the field that was wrong", () => {
    expect(resolveStudyDuration(600, 0, 600)).toEqual({
      error: "The end time has to be after the start time",
      field: "endMinutes",
    });
    expect(resolveStudyDuration(1400, 60, undefined)).toEqual({
      error: "A session cannot run past midnight",
      field: "durationMinutes",
    });
    expect(resolveStudyDuration(600, undefined, undefined)).toEqual({
      error: "A session needs a length",
      field: "durationMinutes",
    });
  });
});

describe("habit rules", () => {
  it("collapses a boolean habit to one", () => {
    expect(habitCompletion("BOOLEAN", 45, 0)).toEqual({ value: 1, completed: true });
    expect(habitCompletion("BOOLEAN", 0, 0)).toEqual({ value: 0, completed: false });
  });

  it("completes a measured habit at its target", () => {
    expect(habitCompletion("DURATION", 45, 45)).toEqual({ value: 45, completed: true });
    expect(habitCompletion("DURATION", 44, 45)).toEqual({ value: 44, completed: false });
  });

  it("treats a non-positive target as one so the habit is completable", () => {
    expect(habitCompletion("COUNT", 1, 0)).toEqual({ value: 1, completed: true });
  });
});

describe("elapsedFocusSeconds", () => {
  const at = (iso: string) => new Date(iso);

  it("measures an unpaused session from server-stamped instants", () => {
    expect(
      elapsedFocusSeconds(
        {
          startedAt: at("2026-10-21T10:00:00.000Z"),
          pausedSeconds: 0,
          pausedAt: null,
        },
        at("2026-10-21T10:10:00.000Z"),
      ),
    ).toBe(600);
  });

  it("excludes a pause that is still in progress", () => {
    expect(
      elapsedFocusSeconds(
        {
          startedAt: at("2026-10-21T10:00:00.000Z"),
          pausedSeconds: 0,
          pausedAt: at("2026-10-21T10:10:00.000Z"),
        },
        at("2026-10-21T10:20:00.000Z"),
      ),
    ).toBe(600);
  });

  it("excludes pauses that already ended", () => {
    expect(
      elapsedFocusSeconds(
        {
          startedAt: at("2026-10-21T10:00:00.000Z"),
          pausedSeconds: 300,
          pausedAt: null,
        },
        at("2026-10-21T10:15:00.000Z"),
      ),
    ).toBe(600);
  });

  it("never goes negative", () => {
    expect(
      elapsedFocusSeconds(
        {
          startedAt: at("2026-10-21T10:00:00.000Z"),
          pausedSeconds: 900,
          pausedAt: null,
        },
        at("2026-10-21T10:05:00.000Z"),
      ),
    ).toBe(0);
  });
});
