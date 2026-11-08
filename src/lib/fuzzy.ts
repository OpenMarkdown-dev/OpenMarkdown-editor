/**
 * Subsequence fuzzy scorer for the command palette. This module is the
 * replaceable seam (design D8): a future pinyin-aware matcher swaps the
 * implementation, the signature stays.
 *
 * Returns null for no match; higher scores rank first. Filename-segment hits
 * outweigh directory-segment hits, consecutive runs and word starts get
 * bonuses, longer targets take a mild penalty as a tiebreaker.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  if (!q) return 0;
  const t = target.toLowerCase();
  const nameStart = t.lastIndexOf("/") + 1;

  let score = 0;
  let from = 0;
  let prevHit = -2;
  for (const ch of q) {
    const idx = t.indexOf(ch, from);
    if (idx === -1) return null;
    score += idx >= nameStart ? 2 : 1;
    if (idx === prevHit + 1) score += 3;
    if (idx === 0 || "/ -_.".includes(t[idx - 1])) score += 2;
    prevHit = idx;
    from = idx + 1;
  }
  return score - t.length * 0.01;
}

/** Score, filter, and rank a list; ties keep input order (stable sort). */
export function rankByScore<T>(
  items: T[],
  query: string,
  text: (item: T) => string,
): T[] {
  if (!query) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
