import type { ParsedTask } from "./task-parser";

/**
 * Taxonomy classification.
 *
 * Kept out of `task-parser.ts` on purpose. The parser is a pure function over a
 * string with no database and no user context, which is what makes it testable
 * and what keeps the temporal logic in it readable. Classification is the
 * opposite problem — it needs the user's own categories and goals, and it needs a
 * database. Mixing the two produced a parser that could only be tested by
 * standing up a database.
 *
 * Both matchers are conservative on purpose. A wrong guess is a wrong label the
 * user can change before accepting the draft, but an arbitrary guess is worse
 * than none: the user either trusts it or notices it was arbitrary, and both
 * outcomes cost more than the empty dropdown it replaced.
 */

/** Shared by both matchers: meaningful words, ignoring one-letter noise. */
function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * Category matching: exact name match first, then word overlap, then nothing.
 *
 * Both the cleaned title and the raw sentence are searched, because the raw text
 * still contains words that the title-casing pass discarded. Returns null rather
 * than a best-effort third choice when two categories tie.
 */
export function matchCategory(
  categories: Array<{ id: string; name: string }>,
  title: string,
  source: string,
): string | null {
  if (categories.length === 0) return null;

  const exact = categories.find(
    (c) => c.name.toLowerCase() === title.trim().toLowerCase() || source.includes(c.name),
  );
  if (exact) return exact.id;

  const words = significantWords(`${title} ${source}`);
  if (words.size === 0) return null;

  let best: { id: string; score: number } | null = null;
  for (const category of categories) {
    const nameWords = category.name.toLowerCase().split(/[^a-z0-9]+/);
    const score = nameWords.filter((w) => words.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: category.id, score };
  }

  return best?.id ?? null;
}

/**
 * Goal matching.
 *
 * A named goal title beats a date match. Someone writing "get the dissertation
 * chapter done friday" who happens to have a goal with a Friday target date
 * probably means the dissertation, and the date is the deadline rather than the
 * subject.
 *
 * The last rule — attach to the only live goal when there is exactly one — is the
 * one place a match is made with no textual evidence at all. It is safe precisely
 * because it can only fire when there is no ambiguity to get wrong.
 */
export function matchGoal(
  goals: Array<{ id: string; title: string; targetDate: Date | null }>,
  draft: ParsedTask,
  source: string,
): string | null {
  if (goals.length === 0) return null;

  const words = significantWords(`${draft.title} ${source}`);
  if (words.size > 0) {
    let best: { id: string; score: number } | null = null;
    for (const goal of goals) {
      const titleWords = goal.title.toLowerCase().split(/[^a-z0-9]+/);
      const score = titleWords.filter((w) => words.has(w)).length;
      if (score > 0 && (!best || score > best.score)) best = { id: goal.id, score };
    }
    if (best) return best.id;
  }

  if (goals.length === 1) return goals[0]!.id;

  return null;
}
