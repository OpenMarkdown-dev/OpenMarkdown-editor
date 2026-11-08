import { describe, expect, it } from "vitest";
import { entrySelection } from "./partEditor";

/**
 * Where a part editor's caret lands on entry (spec: caret-rules R15), and that
 * the entry caret never collapses a selection the pointer made first (change:
 * editor-cell-fixes): double-clicking a word in a cell that is not being edited
 * enters the cell with the first press and selects the word with the second —
 * which can arrive before the deferred entry caret is placed.
 */
describe("entrySelection", () => {
  it("seeds the caret the block asked for", () => {
    expect(entrySelection(undefined, 5, false)).toEqual({ anchor: 5 });
    expect(entrySelection("end", 5, false)).toEqual({ anchor: 5 });
    expect(entrySelection("start", 5, false)).toEqual({ anchor: 0 });
    expect(entrySelection("all", 5, false)).toEqual({ anchor: 0, head: 5 });
    expect(entrySelection(3, 5, false)).toEqual({ anchor: 3 });
    expect(entrySelection(9, 5, false)).toEqual({ anchor: 5 });
  });

  it("leaves a selection the pointer already made alone", () => {
    for (const caret of [undefined, "start", "end", "all", 2] as const) {
      expect(entrySelection(caret, 5, true)).toBeNull();
    }
  });
});
