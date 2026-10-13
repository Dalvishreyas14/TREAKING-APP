import { describe, expect, it } from "vitest";

import {
  mergeSlices,
  movingAverage,
  movingAverageWindowLabel,
  trendDirection,
  weekdayRows,
} from "@/lib/analytics/charts";

/**
 * The arithmetic behind the analytics charts.
 *
 * Recharts cannot run here — it needs a DOM — so these are the tests that decide
 * whether the numbers on the analytics screen are right. Each case is a way the
 * chart could look perfectly plausible while saying something false, which is the
 * only kind of charting bug worth writing a test for.
 */

describe("movingAverage", () => {
  it("averages the trailing window and aligns with the input", () => {
    // Aligned, not shifted: out[3] must average in[1..3], because a line drawn
    // ahead of the data it averages is the illusion a moving average exists to
    // remove.
    expect(movingAverage([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 1.5, 2, 3, 4, 5, 6]);
  });

  it("smooths a flat series to itself", () => {
    expect(movingAverage([4, 4, 4, 4], 3)).toEqual([4, 4, 4, 4]);
  });

  it("averages only what exists before the window fills", () => {
    // The first values are under-smoothed rather than null, so the line can be
    // read against the bars beside it from day one.
    expect(movingAverage([10, 0, 0, 0, 0, 0, 0, 0], 7)).toEqual([10, 5, 3.33, 2.5, 2, 1.67, 1.43, 0]);
  });

  it("returns the input unchanged for a window of one", () => {
    expect(movingAverage([3, 1, 2], 1)).toEqual([3, 1, 2]);
  });

  it("handles an empty series", () => {
    expect(movingAverage([], 7)).toEqual([]);
  });

  it("keeps the same length as its input", () => {
    const values = [5, 0, 9, 2, 7, 1];
    expect(movingAverage(values, 3)).toHaveLength(values.length);
  });

  it("does not mutate its input", () => {
    const values = [1, 2, 3];
    movingAverage(values, 2);
    expect(values).toEqual([1, 2, 3]);
  });
});

describe("movingAverageWindowLabel", () => {
  it("names the window once there is enough data to fill it", () => {
    expect(movingAverageWindowLabel(7, 30)).toBe("7-day average");
  });

  it("says just average when the series is shorter than the window", () => {
    // Claiming a seven-day average over four days would be a lie about the maths.
    expect(movingAverageWindowLabel(7, 4)).toBe("average");
  });

  it("says just average for a one-day window", () => {
    expect(movingAverageWindowLabel(1, 30)).toBe("average");
  });
});

describe("weekdayRows", () => {
  /** Thirty consecutive days from a Monday, so Monday appears five times. */
  const window = Array.from({ length: 30 }, (_, i) => {
    const d = new Date("2026-03-02T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });

  it("starts on Monday and wraps to Sunday last", () => {
    expect(weekdayRows(window, new Map()).map((r) => r.label)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
  });

  it("counts how many times each weekday occurred", () => {
    // The denominator the whole chart depends on. Thirty days from a Monday has
    // five Mondays and five Tuesdays but only four of every other day, which is
    // exactly the imbalance that makes raw weekday counts unreadable.
    const byLabel = new Map(weekdayRows(window, new Map()).map((r) => [r.label, r.expected]));

    expect(byLabel.get("Mon")).toBe(5);
    expect(byLabel.get("Tue")).toBe(5);
    expect(byLabel.get("Wed")).toBe(4);
    expect(byLabel.get("Sun")).toBe(4);
    expect([...byLabel.values()].reduce((a, b) => a + b, 0)).toBe(30);
  });

  it("divides by occurrences rather than by days in the window", () => {
    // Two completions across five Mondays is 40%, not 200/7. This is the case the
    // function exists for: a raw count would rank Monday above Tuesday purely
    // because Monday happened once more.
    const counts = new Map<string, number>([
      ["2026-03-02", 1], // Monday
      ["2026-03-09", 1], // Monday
    ]);
    const monday = weekdayRows(window, counts).find((r) => r.label === "Mon");

    expect(monday).toMatchObject({ count: 2, expected: 5, rate: 0.4 });
  });

  it("returns a null rate for a weekday that did not occur", () => {
    // A single-day window contains exactly one weekday. Reporting the other six as
    // 0% would claim six days of failure that never happened.
    const oneDay = [new Date("2026-03-02T00:00:00.000Z")];
    const rows = weekdayRows(oneDay, new Map());
    const missing = rows.filter((r) => r.expected === 0);

    expect(missing).toHaveLength(6);
    expect(missing.every((r) => r.rate === null)).toBe(true);
  });

  it("reports a full rate when every occurrence was completed", () => {
    const counts = new Map(window.map((d) => [d.toISOString().slice(0, 10), 1]));
    expect(weekdayRows(window, counts).every((r) => r.rate === 1)).toBe(true);
  });

  it("treats days with no activity as zero, not missing", () => {
    // The opposite of the missing-weekday case: the day happened, the user did
    // nothing on it, and that is a real zero.
    const counts = new Map([["2026-03-02", 3]]);
    const rows = weekdayRows(window, counts);
    const monday = rows.find((r) => r.label === "Mon");
    const tuesday = rows.find((r) => r.label === "Tue");

    expect(monday).toMatchObject({ count: 3, rate: 0.6 });
    expect(tuesday).toMatchObject({ count: 0, rate: 0 });
  });

  it("ignores count keys that are not in the window", () => {
    const counts = new Map([["1999-01-01", 99]]);
    expect(weekdayRows(window, counts).every((r) => r.count === 0)).toBe(true);
  });
});

describe("mergeSlices", () => {
  const entry = (name: string, value: number) => ({ name, color: `#${name}`, value });

  it("keeps every slice when they are all large enough", () => {
    const slices = mergeSlices([entry("A", 50), entry("B", 30), entry("C", 20)], {
      max: 6,
      minShare: 0.03,
    });

    expect(slices.map((s) => s.name)).toEqual(["A", "B", "C"]);
    expect(slices.map((s) => s.percent)).toEqual([50, 30, 20]);
  });

  it("folds the tail into Other so the ring stays readable", () => {
    // Three slivers at 2% each. Individually they clear a bar chart's floor and
    // not a ring's.
    const slices = mergeSlices([entry("A", 94), entry("B", 2), entry("C", 2), entry("D", 2)], {
      max: 6,
      minShare: 0.03,
    });

    expect(slices.map((s) => s.name)).toEqual(["A", "Other (3)"]);
    expect(slices[1]!.percent).toBe(6);
  });

  it("keeps a slice sitting exactly on the minimum share", () => {
    // Three percent is the floor, not the first value below it. A slice exactly on
    // the boundary is kept — rounding a share down and folding it would make the
    // fold depend on arithmetic noise.
    const slices = mergeSlices([entry("A", 60), entry("B", 37), entry("C", 3)], {
      max: 6,
      minShare: 0.03,
    });

    expect(slices.map((s) => s.name)).toEqual(["A", "B", "C"]);
  });

  it("folds a slice below the minimum share even when there is room for it", () => {
    // Four percent is legible as a bar but not as an angle in a ring.
    const slices = mergeSlices([entry("A", 60), entry("B", 36), entry("C", 2), entry("D", 2)], {
      max: 6,
      minShare: 0.03,
    });

    expect(slices.map((s) => s.name)).toEqual(["A", "B", "Other (2)"]);
  });

  it("names a single folded slice rather than saying Other (1)", () => {
    const slices = mergeSlices([entry("A", 97), entry("Reading", 3)], { max: 1, minShare: 0.03 });
    expect(slices.map((s) => s.name)).toEqual(["A", "Other: Reading"]);
  });

  it("respects the maximum even when every slice is large", () => {
    const slices = mergeSlices(
      [entry("A", 40), entry("B", 30), entry("C", 20), entry("D", 10)],
      { max: 2, minShare: 0.03 },
    );

    expect(slices.map((s) => s.name)).toEqual(["A", "B", "Other (2)"]);
    expect(slices.reduce((n, s) => n + s.percent, 0)).toBe(100);
  });

  it("drops zero and negative slices rather than drawing them", () => {
    // A negative share has no meaning in a ring, and passing it through would make
    // the total disagree with the drawn angles.
    const slices = mergeSlices([entry("A", 10), entry("B", 0), entry("C", -5)], {
      max: 6,
      minShare: 0.03,
    });

    expect(slices.map((s) => s.name)).toEqual(["A"]);
    expect(slices[0]!.percent).toBe(100);
  });

  it("returns nothing when there is nothing to draw", () => {
    expect(mergeSlices([], { max: 6, minShare: 0.03 })).toEqual([]);
    expect(mergeSlices([entry("A", 0)], { max: 6, minShare: 0.03 })).toEqual([]);
  });

  it("shares sum to about a hundred, not exactly", () => {
    // Rounding each slice independently means three thirds is 33+33+33. Charts
    // that claim a total are held to it; this one is not.
    const slices = mergeSlices([entry("A", 1), entry("B", 1), entry("C", 1)], {
      max: 6,
      minShare: 0.03,
    });

    expect(slices.reduce((n, s) => n + s.percent, 0)).toBe(99);
  });
});

describe("trendDirection", () => {
  it("says flat for a series too short to compare halves of", () => {
    expect(trendDirection([1, 5, 2, 8], 7)).toBe("flat");
  });

  it("says flat for a steady series", () => {
    expect(trendDirection(new Array(30).fill(4))).toBe("flat");
  });

  it("spots a rise", () => {
    const values = [...new Array(15).fill(2), ...new Array(15).fill(8)];
    expect(trendDirection(values)).toBe("up");
  });

  it("spots a fall", () => {
    const values = [...new Array(15).fill(8), ...new Array(15).fill(2)];
    expect(trendDirection(values)).toBe("down");
  });

  it("ignores a change inside the noise", () => {
    // 4 a day becoming 4.2 is a 5% rise, inside the ±10% band, and is not a trend.
    // A chart that claims otherwise is the reason people stop reading trend lines.
    const values = [...new Array(15).fill(4), ...new Array(15).fill(4.2)];
    expect(trendDirection(values)).toBe("flat");
  });

  it("reads a change just outside the band as a direction", () => {
    // 4 a day becoming 4.5 is 12.5%, outside the band, and clear enough to call.
    const values = [...new Array(15).fill(4), ...new Array(15).fill(4.5)];
    expect(trendDirection(values)).toBe("up");
  });

  it("reads a rise from zero as a rise", () => {
    // Division by zero would otherwise make this "flat", which is the most
    // misleading possible answer to "did I start doing anything".
    const values = [...new Array(15).fill(0), ...new Array(15).fill(3)];
    expect(trendDirection(values)).toBe("up");
  });

  it("says flat when nothing happened at all", () => {
    expect(trendDirection(new Array(30).fill(0))).toBe("flat");
  });

  it("does not read a single spike as a trend", () => {
    // One good Tuesday in the middle of nothing is a week, not a direction.
    const values = [...new Array(30).fill(0)];
    values[15] = 10;
    expect(trendDirection(values)).toBe("flat");
  });
});
