import { describe, expect, it } from "vitest";

import {
  advance,
  describeRecurrence,
  isDue,
  nextFutureOccurrence,
  nextOccurrence,
  parseRecurrence,
} from "@/lib/notifications/recurrence";

/**
 * Reminder scheduling is the part of S9 that can quietly be wrong in a way no
 * screenshot would catch: a daily reminder drifting an hour at every DST
 * boundary, a monthly one landing in March because February had fewer days, and
 * a repeat that fires thirty times because a month went unread. These are all
 * date arithmetic, so they are tested as date arithmetic.
 */

const at = (y: number, m: number, d: number, h = 0, min = 0, sec = 0) =>
  new Date(y, m - 1, d, h, min, sec, 0);

describe("parseRecurrence", () => {
  it("returns null for absent and malformed values", () => {
    expect(parseRecurrence(null)).toBeNull();
    expect(parseRecurrence(undefined)).toBeNull();
    expect(parseRecurrence("daily")).toBeNull();
    expect(parseRecurrence([1, 2])).toBeNull();
    expect(parseRecurrence({ freq: "HOURLY" })).toBeNull();
    expect(parseRecurrence({ freq: "DAILY", interval: 0 })).toBeNull();
    expect(parseRecurrence({ freq: "DAILY", interval: 1.5 })).toBeNull();
    expect(parseRecurrence({ freq: "DAILY", interval: -2 })).toBeNull();
  });

  it("defaults a missing interval to 1", () => {
    expect(parseRecurrence({ freq: "WEEKLY" })).toEqual({ freq: "WEEKLY", interval: 1 });
  });

  it("rejects an interval so large the scan would be unbounded", () => {
    expect(parseRecurrence({ freq: "DAILY", interval: 100_000 })).toBeNull();
  });

  it("keeps only valid weekdays, sorted and deduplicated", () => {
    expect(parseRecurrence({ freq: "WEEKLY", byWeekday: [3, 1, 3, 9, -1] })).toEqual({
      freq: "WEEKLY",
      interval: 1,
      byWeekday: [1, 3],
    });
  });

  it("drops byWeekday for non-weekly rules, which cannot use it", () => {
    expect(parseRecurrence({ freq: "DAILY", byWeekday: [1] })).toEqual({ freq: "DAILY", interval: 1 });
  });
});

describe("nextOccurrence", () => {
  it("advances daily by its interval", () => {
    expect(nextOccurrence({ freq: "DAILY", interval: 1 }, at(2026, 3, 1, 7))).toEqual(at(2026, 3, 2, 7));
    expect(nextOccurrence({ freq: "DAILY", interval: 3 }, at(2026, 3, 1, 7))).toEqual(at(2026, 3, 4, 7));
  });

  it("advances weekly to the same weekday", () => {
    // 2026-03-01 is a Sunday.
    expect(nextOccurrence({ freq: "WEEKLY", interval: 1 }, at(2026, 3, 1, 9))).toEqual(at(2026, 3, 8, 9));
    expect(nextOccurrence({ freq: "WEEKLY", interval: 2 }, at(2026, 3, 1, 9))).toEqual(at(2026, 3, 15, 9));
  });

  it("honours an explicit weekday set", () => {
    // Sunday + Mon/Wed/Fri lands on the following Monday, not day 2.
    const next = nextOccurrence({ freq: "WEEKLY", interval: 1, byWeekday: [1, 3, 5] }, at(2026, 3, 1, 9));
    expect(next).toEqual(at(2026, 3, 2, 9));
  });

  it("jumps a full interval week when the weekday lands inside it", () => {
    // Biweekly on Monday, anchored on Sunday 2026-03-01. The Monday on 03-02 is
    // only a day away but sits in week 0, which is not a valid block for an
    // every-other-week rule, so the next one is the Monday of week 2.
    const next = nextOccurrence({ freq: "WEEKLY", interval: 2, byWeekday: [1] }, at(2026, 3, 1, 9))!;
    expect(next.getDay()).toBe(1);
    expect(next).toEqual(at(2026, 3, 16, 9));
  });

  it("keeps a multi-weekday rule inside the same week", () => {
    // A weekly Mon/Wed/Fri rule must be able to fire again later this week
    // rather than being pushed a whole week out.
    const monday = at(2026, 3, 2, 9);
    expect(nextOccurrence({ freq: "WEEKLY", interval: 1, byWeekday: [1, 3, 5] }, monday)).toEqual(
      at(2026, 3, 4, 9),
    );
  });

  it("clamps monthly to the last day instead of overflowing into the next month", () => {
    // 31 January + 1 month is 28 February in 2026, not 2 or 3 March.
    expect(nextOccurrence({ freq: "MONTHLY", interval: 1 }, at(2026, 1, 31, 8))).toEqual(at(2026, 2, 28, 8));
    expect(nextOccurrence({ freq: "MONTHLY", interval: 1 }, at(2026, 3, 31, 8))).toEqual(at(2026, 4, 30, 8));
  });

  it("handles a leap-year February", () => {
    expect(nextOccurrence({ freq: "MONTHLY", interval: 1 }, at(2028, 1, 31, 8))).toEqual(at(2028, 2, 29, 8));
  });

  it("rolls the year over on a monthly interval", () => {
    expect(nextOccurrence({ freq: "MONTHLY", interval: 3 }, at(2026, 11, 15, 6))).toEqual(at(2027, 2, 15, 6));
  });

  it("keeps the local time of day across a spring-forward boundary", () => {
    // US DST starts 2026-03-08. A 07:00 daily reminder must still be 07:00 after
    // the clocks jump, which is the whole reason this works in local time.
    const first = at(2026, 3, 7, 7);
    const next = nextOccurrence({ freq: "DAILY", interval: 1 }, first)!;
    expect(next.getHours()).toBe(7);
    expect(next.getDate()).toBe(8);
  });

  it("keeps the local time of day across a fall-back boundary", () => {
    // US DST ends 2026-11-01.
    const next = nextOccurrence({ freq: "DAILY", interval: 1 }, at(2026, 10, 31, 7))!;
    expect(next.getHours()).toBe(7);
    expect(next.getDate()).toBe(1);
  });

  it("zeroes seconds and milliseconds so a reschedule is reproducible", () => {
    const messy = new Date(2026, 2, 1, 7, 30, 45, 123);
    const next = nextOccurrence({ freq: "DAILY", interval: 1 }, messy)!;
    expect(next.getSeconds()).toBe(0);
    expect(next.getMilliseconds()).toBe(0);
  });
});

describe("nextFutureOccurrence", () => {
  it("skips a long-missed run and lands on the next future slot", () => {
    // A daily reminder last scheduled a month ago must not replay 30 times.
    const now = at(2026, 3, 31, 12);
    const next = nextFutureOccurrence({ freq: "DAILY", interval: 1 }, at(2026, 3, 1, 7), now)!;
    expect(next).toEqual(at(2026, 4, 1, 7));
  });

  it("keeps the reminder's own time of day, not the time it was read", () => {
    // The bug this guards: anchoring on `now` turned a 07:00 reminder into a
    // 12:00 one the first time it was opened late in the day.
    const next = nextFutureOccurrence({ freq: "DAILY", interval: 1 }, at(2026, 3, 9, 7), at(2026, 3, 10, 12))!;
    expect(next).toEqual(at(2026, 3, 11, 7));
  });

  it("keeps the day-of-month alignment of a monthly rule", () => {
    // Read on the 14th, the 15th rule must still fire on the 15th.
    const next = nextFutureOccurrence(
      { freq: "MONTHLY", interval: 1 },
      at(2026, 3, 15, 6),
      at(2026, 3, 20, 18),
    )!;
    expect(next).toEqual(at(2026, 4, 15, 6));
  });

  it("still respects a two-week interval when skipping missed runs", () => {
    const next = nextFutureOccurrence(
      { freq: "WEEKLY", interval: 2, byWeekday: [1] },
      at(2026, 3, 2, 9),
      at(2026, 4, 2, 9),
    )!;
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(9);
    expect(next.getTime()).toBeGreaterThan(at(2026, 4, 2, 9).getTime());
  });

  it("leaves an un-fired reminder on its own slot", () => {
    // Only ever called once the reminder is due, so `now` is normally past
    // `scheduledFor`. The guard is here so a clock skew or a manual call cannot
    // push a reminder into the future before it has ever been delivered.
    const scheduled = at(2026, 3, 1, 7);
    expect(nextFutureOccurrence({ freq: "DAILY", interval: 1 }, scheduled, at(2026, 2, 28))).toEqual(
      scheduled,
    );
  });
});

describe("isDue", () => {
  const base = { enabled: true, scheduledFor: at(2026, 3, 1, 7), lastSentAt: null };

  it("fires a never-sent reminder whose time has passed", () => {
    expect(isDue(base, at(2026, 3, 1, 7, 1))).toBe(true);
  });

  it("does not fire before its time", () => {
    expect(isDue(base, at(2026, 3, 1, 6, 59))).toBe(false);
  });

  it("does not fire a disabled reminder even when overdue", () => {
    expect(isDue({ ...base, enabled: false }, at(2026, 3, 5))).toBe(false);
  });

  it("does not fire twice for the same occurrence", () => {
    const sent = { ...base, lastSentAt: at(2026, 3, 1, 7, 0, 5) };
    expect(isDue(sent, at(2026, 3, 1, 8))).toBe(false);
  });

  it("fires again once the next occurrence is scheduled", () => {
    const second = { ...base, scheduledFor: at(2026, 3, 8, 7), lastSentAt: at(2026, 3, 1, 7) };
    expect(isDue(second, at(2026, 3, 8, 7, 1))).toBe(true);
  });

  it("is idempotent at the exact scheduled instant", () => {
    // The boundary matters: sent at the same millisecond as the slot must count
    // as delivered, or a poll on the boundary re-sends forever.
    const same = { ...base, lastSentAt: base.scheduledFor };
    expect(isDue(same, at(2026, 3, 1, 7))).toBe(false);
  });
});

describe("advance", () => {
  const now = at(2026, 3, 10, 12);

  it("reschedules a repeating reminder to its next future slot", () => {
    const out = advance(at(2026, 3, 9, 7), { freq: "DAILY", interval: 1 }, now);
    expect(out.scheduledFor).toEqual(at(2026, 3, 11, 7));
    expect(out.enabled).toBe(true);
    expect(out.sentAt).toBeNull();
    expect(out.lastSentAt).toEqual(now);
  });

  it("disables a one-shot reminder after delivering it", () => {
    const out = advance(at(2026, 3, 9, 7), null, now);
    expect(out.enabled).toBe(false);
    expect(out.sentAt).toEqual(now);
    expect(out.scheduledFor).toEqual(at(2026, 3, 9, 7));
  });

  it("disables a repeating reminder whose rule cannot be parsed", () => {
    // Degrading to "fires once, then stops" beats silently never firing again.
    const out = advance(at(2026, 3, 9, 7), { freq: "NONSENSE" }, now);
    expect(out.enabled).toBe(false);
    expect(out.sentAt).toEqual(now);
  });

  it("makes a delivered reminder not due again immediately", () => {
    const before = { enabled: true, scheduledFor: at(2026, 3, 9, 7), lastSentAt: null };
    expect(isDue(before, now)).toBe(true);
    const out = advance(before.scheduledFor, { freq: "DAILY", interval: 1 }, now);
    expect(isDue({ ...before, ...out }, now)).toBe(false);
  });
});

describe("describeRecurrence", () => {
  it("describes one-shots and simple repeats", () => {
    expect(describeRecurrence(null)).toBe("Once");
    expect(describeRecurrence({ freq: "DAILY", interval: 1 })).toBe("Daily");
    expect(describeRecurrence({ freq: "WEEKLY", interval: 1 })).toBe("Weekly");
    expect(describeRecurrence({ freq: "MONTHLY", interval: 1 })).toBe("Monthly");
  });

  it("describes multi-day intervals", () => {
    expect(describeRecurrence({ freq: "DAILY", interval: 3 })).toBe("Every 3 days");
    expect(describeRecurrence({ freq: "MONTHLY", interval: 2 })).toBe("Every 2 months");
  });

  it("names the weekdays of a weekly rule", () => {
    expect(describeRecurrence({ freq: "WEEKLY", interval: 1, byWeekday: [1, 3, 5] })).toBe("Mon, Wed, Fri");
  });

  it("says 'Every day' rather than listing all seven", () => {
    expect(describeRecurrence({ freq: "WEEKLY", byWeekday: [0, 1, 2, 3, 4, 5, 6] })).toBe("Every day");
  });
});
