import type { EditorState } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";

/**
 * Match-count helpers for the find panel (change: find-count-perf).
 *
 * Split out as pure, EditorState-level functions so they unit-test in node
 * (EditorView can't be constructed there; EditorState + SearchCursor can —
 * design D5). The panel caches the total and recomputes it only on query/doc
 * change (D1); the ordinal is cheap enough to refresh every render (D2).
 *
 * Both assume `query.valid` — the caller gates on it before counting.
 */

/**
 * Total number of matches across the whole document. O(document): the only
 * primitive @codemirror/search exposes for a total, so the panel caches this
 * and recomputes only when the query or document changes.
 */
export function matchTotal(state: EditorState, query: SearchQuery): number {
  let total = 0;
  const cursor = query.getCursor(state);
  for (let item = cursor.next(); !item.done; item = cursor.next()) total++;
  return total;
}

/**
 * 1-based ordinal of the match sitting exactly on `[from, to]`, or 0 when the
 * selection isn't on a match. Bounded, early-exit scan: matches arrive in
 * document order, so once one starts past `from` the selection can't be a
 * match and we stop — the scan is bounded by the cursor offset, never the whole
 * document, so moving the cursor stays cheap (design D2).
 */
export function matchOrdinal(
  state: EditorState,
  query: SearchQuery,
  from: number,
  to: number,
): number {
  let ordinal = 0;
  const cursor = query.getCursor(state);
  for (let item = cursor.next(); !item.done; item = cursor.next()) {
    ordinal++;
    if (item.value.from === from && item.value.to === to) return ordinal;
    if (item.value.from > from) return 0; // passed the selection, not on a match
  }
  return 0;
}
