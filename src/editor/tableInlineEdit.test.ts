import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { CELL_SYNC_USER_EVENT } from "./tableEdit";
import {
  activeEditField,
  cellSync,
  isolateHistoryOnSessionChange,
  setActiveEdit,
} from "./tableInlineEdit";

/**
 * The view-state behind in-place cell editing (change: table-cell-edit-undo).
 *
 * The `epoch` is what tells the open `<input>` that something OTHER than its own
 * typing rewrote the cell — an undo, an agent edit, an external file sync, a
 * structural command. Without it the input keeps showing (and writing from) text
 * the document no longer has, and the next keystroke runs past the cell's pipes
 * and eats its neighbour. `TableWidget.eq` reads it; these tests pin the rule.
 */

// A heading above the table on purpose: a table at offset 0 is an artificial
// edge (an insert AT the table's start associates backwards and a whole-doc
// replace does not read as "deleted"), and a real document has something above.
const DOC = ["# t", "", "| A | B |", "| :-- | --: |", "| 1 | 2 |", ""].join("\n");
const TABLE_FROM = DOC.indexOf("| A |");
const CELL_1 = DOC.indexOf("| 1 |") + 2; // the "1" cell's content offset

function seeded(doc = DOC) {
  let state = EditorState.create({
    doc,
    extensions: [activeEditField, isolateHistoryOnSessionChange, history()],
  });
  const apply = (spec: TransactionSpec) => {
    state = state.update(spec).state;
    return state;
  };
  apply({ effects: setActiveEdit.of({ tableFrom: TABLE_FROM, row: 1, col: 0 }) });
  return { get state() { return state; }, apply };
}

describe("activeEditField — epoch marks changes the cell input did not make", () => {
  it("starts a session at a defined epoch", () => {
    const s = seeded();
    expect(s.state.field(activeEditField)).toMatchObject({ tableFrom: TABLE_FROM, row: 1, col: 0 });
    expect(typeof s.state.field(activeEditField)!.epoch).toBe("number");
  });

  it("does not bump epoch for the input's own per-keystroke sync", () => {
    const s = seeded();
    const before = s.state.field(activeEditField)!.epoch;
    s.apply({
      changes: { from: CELL_1, to: CELL_1 + 1, insert: "1x" },
      userEvent: CELL_SYNC_USER_EVENT,
      annotations: cellSync.of(true),
    });
    expect(s.state.field(activeEditField)!.epoch).toBe(before);
  });

  it("bumps epoch for a doc change the input did not make", () => {
    const s = seeded();
    const before = s.state.field(activeEditField)!.epoch;
    s.apply({ changes: { from: 0, insert: "intro\n\n" } }); // e.g. an agent edit above
    expect(s.state.field(activeEditField)!.epoch).toBe(before + 1);
  });

  it("keeps pointing at the same table when an edit above shifts it", () => {
    const s = seeded();
    s.apply({ changes: { from: 0, insert: "intro\n\n" } });
    expect(s.state.field(activeEditField)!.tableFrom).toBe(TABLE_FROM + "intro\n\n".length);
  });

  it("ends the session when the table itself is deleted", () => {
    const s = seeded();
    s.apply({ changes: { from: 0, to: DOC.length, insert: "gone\n" } });
    expect(s.state.field(activeEditField)).toBeNull();
  });

  it("carries the epoch across a cell switch so a revisited cell is never stale", () => {
    const s = seeded();
    s.apply({ changes: { from: 0, insert: "x" } }); // foreign → epoch 1
    const bumped = s.state.field(activeEditField)!.epoch;
    s.apply({ effects: setActiveEdit.of({ tableFrom: TABLE_FROM + 1, row: 1, col: 1 }) });
    expect(s.state.field(activeEditField)!.epoch).toBe(bumped);
  });
});

describe("isolateHistoryOnSessionChange — a cell switch is an undo boundary", () => {
  it("keeps two cells' typing as two undo units", () => {
    const s = seeded();
    const type = (at: number, text: string) =>
      s.apply({
        changes: { from: at, insert: text },
        userEvent: CELL_SYNC_USER_EVENT,
        annotations: cellSync.of(true),
      });

    type(CELL_1, "aa");
    s.apply({ effects: setActiveEdit.of({ tableFrom: TABLE_FROM, row: 1, col: 1 }) });
    type(CELL_1 + 2, "bb"); // adjacent on purpose — without isolation these join

    const start = DOC;
    let state = s.state;
    let presses = 0;
    while (state.doc.toString() !== start && presses < 8) {
      const before = state;
      undo({ state, dispatch: (tr) => void (state = tr.state) });
      presses++;
      if (state === before) break;
    }
    expect(presses).toBe(2);
  });
});
