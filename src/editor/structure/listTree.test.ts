import { describe, expect, it } from "vitest";
import { goldenState } from "./golden";
import { listTreeAt, type ListItemNode, type ListTree } from "./listTree";

/** The tree around the caret, or a failure if there is none. */
function treeOf(marked: string): ListTree {
  const state = goldenState(marked);
  const tree = listTreeAt(state, state.selection.main.head);
  if (!tree) throw new Error("no list tree at the caret");
  return tree;
}

/** `text` per item, indented two spaces per depth — the shape at a glance. */
function shape(tree: ListTree): string {
  const out: string[] = [];
  const walk = (layer: ListItemNode[]) => {
    for (const n of layer) {
      out.push("  ".repeat(n.depth) + n.markText);
      walk(n.children);
    }
  };
  walk(tree.roots);
  return out.join("\n");
}

describe("listTreeAt — parents, depths, style", () => {
  it("reads a tab-indented list", () => {
    const tree = treeOf("- a\n\t- b\n\t\t1. c‸");
    expect(shape(tree)).toBe("-\n  -\n    1.");
    expect(tree.style).toBe("tab");
    expect(tree.items.map((n) => n.contentCol)).toEqual([2, 6, 11]);
  });

  it("reads a space-indented list", () => {
    const tree = treeOf("1. a\n   - b\n      - c‸");
    expect(shape(tree)).toBe("1.\n  -\n    -");
    expect(tree.style).toBe("space");
  });

  it("calls a list with no nesting tab-style", () => {
    expect(treeOf("1. a\n2. b‸").style).toBe("tab");
  });

  // Two CommonMark lists, one layer (design D8): what lets Tab nest `1.` under `-`.
  it("puts adjacent dash and number lists in one layer", () => {
    const tree = treeOf("- a\n- b\n1. c‸");
    expect(tree.roots.map((n) => n.markText)).toEqual(["-", "-", "1."]);
    expect(tree.roots.map((n) => n.ordered)).toEqual([false, false, true]);
  });

  it("keeps lists apart when a blank line separates different markers", () => {
    expect(treeOf("- a\n\n1. c‸").roots.map((n) => n.markText)).toEqual(["1."]);
  });

  it("gathers mixed-marker children under one parent", () => {
    const tree = treeOf("- 你说呢\n  - 哈哈\n  1. 下面可以有‸");
    expect(shape(tree)).toBe("-\n  -\n  1.");
  });

  it("measures a wide marker's content column", () => {
    expect(treeOf("100. a‸").roots[0].contentCol).toBe(5);
  });

  it("marks empty items, task boxes included", () => {
    const tree = treeOf("- a\n- \n- [ ] \n- [ ] b‸");
    expect(tree.items.map((n) => n.emptyLine)).toEqual([false, true, true, false]);
  });

  it("reads a list inside a quote, leads after the quote prefix (change: quote-keys)", () => {
    const tree = treeOf("> - a\n> \t- b\n> - c‸");
    expect(tree.prefix).toBe("> ");
    expect(shape(tree)).toBe("-\n  -\n-");
    expect(tree.items.map((n) => n.lead)).toEqual(["", "\t", ""]);
    expect(tree.style).toBe("tab");
  });

  it("scopes a list inside a quote inside an item to the quote", () => {
    const tree = treeOf("- > - a\n  > - b‸");
    expect(tree.prefix).toBe("  > ");
    expect(shape(tree)).toBe("-\n-");
  });
});

// The golden outputs are compared byte for byte; these check the parser reads
// them as the nesting they are meant to be.
describe("golden outputs parse as the intended nesting", () => {
  const cases: [string, string][] = [
    ["1. a\n2. b\n3. c\n\t1. d‸", "1.\n2.\n3.\n  1."],
    ["100. a\n\t\t1. b‸", "100.\n  1."],
    ["1. 第一步\n   - 细节\n      - 细节2‸", "1.\n  -\n    -"],
    ["- 你说呢\n  - 哈哈\n  1. 下面可以有‸", "-\n  -\n  1."],
    ["8. h\n9. i\n10. j\n\t- x‸", "8.\n9.\n10.\n  -"],
    ["- a\n- b\n  1. x\n     1. y‸", "-\n-\n  1.\n    1."],
  ];
  for (const [doc, expected] of cases) {
    it(JSON.stringify(doc), () => expect(shape(treeOf(doc))).toBe(expected));
  }
});
