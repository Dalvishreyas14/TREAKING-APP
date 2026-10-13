import { afterAll, describe, expect, it } from "vitest";

import {
  formatDayMonth,
  formatIndianDate,
  formatIndianLong,
  formatIndianMedium,
  formatIndianShort,
  formatLocalClock24,
  formatLocalClockTime,
  formatLocalDayMonth,
  formatLocalWeekdayClock,
  formatWeekdayLong,
  formatWeekdayShort,
  indianWeek,
} from "@/lib/format/date";

/**
 * Indian date presentation.
 *
 * The tests pin the *format*, not the value. `27/09/2026` is only correct if the
 * day comes before the month — a regression to `MM/dd/yyyy` would still produce
 * a plausible-looking string for most of the year, which is precisely why it
 * needs a fixed assertion rather than a snapshot.
 */

const SUNDAY = new Date("2026-09-27T00:00:00.000Z");
const MONDAY = new Date("2026-09-28T00:00:00.000Z");

describe("formatIndianDate", () => {
  it("puts the day before the month", () => {
    expect(formatIndianDate(SUNDAY)).toBe("27/09/2026");
  });

  it("zero-pads single digits on both sides", () => {
    expect(formatIndianDate(new Date("2026-01-05T00:00:00.000Z"))).toBe("05/01/2026");
  });

  it("is unambiguous for a date that MM/dd/yyyy would mangle", () => {
    // 09/27 in en-US means 27 September; 27/09 in en-US would be invalid.
    expect(formatIndianDate(SUNDAY)).not.toBe("09/27/2026");
  });

  it("ignores the time of day", () => {
    expect(formatIndianDate(new Date("2026-09-27T23:59:59.000Z"))).toBe("27/09/2026");
  });

  /**
   * The regression this guards is invisible from an IST machine, which is most
   * of the bug's danger. `date-fns` `format` reads local fields, and a UTC
   * midnight is the *previous* day in every zone west of UTC — so on a server in
   * `America/New_York` a strip cell built from UTC midnight rendered
   * `26/09/2026`, and the dashboard showed the 26th's data labelled the 27th.
   *
   * The suite runs in whatever zone the machine is set to, so this assertion is
   * written to hold either way: it checks the formatted output matches the UTC
   * fields of the input, which is the actual contract. Run in IST it passes
   * trivially; run in New York it is the test that fails.
   */
  it("renders the UTC calendar day, not the server-local one", () => {
    const utcMidnight = new Date("2026-09-27T00:00:00.000Z");
    expect(formatIndianDate(utcMidnight)).toBe(
      `${String(utcMidnight.getUTCDate()).padStart(2, "0")}/` +
        `${String(utcMidnight.getUTCMonth() + 1).padStart(2, "0")}/` +
        `${utcMidnight.getUTCFullYear()}`,
    );
  });

  it("does not roll a UTC midnight back a day west of Greenwich", () => {
    // A UTC midnight in a UTC-4 zone is 20:00 on the 26th locally. If the
    // formatter were local-time, this is the assertion that catches it.
    const utcMidnight = new Date("2026-09-27T00:00:00.000Z");
    const localDay = utcMidnight.getDate();
    const renderedDay = Number(formatIndianDate(utcMidnight).slice(0, 2));
    if (localDay !== utcMidnight.getUTCDate()) {
      expect(renderedDay).toBe(utcMidnight.getUTCDate());
    } else {
      expect(renderedDay).toBe(localDay);
    }
  });
});

describe("formatIndianLong", () => {
  it("reads as spoken English with the year", () => {
    expect(formatIndianLong(SUNDAY)).toBe("Sunday, 27 September 2026");
  });

  it("handles a month boundary", () => {
    expect(formatIndianLong(new Date("2026-10-01T00:00:00.000Z"))).toBe(
      "Thursday, 1 October 2026",
    );
  });
});

describe("formatIndianMedium and formatIndianShort", () => {
  it("keeps the numeric day-first ordering in the short form", () => {
    expect(formatIndianShort(SUNDAY)).toBe("27/09");
  });

  it("abbreviates the month in the medium form", () => {
    expect(formatIndianMedium(SUNDAY)).toBe("27 Sep 2026");
  });
});

describe("formatWeekdayShort", () => {
  it("returns a three-letter English weekday", () => {
    expect(formatWeekdayShort(SUNDAY)).toBe("Sun");
    expect(formatWeekdayShort(MONDAY)).toBe("Mon");
  });
});

describe("indianWeek", () => {
  it("returns seven days", () => {
    expect(indianWeek(SUNDAY)).toHaveLength(7);
  });

  it("starts on Sunday, not Monday", () => {
    // The whole point of the convention: date-fns and ISO both start on Monday,
    // so this asserts Sunday deliberately rather than by accident.
    expect(formatWeekdayShort(indianWeek(SUNDAY)[0]!)).toBe("Sun");
    expect(indianWeek(SUNDAY)[0]!.getTime()).toBe(SUNDAY.getTime());
  });

  it("walks back to the containing Sunday for a mid-week anchor", () => {
    // 30 September 2026 is a Wednesday; the week runs 27 Sep - 3 Oct.
    const wednesday = new Date("2026-09-30T00:00:00.000Z");
    const week = indianWeek(wednesday);
    expect(week[0]!.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(week[6]!.toISOString()).toBe("2026-10-03T00:00:00.000Z");
  });

  it("is exactly seven days apart with no gaps or repeats", () => {
    const week = indianWeek(MONDAY);
    for (let i = 1; i < week.length; i += 1) {
      const gap = week[i]!.getTime() - week[i - 1]!.getTime();
      expect(gap).toBe(86_400_000);
    }
  });

  it("returns UTC midnights, matching how `@db.Date` is stored", () => {
    // A strip cell labelled 27 must be showing the 27th's logs, so every day it
    // produces has to be the exact form the queries compare against.
    for (const day of indianWeek(SUNDAY)) {
      expect(day.toISOString()).toMatch(/T00:00:00\.000Z$/);
    }
  });

  it("spans a month boundary without losing a day", () => {
    const lastDayOfMonth = new Date("2026-09-30T00:00:00.000Z");
    const week = indianWeek(lastDayOfMonth);
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.getUTCDate())).toEqual([27, 28, 29, 30, 1, 2, 3]);
  });

  it("spans a leap day without losing a day", () => {
    // 2028-02-29 exists; a naive 30-day shortcut would skip it.
    const leapDay = new Date("2028-02-29T00:00:00.000Z");
    const week = indianWeek(leapDay);
    expect(week.some((d) => d.getUTCDate() === 29 && d.getUTCMonth() === 1)).toBe(true);
    expect(week).toHaveLength(7);
  });
});

/**
 * The invariant the dashboard depends on.
 *
 * The first version of the week strip derived its window two different ways: the
 * server queried "the last seven days ending today" while the component
 * re-anchored a Sunday-first week on the first of those days. On a Wednesday that
 * silently pushed every cell back three days and dropped today off the end. On
 * the Sunday this was found on, the strip was rendering the *previous* week
 * entirely and today's data appeared nowhere.
 *
 * Checking a whole year catches every weekday, not just the one the machine
 * happened to be on when the bug was written.
 */
describe("week strip window alignment", () => {
  const WEEK_MS = 86_400_000;

  it("starts on Sunday and contains the anchor for every day of a year", () => {
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 365; i += 1) {
      const anchor = new Date(start + i * WEEK_MS);
      const week = indianWeek(anchor);

      expect(week[0]!.getUTCDay(), `start day for ${anchor.toISOString()}`).toBe(0);
      expect(week).toHaveLength(7);
      expect(
        week.some((d) => d.getTime() === anchor.getTime()),
        `anchor ${anchor.toISOString()} missing from its own week`,
      ).toBe(true);
    }
  });

  it("never renders a window more than six days behind the anchor", () => {
    // The exact failure: strip showed 20/09-26/09 while today was the 27th.
    const anchor = new Date("2026-09-27T00:00:00.000Z");
    const week = indianWeek(anchor);
    expect((anchor.getTime() - week[0]!.getTime()) / WEEK_MS).toBe(0);
    expect(formatIndianShort(week[0]!)).toBe("27/09");
  });

  it("keeps a mid-week anchor inside the window it queries", () => {
    // The second failure mode: a rolling seven-day window on a Wednesday starts
    // on the previous Sunday, but re-anchoring pushes the start to the Sunday
    // *before* that, so the strip and the query disagree by a whole week.
    const wednesday = new Date("2026-09-30T00:00:00.000Z");
    const week = indianWeek(wednesday);
    expect(formatIndianShort(week[0]!)).toBe("27/09");
    expect(formatIndianShort(week[6]!)).toBe("03/10");
  });
});

/**
 * Locale independence.
 *
 * The bug these lock down: a due-date badge built with
 * `toLocaleDateString(undefined, ...)` rendered `12 Oct` on the Node server and
 * `Oct 12` in the browser, and React threw a hydration mismatch that discarded
 * the whole `/tasks` tree on the client. An explicit pattern cannot drift with
 * the host's ICU build, so these assertions hold no matter what locale the
 * server or the reader's browser happens to default to.
 */
const REAL_INSTANT = new Date(2026, 9, 12, 16, 5, 0);

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("local formatters are locale independent", () => {
  it("renders a day and month as day-first regardless of the default locale", () => {
    for (const locale of ["en-US", "en-GB", "de-DE", "ja-JP", "en-IN"]) {
      expect(formatLocalDayMonth(REAL_INSTANT), `locale ${locale}`).toBe("12 Oct");
    }
  });

  it("never reorders to month-first, whatever the ambient locale is", () => {
    // The exact hydration diff that was reported: "Oct 12" vs "12 Oct".
    expect(formatLocalDayMonth(REAL_INSTANT)).not.toBe("Oct 12");
    expect(formatLocalDayMonth(REAL_INSTANT)).not.toMatch(/^[A-Z][a-z]{2} /);
  });

  it("renders clock times from local fields, not from a locale's own clock format", () => {
    expect(formatLocalClockTime(REAL_INSTANT)).toBe("4:05 PM");
    expect(formatLocalClock24(REAL_INSTANT)).toBe("16:05");
    expect(formatLocalWeekdayClock(REAL_INSTANT)).toBe("Mon 4:05 PM");
  });

  it("reads the UTC calendar day for the @db.Date formatters", () => {
    // A `@db.Date` value is UTC midnight. Formatting its *local* fields shows the
    // previous day for any reader west of Greenwich, which is the off-by-one the
    // utcFormat shift exists to prevent.
    const utcMidnight = new Date("2026-10-12T00:00:00.000Z");
    expect(formatDayMonth(utcMidnight)).toBe("12 Oct");
    expect(formatWeekdayLong(utcMidnight)).toBe("Monday, 12 October");
  });

  it("keeps the UTC and local day families distinct for the same instant", () => {
    // A UTC-midnight `@db.Date` and a real instant are formatted on purpose by
    // different helpers. The distinction has to stay visible or a milestone
    // target silently shifts by a day for half the planet.
    const utcMidnight = new Date("2026-10-12T00:00:00.000Z");
    expect(formatIndianMedium(utcMidnight)).toBe("12 Oct 2026");
    expect(formatIndianDate(utcMidnight)).toBe("12/10/2026");
  });
});
