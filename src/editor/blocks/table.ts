import { imageEpoch } from "../imageRefresh";
import type { EditorView } from "@codemirror/view";
import { TableWidget } from "../widgets";
import { isMathReady } from "../math";
import { cellSourceRange, locateCell, parseTable } from "../tableEdit";
import { activeEditField, setActiveEdit } from "../tableInlineEdit";
import { nearestIndex } from "./geometry";
import { partEditorIn, placePartCaret } from "./partEditor";
import type { BlockEntry } from "./types";

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
    if (!parseTable(source, node.from)) return null;
    // Which cell (if any) is being edited in THIS table — drives the in-place
    // input and the widget's `eq` (DOM stability during edit).
    const edit = state.field(activeEditField, false);
    const editing =
      edit && edit.tableFrom === node.from
        ? { row: edit.row, col: edit.col, epoch: edit.epoch }
        : null;
    return new TableWidget(source, node.from, editing, isMathReady(), imageEpoch(state));
  },
  enter: (view, block, edge, x) => {
    const model = parseTable(view.state.sliceDoc(block.from, block.to), block.from);
    if (!model || model.rows.length === 0) return;
    const row = edge === "top" ? 0 : model.rows.length - 1;
    const cols = model.rows[row].cells.length;
    const col = x == null ? 0 : nearestIndex(cellCenters(view, block.from, row), x, cols);
    view.dispatch({ effects: setActiveEdit.of({ tableFrom: block.from, row, col }) });
  },
  // An undo landed in this table (spec: caret-rules R2b): edit the cell holding
  // `pos`, its caret at the change; the outer caret stays at `pos`.
  enterAt: (view, block, pos) => {
    const model = parseTable(view.state.sliceDoc(block.from, block.to), block.from);
    if (!model || model.rows.length === 0) return;
    const { row, col } = locateCell(model, pos);
    const cell = cellSourceRange(model, row, col);
    if (!cell) return;
    const caret = Math.max(0, Math.min(pos, cell.to) - cell.from);
    const edit = view.state.field(activeEditField, false);
    if (edit && edit.tableFrom === block.from && edit.row === row && edit.col === col) {
      // That very cell is open (the undo was pressed in it): just place its caret.
      const part = tableWrap(view, block.from);
      const editor = part ? partEditorIn(part) : undefined;
      if (editor) return placePartCaret(editor, caret);
    }
    view.dispatch({ effects: setActiveEdit.of({ tableFrom: block.from, row, col, caret }), selection: { anchor: pos } });
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
