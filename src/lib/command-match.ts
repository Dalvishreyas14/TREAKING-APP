/**
 * Command palette matching.
 *
 * Deliberately not a fuzzy-search dependency. The corpus is the navigation
 * model - a few dozen items - so the whole index fits in memory and a substring
 * test is instant. Adding a library here would cost more in bundle size than it
 * saves in behaviour, and would make the ranking harder to reason about.
 *
 * The ranking is what makes the palette feel right, so it is spelled out:
 *
 *   1. exact match on the label
 *   2. label starts with the query
 *   3. label contains the query
 *   4. a keyword starts with the query
 *   5. a keyword contains the query
 *   6. a fuzzy subsequence match on the label
 *
 * Ties break on the shorter label, because "Focus" should beat "Focus sessions"
 * when someone typed "focus".
 */

export interface Matchable {
  label: string;
  keywords: string[];
}

export interface Scored<T> {
  item: T;
  score: number;
}

const EXACT = 1000;
const LABEL_PREFIX = 800;
const LABEL_CONTAINS = 600;
const KEYWORD_PREFIX = 400;
const KEYWORD_CONTAINS = 200;
const FUZZY = 100;

/** True when every character of `query` appears in `text`, in order. */
export function isSubsequence(query: string, text: string): boolean {
  let i = 0;
  for (const char of text) {
    if (char === query[i]) i++;
    if (i === query.length) return true;
  }
  return query.length === 0;
}

/** Normalises the messy ways people type: case, spacing, and `-` vs `_`. */
export function normalise(value: string): string {
  return value.toLowerCase().trim().replace(/[-_\s]+/g, " ");
}

export function scoreMatch(item: Matchable, rawQuery: string): number {
  const query = normalise(rawQuery);
  if (query.length === 0) return LABEL_PREFIX;

  const label = normalise(item.label);

  if (label === query) return EXACT;
  if (label.startsWith(query)) return LABEL_PREFIX - label.length;
  if (label.includes(query)) return LABEL_CONTAINS - label.length;

  for (const keyword of item.keywords) {
    const k = normalise(keyword);
    if (k.startsWith(query)) return KEYWORD_PREFIX - k.length;
    if (k.includes(query)) return KEYWORD_CONTAINS - k.length;
  }

  if (isSubsequence(query, label)) return FUZZY - label.length;

  return 0;
}

export function rankMatches<T extends Matchable>(
  items: T[],
  query: string,
  limit = 8,
): Scored<T>[] {
  return items
    .map((item) => ({ item, score: scoreMatch(item, query) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
