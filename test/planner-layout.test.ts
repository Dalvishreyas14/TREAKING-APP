import { describe, expect, it } from "vitest";

import {
  DAY_START_MINUTES,
  MAX_BLOCK_MINUTES,
  MIN_BLOCK_MINUTES,
  dayTotals,
  findConflict,
  findFreeSlots,
firstFreeSlot,
  formatClock,
  formatDuration,
  fromTimeValue,
  layoutColumns,
  minutesFromMidnight,
  overlaps,
  snapToQuarter,
  toTimeValue,
  WORKDAY_START_MINUTES,
} from "@/lib/planner/layout";

/**
 * Planner geometry.
 *
 * The overlap rules get the most attention here because they are the part a user
 * notices immediately when it is wrong: a planner that refuses to save two
 * back-to-back blocks looks broken, and one that lets a real clash through
 * quietly double-books the day.
 */

describe("overlaps", () => {
  const block = (startMinutes: number, endMinutes: number) => ({ startMinutes, endMinutes });

  it("detects a genuine clash", () => {
    expect(overlaps(block(540, 600), block(570, 630))).toBe(true);
  });

  it("treats touching blocks as free, which is what makes a full day schedulable", () => {
    // Half-open intervals. If this returned true, a day of consecutive meetings
    // could not be saved at all.
    expect(overlaps(block(540, 600), block(600, 660))).toBe(false);
    expect(overlaps(block(600, 660), block(540, 600))).toBe(false);
  });

  it("detects full containment in both directions", () => {
    expect(overlaps(block(540, 660), block(570, 600))).toBe(true);
    expect(overlaps(block(570, 600), block(540, 660))).toBe(true);
  });

  it("detects an identical range as a clash with itself", () => {
    expect(overlaps(block(540, 600), block(540, 600))).toBe(true);
  });

  it("ignores a zero-length block", () => {
    // Nothing can overlap a block with no duration; without this an empty block
    // would block an entire day.
    expect(overlaps(block(540, 540), block(530, 600))).toBe(false);
  });

  it("is symmetric", () => {
    const a = block(500, 560);
    const b = block(540, 620);
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });
});

describe("findConflict", () => {
  const blocks = [
    { id: "a", startMinutes: 540, endMinutes: 600 },
    { id: "b", startMinutes: 660, endMinutes: 720 },
  ];

  it("finds the first clashing block", () => {
    expect(findConflict({ startMinutes: 570, endMinutes: 630 }, blocks)?.id).toBe("a");
  });

  it("returns nothing for a free slot", () => {
    expect(findConflict({ startMinutes: 600, endMinutes: 660 }, blocks)).toBeUndefined();
  });

  it("ignores the block being edited", () => {
    // Moving "a" later must not collide with its own previous position.
    expect(findConflict({ startMinutes: 600, endMinutes: 660 }, blocks, "a")).toBeUndefined();
  });
});

describe("layoutColumns", () => {
  it("gives a lone block the full width", () => {
    const result = layoutColumns([{ id: "a", startMinutes: 540, endMinutes: 600 }]);
    const pos = result.get("a")!;
    expect(pos.column).toBe(0);
    expect(pos.columnCount).toBe(1);
  });

  it("splits two overlapping blocks into two columns", () => {
    const result = layoutColumns([
      { id: "a", startMinutes: 540, endMinutes: 630 },
      { id: "b", startMinutes: 570, endMinutes: 660 },
    ]);
    expect(result.get("a")!.columnCount).toBe(2);
    expect(result.get("b")!.columnCount).toBe(2);
    expect(result.get("a")!.column).not.toBe(result.get("b")!.column);
  });

  it("packs three mutually overlapping blocks into three columns", () => {
    const result = layoutColumns([
      { id: "a", startMinutes: 540, endMinutes: 700 },
      { id: "b", startMinutes: 550, endMinutes: 700 },
      { id: "c", startMinutes: 560, endMinutes: 700 },
    ]);
    expect([...result.values()].map((p) => p.columnCount)).toEqual([3, 3, 3]);
    expect([...result.values()].map((p) => p.column).sort()).toEqual([0, 1, 2]);
  });

  it("reuses a column once the previous block has ended", () => {
    // 09:00-10:00, then 10:00-11:00 reuses column 0 rather than widening the
    // day, which is the back-to-back case.
    const result = layoutColumns([
      { id: "a", startMinutes: 540, endMinutes: 600 },
      { id: "b", startMinutes: 600, endMinutes: 660 },
    ]);
    expect(result.get("a")).toMatchObject({ column: 0, columnCount: 1 });
    expect(result.get("b")).toMatchObject({ column: 0, columnCount: 1 });
  });

  it("handles a chain where a overlaps b and b overlaps c but a does not overlap c", () => {
    // a 09:00-10:20, b 10:00-11:20, c 11:00-12:00.
    const result = layoutColumns([
      { id: "a", startMinutes: 540, endMinutes: 620 },
      { id: "b", startMinutes: 600, endMinutes: 680 },
      { id: "c", startMinutes: 660, endMinutes: 720 },
    ]);
    // a and b share a row. c overlaps only b, so it is not in that group and
    // reclaims the full width — forcing it to share would leave a permanent
    // half-width gap for a block that has nothing to share with.
    expect(result.get("a")).toMatchObject({ column: 0, columnCount: 2 });
    expect(result.get("b")).toMatchObject({ column: 1, columnCount: 2 });
    expect(result.get("c")).toMatchObject({ column: 0, columnCount: 1 });
  });

  it("offsets tops from the 06:00 day window", () => {
    const result = layoutColumns([{ id: "a", startMinutes: 540, endMinutes: 600 }]);
    expect(result.get("a")!.topMinutes).toBe(540 - DAY_START_MINUTES);
    expect(result.get("a")!.heightMinutes).toBe(60);
  });

  it("clamps a before-window block to the top of the view", () => {
    const result = layoutColumns([{ id: "a", startMinutes: 120, endMinutes: 180 }]);
    expect(result.get("a")!.topMinutes).toBe(0);
  });

  it("gives a sub-minimum block the minimum readable height", () => {
    const result = layoutColumns([{ id: "a", startMinutes: 540, endMinutes: 540 }]);
    expect(result.get("a")!.heightMinutes).toBe(MIN_BLOCK_MINUTES);
  });

  it("returns an empty map for no blocks", () => {
    expect(layoutColumns([]).size).toBe(0);
  });

  it("is order independent", () => {
    const input = [
      { id: "a", startMinutes: 540, endMinutes: 700 },
      { id: "b", startMinutes: 550, endMinutes: 700 },
      { id: "c", startMinutes: 900, endMinutes: 960 },
    ];
    const forwards = layoutColumns(input);
    const backwards = layoutColumns([...input].reverse());
    expect(forwards.get("a")).toEqual(backwards.get("a"));
    expect(forwards.get("c")).toEqual(backwards.get("c"));
  });
});

describe("dayTotals", () => {
  it("sums a normal day", () => {
    const totals = dayTotals([
      { startMinutes: 540, endMinutes: 600 },
      { startMinutes: 660, endMinutes: 720 },
    ]);
    expect(totals.plannedMinutes).toBe(120);
    expect(totals.bookedMinutes).toBe(120);
    expect(totals.blockCount).toBe(2);
    expect(totals.coveragePercent).toBe(8);
  });

  it("counts overlapping minutes once in planned but still counts them in booked", () => {
    // The two numbers differing is the signal that the day is double-booked.
    const totals = dayTotals([
      { startMinutes: 540, endMinutes: 660 },
      { startMinutes: 600, endMinutes: 720 },
    ]);
    expect(totals.plannedMinutes).toBe(180);
    expect(totals.bookedMinutes).toBe(240);
  });

  it("reports coverage against the full 1440-minute day", () => {
    expect(dayTotals([{ startMinutes: 0, endMinutes: 720 }]).coveragePercent).toBe(50);
  });

  it("finds the longest gap in the day window", () => {
    const totals = dayTotals([
      { startMinutes: 360, endMinutes: 420 }, // 06:00-07:00
      { startMinutes: 1080, endMinutes: 1140 }, // 18:00-19:00
    ]);
    // 07:00 to 18:00 is the largest free run.
    expect(totals.longestGapMinutes).toBe(660);
  });

  it("reports the whole window as free when nothing is planned", () => {
    const totals = dayTotals([]);
    expect(totals.plannedMinutes).toBe(0);
    expect(totals.bookedMinutes).toBe(0);
    expect(totals.coveragePercent).toBe(0);
    expect(totals.longestGapMinutes).toBe(1440 - DAY_START_MINUTES);
  });

  it("ignores negative and inverted ranges", () => {
    const totals = dayTotals([{ startMinutes: 600, endMinutes: 500 }]);
    expect(totals.bookedMinutes).toBe(0);
    expect(totals.plannedMinutes).toBe(0);
  });

  it("does not exceed a full day when a block overruns midnight", () => {
    const totals = dayTotals([{ startMinutes: 1380, endMinutes: 1500 }]);
    expect(totals.plannedMinutes).toBe(60);
    expect(totals.coveragePercent).toBe(4);
  });
});

describe("formatting helpers", () => {
it("formats a 12-hour clock with an AM/PM suffix", () => {
    expect(formatClock(9 * 60)).toBe("9:00 AM");
    expect(formatClock(9 * 60 + 5)).toBe("9:05 AM");
    expect(formatClock(13 * 60 + 30)).toBe("1:30 PM");
    expect(formatClock(0)).toBe("12:00 AM");
    expect(formatClock(12 * 60)).toBe("12:00 PM");
  });

  it("wraps out-of-range minutes rather than rendering NaN", () => {
    expect(formatClock(1440)).toBe("12:00 AM");
    expect(formatClock(-60)).toBe("11:00 PM");
  });

  it("converts minutes to a native time input value", () => {
    expect(toTimeValue(450)).toBe("07:30");
    expect(toTimeValue(0)).toBe("00:00");
    expect(toTimeValue(1439)).toBe("23:59");
    expect(toTimeValue(-60)).toBe("00:00");
    expect(toTimeValue(1500)).toBe("23:59");
  });

  it("parses a native time input value back to minutes", () => {
    expect(fromTimeValue("07:30")).toBe(450);
    expect(fromTimeValue("23:59")).toBe(1439);
    expect(fromTimeValue("9:5")).toBeNull();
    expect(fromTimeValue("24:00")).toBeNull();
    expect(fromTimeValue("")).toBeNull();
  });

  it("formats durations compactly", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("snaps to the nearest quarter hour", () => {
    expect(snapToQuarter(547)).toBe(540);
    expect(snapToQuarter(548)).toBe(555);
    expect(snapToQuarter(600)).toBe(600);
  });

  it("reads minutes from local midnight", () => {
    const d = new Date(2026, 8, 27, 14, 30);
    expect(minutesFromMidnight(d)).toBe(14 * 60 + 30);
  });

  it("keeps the maximum block under a full day", () => {
    expect(MAX_BLOCK_MINUTES).toBeLessThan(1440);
  });
});

describe("findFreeSlots", () => {
  it("finds the very start of the window in an empty day", () => {
    expect(firstFreeSlot([], 60)).toBe(DAY_START_MINUTES);
  });

  /**
   * The realistic caller passes `fromMinutes`. Without it the answer is 06:00,
   * which is the first free minute of the window rather than a useful time to
   * put work at — this pins that the parameter is what fixes it.
   */
  it("honours a workday start rather than jumping to 06:00", () => {
    expect(firstFreeSlot([], 60, { fromMinutes: WORKDAY_START_MINUTES })).toBe(
      WORKDAY_START_MINUTES,
    );
  });

  it("skips past a booked morning to the first real gap", () => {
    const blocks = [{ startMinutes: 9 * 60, endMinutes: 10 * 60 }];
    expect(firstFreeSlot(blocks, 60, { fromMinutes: WORKDAY_START_MINUTES })).toBe(10 * 60);
  });

  it("keeps searching when a slot only partly fits", () => {
    // A 30-minute hole at 10:30 is not enough for a 60-minute block.
    const blocks = [
      { startMinutes: 9 * 60, endMinutes: 10 * 60 },
      { startMinutes: 10 * 60 + 30, endMinutes: 14 * 60 },
    ];
    expect(firstFreeSlot(blocks, 60, { fromMinutes: WORKDAY_START_MINUTES })).toBe(14 * 60);
  });

  it("returns every quarter-hour start that fits, in order", () => {
    const slots = findFreeSlots([{ startMinutes: 540, endMinutes: 600 }], 30);
    expect(slots[0]).toBe(DAY_START_MINUTES);
    expect(slots).toContain(600);
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i]!).toBeGreaterThan(slots[i - 1]!);
    }
  });

  it("snaps the search start to the nearest quarter hour in both directions", () => {
    // 548 is nearer 555; 547 is nearer 540. Round-to-nearest, not always-up —
    // always snapping up would silently skip a free slot that already started.
    expect(firstFreeSlot([], 30, { fromMinutes: 548 })).toBe(555);
    expect(firstFreeSlot([], 30, { fromMinutes: 547 })).toBe(540);
  });

  it("returns nothing when the day is already full", () => {
    const blocks = [{ startMinutes: 0, endMinutes: 1440 }];
    expect(firstFreeSlot(blocks, 60)).toBeNull();
  });

  it("returns nothing when a block is longer than the window allows", () => {
    expect(firstFreeSlot([], 1430)).toBeNull();
  });

  it("honours an after-point so the form can offer the next slot", () => {
    const blocks = [
      { startMinutes: 540, endMinutes: 600 },
      { startMinutes: 600, endMinutes: 660 },
    ];
    expect(firstFreeSlot(blocks, 60, { fromMinutes: 660 })).toBe(660);
  });

  it("does not offer a slot that runs past the end of the window", () => {
    const slots = findFreeSlots([], 60, { toMinutes: 17 * 60 });
    expect(Math.max(...slots) + 60).toBeLessThanOrEqual(17 * 60);
  });
});