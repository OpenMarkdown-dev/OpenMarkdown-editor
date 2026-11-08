import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { matchTotal, matchOrdinal } from "./findCount";

// EditorState (not EditorView) constructs headlessly in node; SearchQuery /
// SearchCursor are DOM-free, so the count helpers are unit-testable here
// (change: find-count-perf, design D5).
const stateOf = (doc: string) => EditorState.create({ doc });
const q = (search: string, caseSensitive = false) =>
  new SearchQuery({ search, caseSensitive, literal: true });

describe("matchTotal", () => {
  it("counts every match in the document", () => {
    expect(matchTotal(stateOf("ab ab ab"), q("ab"))).toBe(3);
  });

  it("is 0 when there are no matches", () => {
    expect(matchTotal(stateOf("xyz"), q("ab"))).toBe(0);
  });

  it("honors the case-sensitive flag", () => {
    const s = stateOf("Ab ab AB");
    expect(matchTotal(s, q("ab"))).toBe(3); // insensitive (default)
    expect(matchTotal(s, q("ab", true))).toBe(1); // sensitive → only "ab"
  });
});

describe("matchOrdinal", () => {
  // "ab ab ab" → matches at [0,2], [3,5], [6,8]
  it("returns the 1-based ordinal of the match sitting on the selection", () => {
    const s = stateOf("ab ab ab");
    expect(matchOrdinal(s, q("ab"), 0, 2)).toBe(1);
    expect(matchOrdinal(s, q("ab"), 3, 5)).toBe(2);
    expect(matchOrdinal(s, q("ab"), 6, 8)).toBe(3);
  });

  it("is 0 when the selection is not on a match", () => {
    const s = stateOf("ab ab ab");
    expect(matchOrdinal(s, q("ab"), 2, 3)).toBe(0); // the space between matches
  });

  it("is 0 when the selection only partially overlaps a match", () => {
    const s = stateOf("abc abc");
    expect(matchOrdinal(s, q("abc"), 0, 2)).toBe(0); // "ab" of "abc"
  });

  it("stops at the first match past the cursor rather than scanning to the end", () => {
    // A collapsed cursor before the 2nd match sits on no match → 0, and the
    // scan must not need the 3rd match to decide that.
    const s = stateOf("ab ab ab");
    expect(matchOrdinal(s, q("ab"), 2, 2)).toBe(0);
  });
});
