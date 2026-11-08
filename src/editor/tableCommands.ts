import { EditorState, type TransactionSpec } from "@codemirror/state";
import { treeUpTo } from "./syntax";
import type { SyntaxNode } from "@lezer/common";
import { tableCellNav } from "./tableEdit";

/**
 * Thin CM6 wiring for the pure table core (change: smart-table-editing). The
 * syntax tree is used ONLY to locate the enclosing `Table` node; all editing
 * logic lives in the pure, unit-tested `tableEdit.ts`; the structure entry binds
 * the keys.
 */

/** Range of the GFM `Table` node enclosing `pos`, or null. */
export function tableRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  // Try both biases so a cursor sitting at either edge of the table still resolves.
  for (const bias of [-1, 1] as const) {
    let node: SyntaxNode | null = treeUpTo(state, pos).resolveInner(pos, bias);
    while (node && node.name !== "Table") node = node.parent;
    if (node) return { from: node.from, to: node.to };
  }
  return null;
}

/**
 * Source-mode Tab / Shift-Tab in a table: the next / previous cell, appending a
 * row past the last cell. `noop` (Shift-Tab at the first cell) still takes the
 * key; `null` means the caret is not in a table. Called by the structure entry
 * (`structure/index.ts`).
 */
export function tableNavChange(
  state: EditorState,
  dir: "next" | "prev",
): { kind: "change"; spec: TransactionSpec } | { kind: "noop" } | null {
  if (state.readOnly) return null;
  if (state.selection.ranges.length !== 1) return null; // single caret only
  const cursor = state.selection.main.head;
  const range = tableRangeAt(state, cursor);
  if (!range) return null;
  const res = tableCellNav(state.sliceDoc(range.from, range.to), range.from, cursor, dir);
  if (!res) return null;
  if (res.kind === "noop") return { kind: "noop" };
  if (res.kind === "move") {
    return { kind: "change", spec: { selection: { anchor: res.anchor, head: res.head }, scrollIntoView: true } };
  }
  // kind === "change": Tab past the last cell appended a row — one undo unit.
  return {
    kind: "change",
    spec: {
      changes: { from: res.from, to: res.to, insert: res.insert },
      selection: { anchor: res.anchor, head: res.head },
      scrollIntoView: true,
      userEvent: "input",
    },
  };
}

// Auto-align on leave moved to `tableInlineEdit.ts` (change: table-inline-cell-editing):
// the caret no longer enters table source, so reflow is now keyed on the in-place
// edit session ending (activeEdit → null / a different table) rather than a caret
// selection leaving the table range.
