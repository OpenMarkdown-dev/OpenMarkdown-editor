import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { withCompleteTree } from "./syntax";
import { history, undo } from "@codemirror/commands";
import { listIndentChange, selectionTargets, type ListIndentDir } from "./listIndent";
import { columnOf } from "./structure/columns";

/** Build a state with the cursor at `|`, forcing a full markdown parse. */
function stateAt(docWithCursor: string, extra: unknown[] = []): EditorState {
  const cursor = docWithCursor.indexOf("|");
  if (cursor < 0) throw new Error("test doc must contain a | cursor marker");
  const doc = docWithCursor.slice(0, cursor) + docWithCursor.slice(cursor + 1);
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: languages }), ...(extra as never[])],
  });
  return withCompleteTree(state);
}

type Outcome =
  | { outcome: "fallthrough" }
  | { outcome: "noop" }
  | { outcome: "change"; doc: string; cursor: number };

/** Run listIndentChange and normalize the three result shapes. */
function run(docWithCursor: string, dir: ListIndentDir, extra: unknown[] = []): Outcome {
  const state = stateAt(docWithCursor, extra);
  const res = listIndentChange(state, dir);
  if (res === null) return { outcome: "fallthrough" };
  if (res.kind === "noop") return { outcome: "noop" };
  const next = state.update(res.spec).state;
  return { outcome: "change", doc: next.doc.toString(), cursor: next.selection.main.head };
}

/** Assert a change occurred and return the resulting doc. */
function docAfter(docWithCursor: string, dir: ListIndentDir): string {
  const r = run(docWithCursor, dir);
  expect(r.outcome).toBe("change");
  return (r as { doc: string }).doc;
}

describe("listIndentChange — ordered list indent + renumber", () => {
  // Scenario: 有序项缩进成嵌套并从 1 重排 (the user's reported bug)
  it("indents a trailing ordered item into a fresh nested list numbered 1", () => {
    expect(docAfter("1. a\n2. b\n3. c\n4. d|\n", "more")).toBe("1. a\n2. b\n3. c\n\t1. d\n");
  });

  it("indenting into a sibling that already has children continues that nested list", () => {
    // 3. d nests under 2. b, joining the existing nested list -> becomes 2, at
    // the indent its new sibling already uses; `1. c` itself is untouched.
    expect(docAfter("1. a\n2. b\n   1. c\n3. d|\n", "more")).toBe("1. a\n2. b\n   1. c\n   2. d\n");
  });

  it("renumbers the level the item left so it stays sequential", () => {
    // indent item 2 -> level 0 becomes 1, 2(old 3); nested gets 1
    expect(docAfter("1. a\n2. b|\n3. c\n", "more")).toBe("1. a\n\t1. b\n2. c\n");
  });

  // Scenario: 反缩进回父层并两侧重排
  it("outdents a nested last item back to the parent level and renumbers", () => {
    expect(docAfter("1. a\n2. b\n   1. c\n   2. d|\n", "less")).toBe("1. a\n2. b\n   1. c\n3. d\n");
  });

  it("outdent reparents following siblings as children numbered from 1", () => {
    // outdent 1.c (has a following sibling 2.d) -> c goes to top (3.), d becomes
    // c's child (1.) with its own 3-space indent kept, since it still nests.
    expect(docAfter("1. a\n2. b\n   1. c|\n   2. d\n", "less")).toBe("1. a\n2. b\n3. c\n   1. d\n");
  });

  // Scenario: 最外层保留首项起始数,嵌套层从 1
  it("preserves a non-1 start number on the outermost list", () => {
    expect(docAfter("3. a\n4. b\n5. c|\n", "more")).toBe("3. a\n4. b\n\t1. c\n");
  });

  // Scenario: marker 变宽后嵌套仍合法. "   1. child" no longer nests under "10. "
  // (content column 4), so it is re-placed — a space-written list, the parent is
  // top-level and no other second-layer item to copy from: 4 spaces.
  it("reflows a child's indent when its parent marker grows from 9. to 10.", () => {
    const src =
      "1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n" +
      "   1. x|\n" + // outdent this -> becomes 9.
      "9. i\n" + // renumbers to 10.
      "   1. child\n"; // must reflow from 3 to 4 spaces
    const expected =
      "1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n" +
      "9. x\n" +
      "10. i\n" +
      "    1. child\n";
    expect(docAfter(src, "less")).toBe(expected);
  });
});

describe("listIndentChange — bullet & task lists", () => {
  // Scenario: 无序与任务列表 Tab 嵌套且不产生序号
  it("indents a bullet item without introducing a number", () => {
    expect(docAfter("- a\n- b|\n", "more")).toBe("- a\n\t- b\n");
  });

  it("indents a task item preserving its checkbox state", () => {
    expect(docAfter("- [ ] a\n- [x] b|\n", "more")).toBe("- [ ] a\n\t- [x] b\n");
  });

  it("outdents a nested bullet back to the parent level", () => {
    expect(docAfter("- a\n  - b|\n", "less")).toBe("- a\n- b\n");
  });

  it("nests an ordered sub-list under a bullet item, numbered from 1", () => {
    // y nests under `1. x`, which is untouched. One 2-space step past x is
    // column 4, short of x's content column (5), so y lands at 5 — the least
    // indent that still nests.
    expect(docAfter("- a\n- b\n  1. x\n  2. y|\n", "more")).toBe("- a\n- b\n  1. x\n     1. y\n");
  });
});

describe("listIndentChange — no-op and fall-through boundaries", () => {
  // Scenario: 列表首项不能再缩进
  it("no-ops (consumes) Tab on the first item of a list", () => {
    expect(run("1. a|\n2. b\n", "more").outcome).toBe("noop");
  });

  it("no-ops Tab on the first (only) item", () => {
    expect(run("1. a|\n", "more").outcome).toBe("noop");
  });

  // Scenario: 顶层项不能再反缩进
  it("no-ops (consumes) Shift-Tab on a top-level item", () => {
    expect(run("1. a\n2. b|\n", "less").outcome).toBe("noop");
  });

  // Scenario: 非列表上下文回退默认缩进
  it("falls through when the cursor is not in a list", () => {
    expect(run("just a paragraph|\n", "more").outcome).toBe("fallthrough");
  });

  // change quote-keys: a list inside a quote nests after the `> ` prefix.
  it("nests inside a blockquote after the quote prefix", () => {
    expect(run("> - a\n> - b|\n", "more")).toMatchObject({ outcome: "change", doc: "> - a\n> \t- b\n" });
  });

  // Scenario: 阅读模式不改写文档
  it("falls through in a read-only state", () => {
    expect(run("1. a\n2. b|\n", "more", [EditorState.readOnly.of(true)]).outcome).toBe("fallthrough");
  });
});

describe("listIndentChange — transaction shape", () => {
  it("keeps the cursor with the item text after indent", () => {
    const r = run("1. a\n2. b\n3. c\n4. dd|\n", "more");
    expect(r.outcome).toBe("change");
    const { doc, cursor } = r as { doc: string; cursor: number };
    // cursor was after "dd"; it should still sit right after "dd"
    expect(doc.slice(0, cursor).endsWith("dd")).toBe(true);
  });

  it("is a single undo step", () => {
    const state = stateAt("1. a\n2. b\n3. c\n4. d|\n", [history()]);
    const res = listIndentChange(state, "more");
    if (!res || res.kind !== "change") throw new Error("expected a change result");
    let s = state.update(res.spec).state;
    expect(s.doc.toString()).toBe("1. a\n2. b\n3. c\n\t1. d\n");
    undo({ state: s, dispatch: (tr) => { s = tr.state; } });
    expect(s.doc.toString()).toBe("1. a\n2. b\n3. c\n4. d\n");
  });

  it("does not auto-renumber on a plain edit (only Tab/Shift-Tab trigger it)", () => {
    // Deleting the middle item leaves 1./3.; listIndentChange is never invoked by
    // typing, so this documents that renumber is Tab-scoped, not a live listener.
    // (Guard: calling with a cursor mid-list still only responds to explicit dirs.)
    const state = stateAt("1. a\n3. c|\n");
    // A collapsed cursor with no structural move: 'more' would indent, but 'less'
    // on a top-level item is a no-op — neither silently "fixes" the 1./3. gap.
    expect(listIndentChange(state, "less")).toEqual({ kind: "noop" });
  });
});

describe("listIndentChange — 目标项按行判定,与光标所在列无关", () => {
  // Scenario: 行首光标仍作用于本行所属项
  it("outdents the item on the cursor's own line when the cursor sits at column 0", () => {
    expect(docAfter("- alpha\n|  - bravo\n", "less")).toBe("- alpha\n- bravo\n");
  });

  // Scenario: marker 之前的缩进空白中光标仍作用于本行所属项
  it("indents the item on the cursor's own line when the cursor sits before the marker", () => {
    // cursor inside the two leading spaces of the nested item; bravo stays a
    // child of alpha, now with charlie's former sibling line left as it was
    expect(docAfter("- alpha\n  - bravo\n | - charlie\n", "less")).toBe("- alpha\n  - bravo\n- charlie\n");
  });

  it("indents a top-level ordered item when the cursor sits at column 0", () => {
    // regression: this used to fall through to indentWithTab and emit "  2. b"
    expect(docAfter("1. a\n|2. b\n3. c\n", "more")).toBe("1. a\n\t1. b\n2. c\n");
  });

  // Scenario: 列表项内的代码块回退默认缩进
  it("falls through inside a fenced code block nested in a list item", () => {
    const doc = "- alpha\n- bravo\n\n  ```ts\n  const x = 1;|\n  ```\n";
    expect(run(doc, "more").outcome).toBe("fallthrough");
  });
});

describe("listIndentChange — 同一行的每个落点产出一致", () => {
  /** Build the doc with `|` inserted at `col` of the 1-based `lineNo`. */
  function withCursorAt(doc: string, lineNo: number, col: number): string {
    const lines = doc.split("\n");
    const line = lines[lineNo - 1];
    lines[lineNo - 1] = line.slice(0, col) + "|" + line.slice(col);
    return lines.join("\n");
  }

  // 行首 / 缩进空白中 / marker 上 / 正文中 / 行尾 — 判定 MUST 一致
  const cases: Array<{ doc: string; line: number; label: string; dir: ListIndentDir }> = [
    { doc: "- alpha\n  - bravo\n  - charlie\n", line: 3, label: "nested bullet", dir: "less" },
    { doc: "1. a\n2. b\n3. c\n", line: 2, label: "top-level ordered", dir: "more" },
    { doc: "- [ ] a\n- [x] b\n", line: 2, label: "task item", dir: "more" },
  ];

  for (const { doc, line, label, dir } of cases) {
    it(`${label}: every column on the line yields the same result (${dir})`, () => {
      const text = doc.split("\n")[line - 1];
      const lead = /^\s*/.exec(text)![0].length;
      const columns = [0, Math.max(0, lead - 1), lead, lead + 1, Math.floor(text.length / 2), text.length];
      const results = columns.map((col) => run(withCursorAt(doc, line, col), dir));
      // The DECISION (which item, what edit) must agree across columns; the
      // resulting cursor offset legitimately differs with the starting column.
      const decisions = results.map((r) => ({ outcome: r.outcome, doc: (r as { doc?: string }).doc }));
      for (const d of decisions) expect(d).toEqual(decisions[4]);
      expect(decisions[4].outcome).toBe("change");
    });
  }
});

describe("listIndentChange — 空行与非列表行仍回退", () => {
  it("falls through on a blank line between list items", () => {
    expect(run("- alpha\n|\n- bravo\n", "more").outcome).toBe("fallthrough");
  });

  it("falls through on a whitespace-only line inside a loose list", () => {
    expect(run("- alpha\n  |\n- bravo\n", "more").outcome).toBe("fallthrough");
  });

  it("falls through on a paragraph line that follows a list", () => {
    expect(run("- alpha\n- bravo\n\nplain paragraph|\n", "more").outcome).toBe("fallthrough");
  });

  it("falls through on a heading line", () => {
    expect(run("# title|\n\n- alpha\n", "more").outcome).toBe("fallthrough");
  });
});

describe("listIndentChange — 代码块边界", () => {
  it("falls through inside a top-level fenced code block", () => {
    expect(run("```ts\nconst x = 1;|\n```\n", "more").outcome).toBe("fallthrough");
  });

  it("falls through inside an indented code block nested in a list item", () => {
    // 4+ spaces past the item's content column = an indented code block
    const doc = "- alpha\n- bravo\n\n      raw code line|\n";
    expect(run(doc, "more").outcome).toBe("fallthrough");
  });

  it("falls through on the opening fence line of a fence nested in a list item", () => {
    const doc = "- alpha\n- bravo\n\n  ```ts|\n  const x = 1;\n  ```\n";
    expect(run(doc, "more").outcome).toBe("fallthrough");
  });

  it("falls through on the closing fence line of a fence nested in a list item", () => {
    const doc = "- alpha\n- bravo\n\n  ```ts\n  const x = 1;\n  ```|\n";
    expect(run(doc, "more").outcome).toBe("fallthrough");
  });

  it("still indents the list item when the cursor is on the item's own text line", () => {
    // the fence must not make the whole item untouchable — only the code lines
    const doc = "- alpha\n- bravo|\n\n  ```ts\n  const x = 1;\n  ```\n";
    expect(docAfter(doc, "more")).toBe("- alpha\n\t- bravo\n\n\t  ```ts\n\t  const x = 1;\n\t  ```\n");
  });
});

/** Build a state with a SELECTION marked by two `|` (anchor then head). */
function stateSel(docWithMarkers: string, extra: unknown[] = []): EditorState {
  const a = docWithMarkers.indexOf("|");
  if (a < 0) throw new Error("test doc must contain two | markers");
  const rest = docWithMarkers.slice(0, a) + docWithMarkers.slice(a + 1);
  const h = rest.indexOf("|");
  if (h < 0) throw new Error("test doc must contain two | markers");
  const doc = rest.slice(0, h) + rest.slice(h + 1);
  const state = EditorState.create({
    doc,
    selection: { anchor: a, head: h },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: languages }), ...(extra as never[])],
  });
  return withCompleteTree(state);
}

function runSel(docWithMarkers: string, dir: ListIndentDir, extra: unknown[] = []): Outcome {
  const state = stateSel(docWithMarkers, extra);
  const res = listIndentChange(state, dir);
  if (res === null) return { outcome: "fallthrough" };
  if (res.kind === "noop") return { outcome: "noop" };
  const next = state.update(res.spec).state;
  return { outcome: "change", doc: next.doc.toString(), cursor: next.selection.main.head };
}

function docAfterSel(docWithMarkers: string, dir: ListIndentDir): string {
  const r = runSel(docWithMarkers, dir);
  expect(r.outcome).toBe("change");
  return (r as { doc: string }).doc;
}

describe("selectionTargets — 选区落到哪些列表项", () => {
  const at = (state: EditorState) => selectionTargets(state).map((n) => n.from);

  it("a collapsed cursor targets exactly its own item", () => {
    const state = stateAt("- a\n- b|\n- c\n");
    expect(at(state)).toEqual([state.doc.line(2).from]);
  });

  it("a selection spanning two items targets both", () => {
    const state = stateSel("- a\n- |b\n- c|\n");
    expect(at(state)).toEqual([state.doc.line(2).from, state.doc.line(3).from]);
  });

  it("a selection ending exactly at a line start excludes that line", () => {
    // anchor inside "- b", head at the very start of "- c"
    const state = stateSel("- a\n- |b\n|- c\n");
    expect(at(state)).toEqual([state.doc.line(2).from]);
  });

  it("a selection covering a parent and its child targets both (dedup comes later)", () => {
    const state = stateSel("- |a\n  - b|\n");
    expect(at(state)).toEqual([state.doc.line(1).from, state.doc.line(2).from + 2]);
  });

  it("targets are deduped when several selected lines belong to one item", () => {
    // both lines belong to the same (loose) item "- b"
    const state = stateSel("- a\n- |b\n  continued|\n");
    expect(at(state)).toEqual([state.doc.line(2).from]);
  });

  it("non-list lines contribute no targets", () => {
    const state = stateSel("|plain one\nplain two|\n");
    expect(at(state)).toEqual([]);
  });
});

describe("listIndentChange — 多行选区批量缩进/反缩进", () => {
  // Scenario: 多行选区批量缩进
  it("indents every bullet the selection touches", () => {
    expect(docAfterSel("- a\n- |b\n- c|\n", "more")).toBe("- a\n\t- b\n\t- c\n");
  });

  it("indents every ordered item the selection touches and renumbers the new level", () => {
    expect(docAfterSel("1. a\n2. |b\n3. c|\n", "more")).toBe("1. a\n\t1. b\n\t2. c\n");
  });

  // Scenario: 多行选区批量反缩进
  it("outdents every nested item the selection touches", () => {
    expect(docAfterSel("- a\n  - |b\n  - c|\n", "less")).toBe("- a\n- b\n- c\n");
  });

  // Scenario: 选区内父子项不重复移动
  it("moves a selected child only once, with its selected parent's subtree", () => {
    // a nests under x one 2-space step in — the step b was written with
    expect(docAfterSel("- x\n- |a\n  - b|\n", "more")).toBe("- x\n  - a\n    - b\n");
  });

  // Scenario: 选区含不可动项时部分生效
  it("leaves the list's first item put and still indents the rest", () => {
    expect(docAfterSel("- |a\n- b|\n", "more")).toBe("- a\n\t- b\n");
  });

  // Scenario: 选区内全部不可动时整体 no-op
  it("no-ops when every touched item is top-level and the direction is outdent", () => {
    expect(runSel("- |a\n- b|\n", "less").outcome).toBe("noop");
  });

  it("no-ops when the only touched item is the list's first item", () => {
    expect(runSel("- |a|\n- b\n", "more").outcome).toBe("noop");
  });

  // design D4: a selection can span two unrelated list blocks
  it("handles a selection spanning two list blocks separated by a paragraph", () => {
    expect(docAfterSel("- a\n- |b\n\npara\n\n- c\n- d|\n", "more")).toBe(
      "- a\n\t- b\n\npara\n\n- c\n\t- d\n",
    );
  });

  it("falls through when the selection touches no list item at all", () => {
    expect(runSel("|plain one\nplain two|\n", "more").outcome).toBe("fallthrough");
  });
});

describe("listIndentChange — 选区保持与撤销粒度", () => {
  // Scenario: 变换后选区仍覆盖同一段文本
  it("keeps a multi-line selection covering the same text after indent", () => {
    const state = stateSel("- a\n- |b\n- c|\n");
    const res = listIndentChange(state, "more");
    if (!res || res.kind !== "change") throw new Error("expected a change result");
    const next = state.update(res.spec).state;
    const sel = next.selection.main;
    expect(sel.empty).toBe(false);
    expect(next.doc.sliceString(sel.from, sel.to)).toBe("b\n\t- c");
  });

  // design D5: every range is mapped, not just the main one
  it("keeps multiple cursors instead of collapsing to one", () => {
    const doc = "- a\n- b\n- c\n";
    const base = withCompleteTree(
      EditorState.create({
        doc,
        // Without this facet CodeMirror collapses a multi-range selection to its
        // main range on update — the extra cursors would never reach the command.
        extensions: [
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          EditorState.allowMultipleSelections.of(true),
        ],
      }),
    );
    const state = base.update({
      selection: EditorSelection.create(
        [
          EditorSelection.cursor(base.doc.line(2).to),
          EditorSelection.cursor(base.doc.line(3).to),
        ],
        1,
      ),
    }).state;
    const res = listIndentChange(state, "more");
    if (!res || res.kind !== "change") throw new Error("expected a change result");
    const next = state.update(res.spec).state;
    expect(next.selection.ranges.length).toBe(2);
    expect(next.selection.mainIndex).toBe(1);
    expect(next.doc.toString()).toBe("- a\n\t- b\n\t- c\n");
  });

  // Scenario: 批量变换是单一撤销单元
  it("undoes a whole multi-item batch in one step", () => {
    const state = stateSel("1. a\n2. |b\n3. c|\n", [history()]);
    const res = listIndentChange(state, "more");
    if (!res || res.kind !== "change") throw new Error("expected a change result");
    let s = state.update(res.spec).state;
    expect(s.doc.toString()).toBe("1. a\n\t1. b\n\t2. c\n");
    undo({ state: s, dispatch: (tr) => { s = tr.state; } });
    expect(s.doc.toString()).toBe("1. a\n2. b\n3. c\n");
  });
});

describe("listIndentChange — 空行不分列表(CommonMark)", () => {
  // Caught in manual test: a fixture assumed a blank line started a new list, so
  // "- x" looked like a first item that should not be able to indent. It isn't —
  // a blank line only makes the list LOOSE. `- x`'s previous sibling is `- c`,
  // so indenting it is correct. Pinned here so the next reader does not re-derive
  // it from intuition.
  it("treats blank-line-separated bullets as ONE list, so the later run can indent", () => {
    expect(docAfterSel("- a\n- b\n- c\n\n- |x\n- y|\n", "more")).toBe(
      "- a\n- b\n- c\n\n\t- x\n\t- y\n",
    );
  });

  it("a paragraph between them DOES split the list, restoring the first-item guard", () => {
    // now `- x` really is a first item: it stays put, `- y` nests under it
    expect(docAfterSel("- a\n- b\n\nsplit\n\n- |x\n- y|\n", "more")).toBe(
      "- a\n- b\n\nsplit\n\n- x\n\t- y\n",
    );
  });

  it("a different bullet char after a blank line also splits the list", () => {
    expect(docAfterSel("- a\n- b\n\n* |x\n* y|\n", "more")).toBe("- a\n- b\n\n* x\n\t* y\n");
  });

  // …but a different marker on the very next line is the same layer (Obsidian
  // treats `- b` / `1. x` as siblings; user's decision 2026-10-21, design D8).
  it("a different marker with no blank line is a sibling, so it can nest", () => {
    expect(docAfter("- a\n- b\n1. x|\n", "more")).toBe("- a\n- b\n\t1. x\n");
    expect(docAfter("- a\n- b\n* x|\n", "more")).toBe("- a\n- b\n\t* x\n");
  });
});

describe("listIndentChange — 缩进写法跟随列表(change: structure-keys, design D7)", () => {
  it("writes a tab character in a list that has no nesting yet", () => {
    expect(docAfter("1. a\n2. b|\n3. c\n", "more")).toBe("1. a\n\t1. b\n2. c\n");
  });

  it("keeps writing tabs in a tab-indented list", () => {
    expect(docAfter("- a\n\t- b\n\t- c|\n", "more")).toBe("- a\n\t- b\n\t\t- c\n");
  });

  it("copies the spaces a new sibling layer already uses", () => {
    expect(docAfter("- a\n    - b\n- c|\n", "more")).toBe("- a\n    - b\n    - c\n");
  });

  // The old rule normalized the whole block to 4 on the first Tab.
  it("does not rewrite a 2-space list's other lines", () => {
    expect(docAfter("- a\n  - b\n- c|\n", "more")).toBe("- a\n  - b\n  - c\n");
  });

  it("steps a new space layer by the parent layer's own step", () => {
    expect(docAfter("1. a\n   - b\n   - c|\n", "more")).toBe("1. a\n   - b\n      - c\n");
  });

  it("adds a second tab when one does not reach a wide marker's content", () => {
    expect(docAfter("100. a\n101. b|\n", "more")).toBe("100. a\n\t\t1. b\n");
  });

  // CommonMark reads a line indented 4+ past its parent's content column as an
  // indented code block, not a list item. Checked across marker widths, with
  // columns counted the CommonMark way (tab stop 4).
  it("never indents a child far enough to become an indented code block", () => {
    const parents: Array<{ src: string; contentCol: number }> = [
      { src: "- a\n- b|\n", contentCol: 2 },
      { src: "* a\n* b|\n", contentCol: 2 },
      { src: "1. a\n2. b|\n", contentCol: 3 },
      { src: "10. a\n11. b|\n", contentCol: 4 },
      { src: "100. a\n101. b|\n", contentCol: 5 },
      { src: "1000. a\n1001. b|\n", contentCol: 6 },
      { src: "10000. a\n10001. b|\n", contentCol: 7 },
    ];
    for (const { src, contentCol } of parents) {
      const childLine = docAfter(src, "more").split("\n")[1];
      const indent = columnOf(/^[ \t]*/.exec(childLine)![0]);
      expect(indent).toBeGreaterThanOrEqual(contentCol);
      expect(indent).toBeLessThan(contentCol + 4);
    }
  });
});
