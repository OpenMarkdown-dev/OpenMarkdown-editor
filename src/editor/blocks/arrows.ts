import { Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { blockRanges } from "./field";
import { crossedBlock } from "./geometry";
import { blockEntry } from "./registry";

/**
 * ↑ / ↓ into and out of blocks (spec: block-editing / 方向键进出块; design D2).
 *
 * Only the step that would jump OVER an A / B block is intercepted — every other
 * vertical move is left to CodeMirror. A: the caret lands on the block's first
 * (↓) or last (↑) source line, which is inside the block, so the framework
 * reveals it. B: the entry picks the nearest editable part on that edge.
 */
function moveAcross(view: EditorView, forward: boolean): boolean {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length > 1) return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const target = view.moveVertically(sel, forward).head;
  const block = crossedBlock(blockRanges(state), sel.head, target, forward);
  if (!block) return false;

  if (block.mode === "A") {
    const line = state.doc.lineAt(forward ? block.from : block.to);
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  const entry = blockEntry(block.id);
  if (!entry?.enter) return false;
  entry.enter(view, block, forward ? "top" : "bottom", view.coordsAtPos(sel.head)?.left ?? null);
  return true;
}

export const blockArrowKeymap = Prec.high(
  keymap.of([
    { key: "ArrowDown", run: (v) => moveAcross(v, true) },
    { key: "ArrowUp", run: (v) => moveAcross(v, false) },
  ]),
);
