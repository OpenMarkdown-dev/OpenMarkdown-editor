import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { codeFolding, foldable } from "@codemirror/language";
import {
  boundedTree,
  progressiveTree,
  treeChanged,
  treeUpTo,
  withCompleteTree,
  withTreeUpTo,
} from "./syntax";
import { runStructureKey } from "./structure";

/**
 * The accessors' contracts under a STALLED parse (change: syntax-access). The
 * library's 20ms budget is a wall-clock check, so stalling the clock while a
 * state is created reproduces exactly what CPU load or a GC pause does — the
 * flake this module exists to end (docs/dev-notes.md 「语法树「半截」」) —
 * deterministically, on any machine.
 */

const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;
});

/** Every `Date.now()` read jumps 25ms: each parse budget expires after one step. */
function stall(): void {
  let t = realNow();
  Date.now = () => (t += 25);
}

/** A state created while the clock is stalled: its field holds a frozen partial tree. */
function stalledState(doc: string, selection = 0): EditorState {
  stall();
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(selection),
    extensions: [markdown({ base: markdownLanguage, addKeymap: false }), codeFolding()],
  });
  Date.now = realNow;
  return state;
}

function names(tree: ReturnType<typeof progressiveTree>): string[] {
  const out: string[] = [];
  tree.iterate({ enter: (n) => void out.push(n.name) });
  return out;
}

const LIST = "- 你说呢\n  - 哈哈\n  1. 下面可以有\n";
const SECTIONS = Array.from({ length: 40 }, (_, i) => `## 第 ${i} 节\n\n正文 ${i},**加粗**。\n`).join("\n");

describe("the reproduction", () => {
  it("a stalled create freezes a partial tree in the field", () => {
    const state = stalledState(LIST);
    expect(progressiveTree(state).length).toBeLessThan(state.doc.length);
  });
});

describe("treeUpTo — keys and commands", () => {
  it("is complete through the caret's top-level block under a stall", () => {
    const state = stalledState(LIST, LIST.indexOf("哈哈"));
    const tree = treeUpTo(state, state.selection.main.head);
    expect(tree.length).toBe(state.doc.length);
    expect(names(tree).filter((n) => n === "ListItem")).toHaveLength(3);
  });

  it("stops after the block: a later block's start is the proof, not the document end", () => {
    const doc = "- a\n- b\n\n# after\n\n" + "para\n\n".repeat(2000);
    const state = stalledState(doc, 1);
    const tree = treeUpTo(state, 1);
    const top = tree.topNode;
    expect(top.firstChild?.name).toBe("BulletList");
    expect(top.firstChild?.to).toBe(doc.indexOf("\n\n# after"));
    expect(tree.length).toBeLessThan(doc.length);
  });

  it("an unclosed fence runs to the end: its block is the rest of the document", () => {
    const doc = "```js\nlet a = 1;\n\n" + "x\n".repeat(3000);
    const state = stalledState(doc, 5);
    const fence = treeUpTo(state, 5).topNode.firstChild!;
    expect(fence.name).toBe("FencedCode");
    expect(fence.to).toBe(doc.length);
  });
});

describe("withTreeUpTo — library code reads the field", () => {
  it("puts the settled tree in the field that foldable / lang-markdown read", () => {
    const state = stalledState(LIST);
    expect(foldable(state, 0, state.doc.line(1).to)).toBeNull();
    const settled = withTreeUpTo(state, 0);
    expect(progressiveTree(settled).length).toBe(settled.doc.length);
    expect(settled.doc.toString()).toBe(state.doc.toString());
  });

  it("returns the same state when the field already holds the tree", () => {
    const state = withCompleteTree(stalledState(LIST));
    expect(withTreeUpTo(state, 0)).toBe(state);
  });

  it("the structure entry settles its target: Enter continues a list under a stall", () => {
    const doc = "- 一\n- 二";
    const state = stalledState(doc, doc.length);
    let next = state;
    runStructureKey({ state, dispatch: (tr) => (next = tr.state) }, "Enter");
    expect(next.doc.toString()).toBe("- 一\n- 二\n- ");
  });
});

describe("boundedTree — whole-document consumers", () => {
  it("is complete within a generous budget", () => {
    const state = stalledState(SECTIONS);
    const r = boundedTree(state);
    expect(r.complete).toBe(true);
    expect(r.tree.length).toBe(state.doc.length);
    expect(names(r.tree).filter((n) => n === "ATXHeading2")).toHaveLength(40);
  });

  it("says incomplete — never a silent prefix — when the budget runs out", () => {
    const state = stalledState(SECTIONS);
    stall();
    const r = boundedTree(state, state.doc.length, 10);
    Date.now = realNow;
    expect(r.complete).toBe(false);
    expect(r.tree.length).toBeLessThan(state.doc.length);
    // Within budget again, the same state completes: the work is kept.
    expect(boundedTree(state).complete).toBe(true);
  });

  it("answers once per state: a per-line caller does not spend the budget per line", () => {
    const state = stalledState(SECTIONS);
    expect(boundedTree(state)).toBe(boundedTree(state));
  });

  it("only the prefix through `upto` has to be parsed", () => {
    const state = stalledState(SECTIONS);
    const upto = SECTIONS.indexOf("## 第 3 节");
    const r = boundedTree(state, upto);
    expect(r.complete).toBe(true);
    expect(r.tree.length).toBeGreaterThanOrEqual(upto);
  });
});

describe("progressiveTree / treeChanged — decorations", () => {
  it("reports the tree growing between two states with the same document", () => {
    const state = stalledState(SECTIONS);
    const grown = withCompleteTree(state);
    expect(treeChanged({ startState: state, state: grown })).toBe(true);
    expect(treeChanged({ startState: grown, state: grown })).toBe(false);
  });
});

describe("withCompleteTree — test factories", () => {
  it("fills the field with the whole document's tree under a stall", () => {
    const state = withCompleteTree(stalledState(SECTIONS));
    expect(progressiveTree(state).length).toBe(state.doc.length);
  });
});
