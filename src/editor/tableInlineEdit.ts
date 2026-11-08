import {
  Annotation,
  EditorState,
  MapMode,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { cellSourceRange, parseTable, reflowChangeIfNeeded } from "./tableEdit";
import { tableRangeAt } from "./tableCommands";
import { lineAfterBlock } from "./blocks/geometry";

/**
 * In-place table cell editing (change: table-inline-cell-editing).
 *
 * The interaction contract changed from "click a rendered table → revert the
 * WHOLE table to pipe source" to "click a cell → edit only THAT cell in place"
 * (spec: 单元格原位编辑). This module owns the view-state that drives it:
 *
 *   - `activeEditField` — which table + cell is currently being edited, or null.
 *     `TableWidget` reads it (via livePreview's block field) to render one cell as
 *     a part editor (`blocks/partEditor.ts`) while keeping the rest of the grid rendered, and keys its `eq`
 *     on it so per-keystroke sync transactions DON'T tear the widget down
 *     (preserving focus + IME; design D3).
 *   - `tableReflowOnEditEnd` — column re-alignment is DEFERRED to session end
 *     (spec: 离开时自动对齐 / 不逐键重排). Fires when the edit session leaves a
 *     table (activeEdit → null or a different table), appending a canonical reflow
 *     to that same transaction — atomic, idempotent (no change / no autosave /
 *     no empty undo when already aligned). Replaces the old selection-based
 *     `tableReflowOnLeave` trigger (the caret no longer enters table source).
 *   - `exitEditOnOutsideClick` — a mousedown anywhere outside a table ends the
 *     session (commit is already live; reflow rides the same clear). Clicks on a
 *     table cell are left to the widget's own handler (enter / switch cell).
 */

/** Which cell a caller wants edited — what `setActiveEdit` carries. */
export interface ActiveEditTarget {
  /** Doc offset of the edited table's start (mapped through edits). */
  tableFrom: number;
  /** Grid position of the edited cell: row over header+body, col over cells. */
  row: number;
  col: number;
  /**
   * Where the caret lands on entry; default end. ← arriving from the right lands
   * at the end, → arriving from the left at the start (spec: 格内方向键换格); a
   * number is an offset into the cell (an undo landing, caret-rules R2b). Read
   * once when the cell editor is built; not part of the widget's identity.
   */
  caret?: "start" | "end" | number;
}

export interface ActiveEdit extends ActiveEditTarget {
  /**
   * Counts the doc changes this session did NOT make (change: table-cell-edit-undo).
   *
   * The open cell editor (`blocks/partEditor.ts`) holds its own copy of the cell's text;
   * nothing tells it when an undo / redo, an agent edit, an external file sync or a
   * structural command rewrites that cell underneath it. `TableWidget.eq` reads this
   * counter, so a foreign change makes the widget unequal and CodeMirror calls
   * `updateDOM`, which re-seeds the cell editor in place (keeping focus and IME alive —
   * it is NOT rebuilt). The cell editor's own per-keystroke sync is annotated
   * `cellSync` and deliberately does NOT bump it, or every keystroke would re-seed
   * the field and stomp the caret mid-word.
   */
  epoch: number;
}

/** Set (or clear, with null) the active in-place cell edit. */
export const setActiveEdit = StateEffect.define<ActiveEditTarget | null>();

/** Marks the transactions the active cell input dispatches for its own typing. */
export const cellSync = Annotation.define<boolean>();

export const activeEditField = StateField.define<ActiveEdit | null>({
  create: () => null,
  update(value, tr) {
    let next: ActiveEdit | null = value;
    for (const e of tr.effects) {
      if (e.is(setActiveEdit)) {
        // Epoch carries ACROSS a cell switch rather than resetting: leaving a cell
        // and coming back to it after a foreign change must not reproduce the
        // widget's previous identity, or `eq` would reuse the stale DOM.
        next = e.value ? { ...e.value, epoch: value?.epoch ?? 0 } : null;
      }
    }
    if (!next || !tr.docChanged) return next;
    // Keep pointing at the same table when edits above shift it. Cell edits sit
    // after tableFrom, so this is a no-op for the common in-cell case; it only
    // matters when an external/agent edit lands earlier in the doc. TrackDel: if
    // the table itself was deleted (delete the last column, an external rewrite),
    // there is no cell left to edit — end the session rather than point at nothing.
    // With a MapMode, mapPos returns null (NOT -1) for a deleted position.
    const tableFrom = tr.changes.mapPos(next.tableFrom, -1, MapMode.TrackDel);
    if (tableFrom === null) return null;
    return { ...next, tableFrom, epoch: next.epoch + (tr.annotation(cellSync) ? 0 : 1) };
  },
});

/**
 * Starting, switching or ending a cell edit is an undo boundary (change:
 * table-cell-edit-undo / design D5).
 *
 * Once the per-keystroke sync became joinable (`CELL_SYNC_USER_EVENT`), typing in
 * one cell and then in an ADJACENT one could merge into a single undo unit — two
 * cells, one `Cmd+Z`, which is not the step the user took. Stamping every
 * session-boundary transaction isolates history on both sides. Central on purpose:
 * every entry point (widget click, Tab/Enter nav, Esc, click outside, the
 * structural commands) goes through this one effect.
 */
export const isolateHistoryOnSessionChange: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.effects.some((e) => e.is(setActiveEdit))) return tr;
  return [tr, { annotations: isolateHistory.of("full") }];
});

/**
 * Reflow the table an edit session just left (design D2 / spec: 结束编辑会话时
 * 自动对齐). A transactionFilter so the reflow rides the very transaction that
 * clears / switches `activeEdit` — atomic, idempotent, readOnly-exempt.
 */
export const tableReflowOnEditEnd: Extension = EditorState.transactionFilter.of((tr) => {
  let leaving = false;
  let next: ActiveEditTarget | null = null;
  for (const e of tr.effects) {
    if (e.is(setActiveEdit)) {
      leaving = true;
      next = e.value;
    }
  }
  if (!leaving) return tr;
  const prev = tr.startState.field(activeEditField, false);
  if (!prev) return tr; // wasn't editing → nothing to reflow
  if (next && next.tableFrom === prev.tableFrom) return tr; // staying in the same table (cell nav)
  if (tr.startState.readOnly) return tr;
  const range = tableRangeAt(tr.startState, prev.tableFrom);
  if (!range) return tr;
  const reflow = reflowChangeIfNeeded(tr.startState.sliceDoc(range.from, range.to), range.from);
  if (!reflow) return tr; // already canonical — no empty change / no autosave churn
  // `"input"` deliberately, not `CELL_SYNC_USER_EVENT`: history does not join a
  // bare `"input"`, and the reflow should stay its own undo step rather than merge
  // with the typing that preceded it (change: table-cell-edit-undo).
  return [tr, { changes: reflow, userEvent: "input" }];
});

/**
 * Where the OUTER caret is while a cell is edited, and where it goes when the
 * edit ends (spec: caret-rules R8 / R8a). Central on purpose, like the history
 * isolation above: every entry and exit goes through `setActiveEdit`.
 *
 * - Entering a cell without a landing of its own puts the outer caret at that
 *   cell's source start, in the same transaction — a table is a B block, so the
 *   caret inside its source does not reveal it, and "where the user is" (read by
 *   the agent, the outline, the remembered position) is that cell.
 * - Ending the edit without a landing of its own, while the outer caret is still
 *   inside the table, moves it to the start of the line after the table: a
 *   caret left in the table's source would type straight into its pipes. Esc
 *   names its own landing (the same line, scrolled into view); a click outside
 *   is followed by the click's own caret.
 */
export const tableCaret: Extension = EditorState.transactionFilter.of((tr) => {
  let target: ActiveEditTarget | null | undefined;
  for (const e of tr.effects) if (e.is(setActiveEdit)) target = e.value;
  if (target === undefined || tr.selection) return tr;
  if (target) {
    // The effect speaks the start document; the cell is read in the new one.
    const state = tr.docChanged ? tr.state : tr.startState;
    const range = tableRangeAt(state, tr.changes.mapPos(target.tableFrom, -1));
    const parsed = range ? parseTable(state.sliceDoc(range.from, range.to), range.from) : null;
    const cell = parsed ? cellSourceRange(parsed, target.row, target.col) : null;
    if (!cell) return tr;
    return [tr, { selection: { anchor: cell.from }, sequential: true }];
  }
  const prev = tr.startState.field(activeEditField, false);
  const range = prev ? tableRangeAt(tr.startState, prev.tableFrom) : null;
  if (!range) return tr;
  const from = tr.changes.mapPos(range.from, 1);
  const to = tr.changes.mapPos(range.to, -1);
  const head = tr.changes.mapPos(tr.startState.selection.main.head, -1);
  if (to <= from || head < from || head > to) return tr;
  return [tr, { selection: { anchor: lineAfterBlock(tr.newDoc, to) }, sequential: true }];
});

/**
 * End the edit session when the user clicks outside any table. Clicks landing on
 * a table cell / its input are left alone — the widget's own mousedown enters or
 * switches the cell (and cross-table switches reflow via the filter above). The
 * clear is not consumed, so the click still drops the caret where it landed.
 */
export const exitEditOnOutsideClick: Extension = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (!view.state.field(activeEditField, false)) return false;
    const target = e.target as HTMLElement | null;
    if (target && (target.closest(".om-table-cell-input") || target.closest(".om-table-wrap"))) {
      return false;
    }
    view.dispatch({ effects: setActiveEdit.of(null) });
    return false;
  },
});

/**
 * End an in-place cell edit, through the same exit a click outside the table
 * takes (reflow included). The tab switch calls it before parking a state
 * (change: tab-state): the nested cell editor's DOM goes with the view update,
 * so a parked state must not still say "editing".
 */
export function endInlineEdit(view: EditorView): void {
  if (view.state.field(activeEditField, false)) view.dispatch({ effects: setActiveEdit.of(null) });
}

export const tableInlineEdit: Extension = [
  activeEditField,
  isolateHistoryOnSessionChange,
  tableReflowOnEditEnd,
  tableCaret,
  exitEditOnOutsideClick,
];
