import { imageEpoch } from "../imageRefresh";
import type { EditorState, Transaction, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import type { CellMark, TableCellMark } from "../inlineCell";
import { TableWidget } from "../widgets";
import { mathState } from "../math";
import { cellSourceRange, locateCell, parseTable, type ParsedTable } from "../tableEdit";
import { activeEditField, setActiveEdit } from "../tableInlineEdit";
import { nearestIndex } from "./geometry";
import { partEditorIn, placePartCaret, type PartCaret } from "./partEditor";
import type { BlockEntry, BlockRange } from "./types";

/**
 * GFM table — B. ALWAYS renders as a widget (no touch-to-revert): editing is
 * per-cell in place (change: table-inline-cell-editing; spec: 单元格原位编辑).
 */
export const tableEntry: BlockEntry = {
  id: "table",
  mode: "B",
  node: "Table",
  range: (_state, node) => ({ from: node.from, to: node.to }),
  widget: (state, node) => {
    const source = state.sliceDoc(node.from, node.to);
    // An unparseable table degrades to source display (spec: 畸形表降级为源码).
    const model = parseTable(source, node.from);
    if (!model) return null;
    // Which cell (if any) is being edited in THIS table — drives the in-place
    // input and the widget's `eq` (DOM stability during edit).
    const edit = state.field(activeEditField, false);
    const editing =
      edit && edit.tableFrom === node.from
        ? { row: edit.row, col: edit.col, epoch: edit.epoch }
        : null;
    return new TableWidget(source, node.from, editing, mathState(), imageEpoch(state), tableMarks(state, model));
  },
  // The table paints the landing in the cell that holds it (spec: caret-rules /
  // 落点看得见, outcome 2): the open cell's own editor, or the marks below.
  paintsLanding: (state, block) => tableLandingPainted(state, block),
  redrawOn: (tr) => findChanged(tr),
  partAt: (state, block, pos) => tableCellAt(state, block, pos),
  enter: (view, block, edge, x) => {
    const model = parseTable(view.state.sliceDoc(block.from, block.to), block.from);
    if (!model || model.rows.length === 0) return;
    const row = edge === "top" ? 0 : model.rows.length - 1;
    const cols = model.rows[row].cells.length;
    const col = x == null ? 0 : nearestIndex(cellCenters(view, block.from, row), x, cols);
    view.dispatch({ effects: setActiveEdit.of({ tableFrom: block.from, row, col }) });
  },
  // An undo landed in this table (spec: caret-rules R2b), or a caret / a
  // selection was stranded in it (R2c): edit the cell holding it, the same
  // caret or text selected in the cell; the outer selection stays.
  enterAt: (view, block, pos, head) => {
    const entry = tableEntryAt(view.state, block, pos, head);
    if (!entry) return;
    if (entry.open) {
      // That very cell is open (the undo was pressed in it): just place its caret.
      const part = tableWrap(view, block.from);
      const editor = part ? partEditorIn(part) : undefined;
      if (editor) return placePartCaret(editor, entry.caret);
    }
    view.dispatch(entry.spec);
  },
  leave: (state) => (state.field(activeEditField, false) ? [setActiveEdit.of(null)] : []),
};

/** The rendered table widget that starts at `from`. */
function tableWrap(view: EditorView, from: number): HTMLElement | null {
  for (const wrap of view.contentDOM.querySelectorAll<HTMLElement>(".om-table-wrap")) {
    if (view.posAtDOM(wrap) === from) return wrap;
  }
  return null;
}

/** Horizontal centres of one rendered row's cells, read off the widget DOM. */
function cellCenters(view: EditorView, from: number, row: number): number[] {
  const wrap = tableWrap(view, from);
  if (!wrap) return [];
  return [...wrap.querySelectorAll<HTMLElement>(`[data-om-row="${row}"]`)].map((cell) => {
    const r = cell.getBoundingClientRect();
    return r.left + r.width / 2;
  });
}

/**
 * Entering the cell of `block` that holds `anchor` (and `head`, when a range is
 * given — the caller keeps both in one cell): the transaction that opens it with
 * the same caret / selection, and whether that cell is open already. Pure, so the
 * landing gate replays the very entry (`landing.gate.test.ts`).
 */
export function tableEntryAt(
  state: EditorState,
  block: { from: number; to: number },
  anchor: number,
  head: number = anchor,
): { spec: TransactionSpec; caret: PartCaret; open: boolean } | null {
  const model = parseTable(state.sliceDoc(block.from, block.to), block.from);
  if (!model || model.rows.length === 0) return null;
  const { row, col } = locateCell(model, anchor);
  const cell = cellSourceRange(model, row, col);
  if (!cell) return null;
  const rel = (p: number) => Math.max(0, Math.min(p, cell.to) - cell.from);
  const caret: PartCaret = head === anchor ? rel(anchor) : { anchor: rel(anchor), head: rel(head) };
  const edit = state.field(activeEditField, false);
  const open = !!edit && edit.tableFrom === block.from && edit.row === row && edit.col === col;
  return {
    spec: { effects: setActiveEdit.of({ tableFrom: block.from, row, col, caret }), selection: { anchor, head } },
    caret,
    open,
  };
}

/** The part of `block` (a cell's source range) holding `pos`, or null (a pipe, the delimiter row). */
export function tableCellAt(state: EditorState, block: { from: number; to: number }, pos: number): { from: number; to: number } | null {
  const model = parseTable(state.sliceDoc(block.from, block.to), block.from);
  if (!model) return null;
  for (const row of model.rows) for (const cell of row.cells) if (cell.from <= pos && pos <= cell.to) return { from: cell.from, to: cell.to };
  return null;
}

/** Did the Find state a table paints change (the panel opened / closed, the query changed while open)? */
function findChanged(tr: Transaction): boolean {
  const was = searchPanelOpen(tr.startState);
  const is = searchPanelOpen(tr.state);
  return was !== is || (is && getSearchQuery(tr.startState) !== getSearchQuery(tr.state));
}

/**
 * What a table paints in its cells (change: caret-landing-visible, design D3):
 * every Find match inside it while the Find panel is open (the one equal to the
 * main selection as the current match), and the main selection when it is not
 * that match. Scanned over the table's own range only; a match or selection
 * running across cells is painted on each cell's part. Offsets cell-relative.
 */
export function tableMarks(state: EditorState, model: ParsedTable): TableCellMark[] {
  const ranges: { from: number; to: number; kind: CellMark["kind"] }[] = [];
  const sel = state.selection.main;
  let current = false;
  if (searchPanelOpen(state)) {
    const query = getSearchQuery(state);
    if (query.valid) {
      const cursor = query.getCursor(state, model.from, model.to);
      for (let m = cursor.next(); !m.done; m = cursor.next()) {
        const isCurrent = m.value.from === sel.from && m.value.to === sel.to;
        current ||= isCurrent;
        ranges.push({ ...m.value, kind: isCurrent ? "current" : "match" });
      }
    }
  }
  if (!sel.empty && !current && sel.from < model.to && sel.to > model.from) ranges.push({ from: sel.from, to: sel.to, kind: "selection" });
  const out: TableCellMark[] = [];
  model.rows.forEach((row, ri) =>
    row.cells.forEach((cell, ci) => {
      for (const r of ranges) {
        const from = Math.max(r.from, cell.from);
        const to = Math.min(r.to, cell.to);
        if (from < to) out.push({ row: ri, col: ci, from: from - cell.from, to: to - cell.from, kind: r.kind });
      }
    }),
  );
  return out;
}

/**
 * Does this table, as built for `state`, draw the landing inside it? A caret:
 * the open cell holds it (the cell's own editor draws it). A range: the marks
 * paint some of it as the current match or the selection. False when no cell
 * text is painted (a match on a pipe or the delimiter row: marks clip to cell
 * text) — the block field then marks the whole table (outcome 3).
 */
export function tableLandingPainted(state: EditorState, block: BlockRange): boolean {
  const model = parseTable(state.sliceDoc(block.from, block.to), block.from);
  if (!model) return false;
  const sel = state.selection.main;
  if (sel.empty) {
    const edit = state.field(activeEditField, false);
    const cell = edit && edit.tableFrom === block.from ? cellSourceRange(model, edit.row, edit.col) : null;
    return !!cell && cell.from <= sel.head && sel.head <= cell.to;
  }
  return tableMarks(state, model).some((m) => m.kind !== "match");
}
