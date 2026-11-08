import { describe, expect, it } from "vitest";
import { goldenState } from "./structure/golden";
import { listFoldRange, listFolds } from "./listFold";

/** The folded-away text for the item on 1-based `line`, or null. */
function hidden(doc: string, line: number): string | null {
  const state = goldenState(doc + "‸");
  const range = listFoldRange(state, state.doc.line(line).from);
  return range ? state.sliceDoc(range.from, range.to) : null;
}

describe("listFoldRange — 收起整棵子树", () => {
  it("folds children of every marker type together", () => {
    expect(hidden("- 你说呢\n  - 哈哈\n  1. 下面可以有\n", 1)).toBe("\n  - 哈哈\n  1. 下面可以有");
  });

  it("folds continuation lines and a code block inside the item", () => {
    expect(hidden("- a\n  more\n\n  ```\n  x\n  ```\n- b\n", 1)).toBe("\n  more\n\n  ```\n  x\n  ```");
  });

  it("stops before the next sibling and drops trailing blank lines", () => {
    expect(hidden("- a\n  - b\n\n- c\n", 1)).toBe("\n  - b");
  });

  it("does not fold an adjacent top-level list", () => {
    expect(hidden("- a\n  - b\n1. c\n", 1)).toBe("\n  - b");
  });

  it("folds a nested item's own subtree", () => {
    expect(hidden("- a\n\t- b\n\t\t- c\n- d\n", 2)).toBe("\n\t\t- c");
  });

  it("has no range for a one-line item or a continuation line", () => {
    expect(hidden("- a\n- b\n", 1)).toBeNull();
    expect(hidden("- a\n  more\n", 2)).toBeNull();
  });

  it("folds a list inside a quote, and inside a callout (change: editor-insets)", () => {
    expect(hidden("> - a\n>   - b\n> - c\n", 1)).toBe("\n>   - b");
    expect(hidden("> [!NOTE]\n> - a\n>   1. b\n>   - c\n", 2)).toBe("\n>   1. b\n>   - c");
  });

  it("drops a trailing line that holds only the quote prefix", () => {
    expect(hidden("> - a\n>   - b\n>\n> after\n", 1)).toBe("\n>   - b");
  });
});

describe("listFolds — 哪些项有把手", () => {
  it("lists only items with something to fold, folded state off", () => {
    const state = goldenState("- a\n  - b\n- c\n- d\n  more‸");
    expect(listFolds(state, 0, state.doc.length).map((f) => [state.doc.lineAt(f.lineFrom).number, f.folded])).toEqual([
      [1, false],
      [4, false],
    ]);
  });
});
