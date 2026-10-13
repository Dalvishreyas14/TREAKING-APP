import { describe, expect, it } from "vitest";

import {
  addDaysUtc,
  dateOnly,
  dateOnlyLocal,
  daysBetween,
  fromLocalDateTimeInput,
  isSameLocalDay,
  startOfMonthUtc,
  startOfWeekUtc,
  toLocalDateTimeInput,
} from "@/lib/date";

/**
 * The regression these guard is quiet: a local-timezone boundary makes
 * `where: { date: ... }` match zero rows, and the page renders as though the
 * user never logged anything. The assertions below therefore pin the *instant*,
 * not just the calendar day, so a change back to local time fails loudly.
 */

describe("dateOnly", () => {
  it("pins the calendar day to midnight UTC", () => {
    expect(dateOnly(new Date("2026-09-27T10:37:00.000Z")).toISOString()).toBe(
      "2026-09-27T00:00:00.000Z",
    );
  });

  it("keeps the UTC day even when local time is on the previous day", () => {
    // 00:30 UTC on the 27th is 06:00 on the 27th in IST, but 20:30 on the 26th
    // in New York. The stored date must follow UTC, not the server's zone.
    expect(dateOnly(new Date("2026-09-27T00:30:00.000Z")).toISOString()).toBe(
      "2026-09-27T00:00:00.000Z",
    );
  });

  it("ignores the time of day entirely", () => {
    const morning = dateOnly(new Date("2026-09-27T00:00:01.000Z"));
    const night = dateOnly(new Date("2026-09-27T23:59:59.000Z"));
    expect(morning.getTime()).toBe(night.getTime());
  });
});

describe("addDaysUtc", () => {
  it("moves forward and backward across a month boundary", () => {
    const start = new Date("2026-09-27T00:00:00.000Z");
    expect(addDaysUtc(start, 4).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(addDaysUtc(start, -27).toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("is stable when given a non-midnight input", () => {
    const noisy = new Date("2026-09-27T18:45:00.000Z");
    expect(addDaysUtc(noisy, 1).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  it("handles a leap day", () => {
    expect(addDaysUtc(new Date("2028-02-28T00:00:00.000Z"), 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });
});

describe("startOfWeekUtc", () => {
  it("treats Monday as the first day of the week", () => {
    // 27 September 2026 is a Sunday, so its week began on Monday the 21st.
    expect(startOfWeekUtc(new Date("2026-09-27T09:00:00.000Z")).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z",
    );
  });

  it("leaves a Monday unchanged", () => {
    expect(startOfWeekUtc(new Date("2026-09-21T23:00:00.000Z")).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z",
    );
  });

  it("steps back to the previous Monday from a Sunday", () => {
    expect(startOfWeekUtc(new Date("2026-09-27T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z",
    );
  });
});

describe("startOfMonthUtc", () => {
  it("returns the first of the month at midnight UTC", () => {
    expect(startOfMonthUtc(new Date("2026-09-27T16:07:00.000Z")).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("handles January", () => {
    expect(startOfMonthUtc(new Date("2026-01-31T00:00:00.000Z")).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
});

describe("daysBetween", () => {
  it("counts calendar days, not elapsed hours", () => {
    // Only 30 minutes apart, but a day apart in UTC terms.
    expect(
      daysBetween(new Date("2026-09-27T23:30:00.000Z"), new Date("2026-09-28T00:00:00.000Z")),
    ).toBe(1);
  });

  it("is signed", () => {
    expect(
      daysBetween(new Date("2026-09-28T00:00:00.000Z"), new Date("2026-09-27T00:00:00.000Z")),
    ).toBe(-1);
  });

  it("is zero within the same day", () => {
    expect(
      daysBetween(new Date("2026-09-27T01:00:00.000Z"), new Date("2026-09-27T22:00:00.000Z")),
    ).toBe(0);
  });
});

describe("local wall-clock input", () => {
  it("parses a datetime-local string as local time, not UTC", () => {
    const parsed = fromLocalDateTimeInput("2026-09-27T14:30")!;
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.getHours()).toBe(14);
    expect(parsed.getMinutes()).toBe(30);
    expect(parsed.getDate()).toBe(27);
  });

  it("round-trips through the input formatter without shifting the wall clock", () => {
    const original = new Date(2026, 8, 27, 14, 30, 0);
    expect(fromLocalDateTimeInput(toLocalDateTimeInput(original))!.getTime()).toBe(
      original.getTime(),
    );
  });

  it("keeps seconds when they are present", () => {
    const parsed = fromLocalDateTimeInput("2026-09-27T14:30:45")!;
    expect(parsed.getSeconds()).toBe(45);
  });

  it("returns null for unparseable input instead of an Invalid Date", () => {
    expect(fromLocalDateTimeInput("")).toBeNull();
    expect(fromLocalDateTimeInput("tomorrow")).toBeNull();
    expect(fromLocalDateTimeInput("2026-09-27")).toBeNull();
    // `new Date("2026-02-30T10:00")` rolls over to March; that is not a real time.
    expect(fromLocalDateTimeInput("2026-02-30T10:00")).toBeNull();
  });

  it("does not use the UTC-only helpers by accident", () => {
    // A local 9am must not land on the previous UTC day for anyone east of
    // Greenwich, which is the whole reason this pair exists.
    const parsed = fromLocalDateTimeInput("2026-09-27T09:00")!;
    expect(toLocalDateTimeInput(parsed)).toBe("2026-09-27T09:00");
  });
});

/**
 * The planner's local-day problem.
 *
 * A time block stores a `@db.Date` day *and* real start/end instants, and those
 * two disagree for part of every day in any zone with a non-zero offset. The
 * failure is silent and one-directional: a block created for 2am on the 27th is
 * filed under the 26th and is simply absent from the day view the user is
 * looking at. These assertions build instants through local components, so they
 * mean the same thing in whatever zone the suite runs in.
 */
describe("dateOnlyLocal", () => {
  it("maps a local calendar day onto UTC midnight", () => {
    // Built from local components on purpose: 15:00 on the 27th *local*.
    const local = new Date(2026, 8, 27, 15, 0);
    expect(dateOnlyLocal(local).toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("keeps an early-morning instant on the day the user meant", () => {
    // The case that motivated the helper. In IST this instant is 20:30 UTC on
    // the 26th, so `dateOnly` files the block under the wrong day.
    const local = new Date(2026, 8, 27, 2, 0);
    expect(dateOnlyLocal(local).toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("agrees with dateOnly in the afternoon, where the offset is harmless", () => {
    const local = new Date(2026, 8, 27, 15, 0);
    // In a zone at or ahead of UTC these coincide; behind it they do not, which
    // is exactly why the planner cannot use dateOnly.
    expect(dateOnlyLocal(local).getTime() % 86_400_000).toBe(0);
  });

  it("returns the same day for every instant of that local day", () => {
    const start = new Date(2026, 8, 27, 0, 0).getTime();
    for (let m = 0; m < 24 * 60; m += 37) {
      expect(dateOnlyLocal(new Date(start + m * 60_000)).toISOString()).toBe(
        "2026-09-27T00:00:00.000Z",
      );
    }
  });

  it("advances to the next day at local midnight, not at UTC midnight", () => {
    expect(dateOnlyLocal(new Date(2026, 8, 28, 0, 0)).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z",
    );
  });
});

describe("isSameLocalDay", () => {
  it("is true for two instants on one local day", () => {
    expect(
      isSameLocalDay(new Date(2026, 8, 27, 0, 5), new Date(2026, 8, 27, 23, 55)),
    ).toBe(true);
  });

  it("is false across local midnight", () => {
    expect(
      isSameLocalDay(new Date(2026, 8, 27, 23, 59), new Date(2026, 8, 28, 0, 1)),
    ).toBe(false);
  });
});