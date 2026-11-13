import { describe, expect, it } from "vitest";
import { EditorState, type Extension, type Transaction, type TransactionSpec } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { dialectBase, dialectExtensions } from "./dialectParser";
import { blockDecorationField } from "./blocks/field";
import { livePreviewConfig } from "./previewConfig";
import { withCompleteTree } from "./syntax";
import { strandedIn, undoLandingOf } from "./caret";
import { activeEditField, setActiveEdit, tableInlineEdit } from "./tableInlineEdit";
import { activePropField, propAt, propertiesState, parsePropsOf, setActiveProp } from "./blocks/properties";

/**
 * The caret rules that can be decided without a view (spec: caret-rules):
 * where an undo lands (R2 / R2a — `undoLandingOf` on the real history's undo
 * transaction), and where the outer caret goes when a table cell or a property
 * is entered and left (R8 / R8a / R9). The view-side halves (applying the
 * landing, re-entering a part, navigateTo) are the harness case `caret-rules`.
 */

/** A live-preview state (blocks rendered, A blocks reveal on touch), complete tree. */
function live(doc: string, anchor = 0, extra: Extension = []): EditorState {
  return withCompleteTree(
    EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }),
        livePreviewConfig.of({ revealOnSelection: true, resolveImage: (s: string) => s }),
        history(),
        tableInlineEdit,
        propertiesState,
        blockDecorationField,
        extra,
      ],
    }),
  );
}

/** Source mode: no block field, nothing renders. */
function source(doc: string, anchor = 0): EditorState {
  return withCompleteTree(
    EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }), history()],
    }),
  );
}

/** The transaction the real history command dispatches. */
function historyTr(state: EditorState, cmd: typeof undo): Transaction {
  let out: Transaction | null = null;
  cmd({ state, dispatch: (tr) => (out = tr) });
  if (!out) throw new Error("nothing to undo");
  return out;
}

/** State after `cmd` with the landing rule applied (what the view plugin dispatches). */
function landed(state: EditorState, cmd: typeof undo): EditorState {
  const tr = historyTr(state, cmd);
  const land = undoLandingOf(tr);
  return land && !land.keep ? tr.state.update({ selection: { anchor: land.pos } }).state : tr.state;
}

/** Make an edit that does not move the caret (an image drag, a cell sync), then undo it. */
function editThenUndo(state: EditorState, spec: TransactionSpec): EditorState {
  const edited = state.update({ ...spec, userEvent: "input.resize" }).state;
  return landed(edited, undo);
}

const at = (s: EditorState) => s.selection.main.head;
const run = landed;

describe("undo landing (caret-rules R2)", () => {
  it("lands at the end of the undone change, not at history's old caret", () => {
    const doc = "alpha\n\nbeta gamma\n\n" + "filler\n".repeat(20);
    let s = live(doc, doc.indexOf("gamma"));
    s = s.update({ changes: { from: doc.indexOf("gamma"), insert: "new " }, selection: { anchor: doc.indexOf("gamma") + 4 }, userEvent: "input.type" }).state;
    s = s.update({ selection: { anchor: s.doc.length } }).state; // move far away
    // Undo restores the caret from before the typing — which was at the change: kept.
    s = run(s, undo);
    expect(s.doc.toString()).toBe(doc);
    expect(at(s)).toBe(doc.indexOf("gamma"));
  });

  it("moves the caret to the change when history's caret is elsewhere", () => {
    const doc = "one two\n\n" + "line\n".repeat(30);
    const s = editThenUndo(live(doc, doc.length), { changes: { from: 4, to: 7, insert: "TWO" } });
    expect(s.doc.toString()).toBe(doc);
    expect(at(s)).toBe(7); // end of the restored "two"
  });

  it("keeps history's selection when it is at the change (re-selected deleted text)", () => {
    const doc = "keep this text here";
    let s = live(doc, 0);
    s = s.update({ selection: { anchor: 5, head: 9 } }).state;
    s = s.update({ changes: { from: 5, to: 9 }, userEvent: "delete.selection" }).state;
    s = run(s, undo);
    expect(s.selection.main.from).toBe(5);
    expect(s.selection.main.to).toBe(9);
  });

  it("applies to redo too", () => {
    const doc = "a b c\n\n" + "x\n".repeat(10);
    let s = editThenUndo(live(doc, doc.length), { changes: { from: 2, to: 3, insert: "B" } });
    s = s.update({ selection: { anchor: s.doc.length } }).state;
    s = run(s, redo);
    expect(s.doc.sliceString(0, 5)).toBe("a B c");
    expect(at(s)).toBe(3);
  });

  it("leaves a non-history transaction alone", () => {
    const s = live("abc", 0);
    const tr = s.update({ changes: { from: 1, insert: "x" }, userEvent: "input.type" });
    expect(undoLandingOf(tr)).toBeNull();
  });
});

describe("undo landing in a table cell (caret-rules R2b)", () => {
  it("lands at the change end even though history's caret (the cell start) touches it", () => {
    const doc = "| a | b |\n| --- | --- |\n| c | d |\n\nafter";
    const cell = doc.indexOf("c |");
    let s = live(doc, cell); // R8 puts the outer caret at the cell's start
    s = s.update({ changes: { from: cell, to: cell + 1, insert: "e" }, userEvent: "input.type" }).state;
    const land = undoLandingOf(historyTr(s, undo));
    expect(land).toEqual({ pos: cell + 1, keep: false });
  });
});

describe("undo landing steps past touch-revealed widgets (caret-rules R2a)", () => {
  const img = "![方块|120](attachments/square.png)";

  it("an image on its own line: the start of the next line", () => {
    const doc = `intro\n\n${img}\n\nend`;
    const from = doc.indexOf("120");
    const s = editThenUndo(live(doc, doc.length), { changes: { from, to: from + 3, insert: "200" } });
    expect(s.doc.toString()).toBe(doc);
    expect(at(s)).toBe(doc.indexOf(img) + img.length + 1);
  });

  it("an image with text after it: one character past the image", () => {
    const doc = `前 ${img} 后\n\nmore`;
    const from = doc.indexOf("120");
    const s = editThenUndo(live(doc, doc.length), { changes: { from, to: from + 3, insert: "64" } });
    expect(at(s)).toBe(doc.indexOf(img) + img.length + 1);
  });

  it("inline math: past the formula", () => {
    const doc = "see $x^2$ here\n\nend";
    const from = doc.indexOf("2");
    const s = editThenUndo(live(doc, doc.length), { changes: { from, to: from + 1, insert: "3" } });
    expect(at(s)).toBe(doc.indexOf("$ here") + 2);
  });

  it("block math: the line after the block", () => {
    const doc = "top\n\n$$\nx^2\n$$\nafter";
    const from = doc.indexOf("2");
    const s = editThenUndo(live(doc, doc.length), { changes: { from, to: from + 1, insert: "3" } });
    expect(at(s)).toBe(doc.indexOf("after"));
  });

  it("an image at the very end of the document: its end (nothing after it)", () => {
    const doc = `intro\n\n${img}`;
    const from = doc.indexOf("120");
    const s = editThenUndo(live(doc, 0), { changes: { from, to: from + 3, insert: "200" } });
    expect(at(s)).toBe(doc.length);
  });

  it("source mode renders nothing: lands at the change itself", () => {
    const doc = `intro\n\n${img}\n\nend`;
    const from = doc.indexOf("120");
    const s = editThenUndo(source(doc, doc.length), { changes: { from, to: from + 3, insert: "200" } });
    expect(at(s)).toBe(from + 3);
  });
});

const TABLE = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\nafter";

describe("table cell enter / exit caret (caret-rules R8 / R8a)", () => {
  it("entering a cell puts the outer caret at the cell's source start", () => {
    const s = live(TABLE, 0);
    const from = TABLE.indexOf("| a");
    const next = s.update({ effects: setActiveEdit.of({ tableFrom: from, row: 2, col: 1 }) }).state;
    expect(at(next)).toBe(TABLE.indexOf("4"));
  });

  it("a landing named by the entering transaction is kept", () => {
    const s = live(TABLE, 0);
    const from = TABLE.indexOf("| a");
    const next = s.update({ effects: setActiveEdit.of({ tableFrom: from, row: 1, col: 0 }), selection: { anchor: 2 } }).state;
    expect(at(next)).toBe(2);
  });

  it("ending the edit with the caret still in the table moves it to the line after", () => {
    const from = TABLE.indexOf("| a");
    let s = live(TABLE, 0);
    s = s.update({ effects: setActiveEdit.of({ tableFrom: from, row: 1, col: 0 }) }).state;
    expect(s.field(activeEditField)).not.toBeNull();
    s = s.update({ effects: setActiveEdit.of(null) }).state;
    // Leaving also re-aligns the table (`- ` → `---`): read the landing in the result.
    expect(s.doc.toString()).not.toBe(TABLE);
    expect(at(s)).toBe(s.doc.toString().indexOf("\n\nafter") + 1);
  });

  it("ending the edit with the caret elsewhere leaves it there", () => {
    const from = TABLE.indexOf("| a");
    let s = live(TABLE, 0);
    s = s.update({ effects: setActiveEdit.of({ tableFrom: from, row: 1, col: 0 }) }).state;
    s = s.update({ selection: { anchor: 1 } }).state;
    s = s.update({ effects: setActiveEdit.of(null) }).state;
    expect(at(s)).toBe(1);
  });
});

const PROPS = "---\ntitle: 旧标题\nstatus: draft\n---\n\nbody";

describe("properties enter / exit caret (caret-rules R9)", () => {
  it("entering a value puts the outer caret at the value's source start", () => {
    const s = live(PROPS, PROPS.length).update({ effects: setActiveProp.of({ index: 1, part: "value" }) }).state;
    expect(at(s)).toBe(PROPS.indexOf("draft"));
  });

  it("entering a name puts it at the name's start", () => {
    const s = live(PROPS, PROPS.length).update({ effects: setActiveProp.of({ index: 0, part: "key" }) }).state;
    expect(at(s)).toBe(PROPS.indexOf("title"));
  });

  it("ending the edit moves the caret to the line after the closing ---", () => {
    let s = live(PROPS, PROPS.length).update({ effects: setActiveProp.of({ index: 0, part: "value" }) }).state;
    expect(s.field(activePropField)).not.toBeNull();
    s = s.update({ effects: setActiveProp.of(null) }).state;
    expect(at(s)).toBe(PROPS.indexOf("\n\nbody") + 1);
  });
});

describe("propAt — the part an undo landing re-enters (caret-rules R2b)", () => {
  const p = parsePropsOf(live(PROPS))!;
  it("a value offset is that value", () => {
    expect(propAt(p, PROPS.indexOf("draft") + 2)).toEqual({ index: 1, part: "value" });
  });
  it("a name offset is that name", () => {
    expect(propAt(p, PROPS.indexOf("status") + 1)).toEqual({ index: 1, part: "key" });
  });
  it("the opening fence goes to the first row", () => {
    expect(propAt(p, 1)).toEqual({ index: 0, part: "key" });
  });
});

describe("R2c · a caret stranded inside a B block re-enters it (strandedIn)", () => {
  const TABLE = "| a | b |\n| - | - |\n| 1 | 2 |\n";
  const DOC = `${TABLE}\n[Docs](x)\n\n## Next\n`;
  const blank = TABLE.length; // the blank line right under the table

  it("typing on the line right under a table (which GFM makes a row) leaves the caret in that row's cell", () => {
    const before = live(DOC, blank);
    expect(strandedIn(before)).toBeNull();
    const after = withCompleteTree(before.update({ changes: { from: blank, insert: "N" }, selection: { anchor: blank + 1 }, userEvent: "input.type" }).state);
    const hit = strandedIn(after);
    expect(hit).not.toBeNull();
    expect(hit!.block.id).toBe("table");
    expect(hit!.pos).toBe(blank + 1);
  });

  it("a caret on the table's END edge is stranded too (drawn after the widget, it would type on the next line)", () => {
    const hit = strandedIn(live(DOC, TABLE.length - 1));
    expect(hit?.block.id).toBe("table");
    expect(hit?.pos).toBe(TABLE.length - 1);
  });

  it("is null at the table's start, on the line after it, with a cell open, and in source mode", () => {
    expect(strandedIn(live(DOC, 0))).toBeNull();
    expect(strandedIn(live(DOC, TABLE.length))).toBeNull();
    const inside = live(DOC, 3);
    const open = inside.update({ effects: setActiveEdit.of({ tableFrom: 0, row: 0, col: 0 }) }).state;
    expect(strandedIn(open)).toBeNull();
    expect(strandedIn(source(DOC, 3))).toBeNull();
  });
});
