import { describe, expect, it } from "vitest";

import { matchCategory, matchGoal } from "@/lib/ai/classify";
import { parseTaskText } from "@/lib/ai/task-parser";

const NOW = new Date(2026, 2, 11, 10, 0, 0);

const CATEGORIES = [
  { id: "c-study", name: "Study" },
  { id: "c-health", name: "Health" },
  { id: "c-deep", name: "Deep Work" },
];

const GOALS = [
  { id: "g-thesis", title: "Finish the dissertation chapter", targetDate: new Date(2026, 3, 3) },
  { id: "g-marathon", title: "Train for the marathon", targetDate: new Date(2026, 8, 20) },
];

function draft(text: string) {
  return parseTaskText(text, NOW);
}

describe("matchCategory", () => {
  it("returns null when the user has no categories", () => {
    expect(matchCategory([], "Study notes", "study notes")).toBeNull();
  });

  it("matches an exact name", () => {
    expect(matchCategory(CATEGORIES, "Health", "health")).toBe("c-health");
  });

  it("matches on word overlap from the raw sentence", () => {
    expect(matchCategory(CATEGORIES, "Notes", "write up the study notes")).toBe("c-study");
  });

  it("returns null rather than guessing when nothing overlaps", () => {
    expect(matchCategory(CATEGORIES, "Call the dentist", "call the dentist")).toBeNull();
  });

  it("ignores one-letter words", () => {
    // "a" is filtered out, so it cannot match a category by accident.
    expect(matchCategory([{ id: "c-x", name: "X" }], "Y", "a y")).toBeNull();
  });

  it("does not match when the sentence has no significant words at all", () => {
    expect(matchCategory(CATEGORIES, "a b c", "a b c")).toBeNull();
  });
});

describe("matchGoal", () => {
  it("returns null when there are no live goals", () => {
    expect(matchGoal([], draft("finish the dissertation chapter"), "")).toBeNull();
  });

  it("matches on title words from the sentence", () => {
    expect(matchGoal(GOALS, draft("work on it"), "chapter the dissertation")).toBe("g-thesis");
  });

  it("attaches to the only live goal when there is nothing to disambiguate", () => {
    const single = [GOALS[0]!];
    expect(matchGoal(single, draft("something unrelated"), "something unrelated")).toBe(
      "g-thesis",
    );
  });

  it("returns null when several goals exist and none match", () => {
    expect(matchGoal(GOALS, draft("buy milk"), "buy milk")).toBeNull();
  });

  it("ignores the parsed deadline and matches on the subject", () => {
    // The sentence's deadline falls on the dissertation goal's target date, but
    // the subject is the marathon. `matchGoal` never reads the date, which is the
    // point: a deadline that coincides with someone's goal date is a coincidence,
    // not evidence of what the task is about.
    const parsed = draft("marathon long run friday");
    expect(matchGoal(GOALS, parsed, "marathon long run friday")).toBe("g-marathon");
  });
});
