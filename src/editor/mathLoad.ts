import type { EditorView } from "@codemirror/view";
import { ensureMath, mathReadyEffect } from "./math";

/**
 * Start the formula converter's one-time load for `view`, and redraw `view` once
 * it has: `mathReadyEffect` rebuilds the inline plugin and the block field, so
 * every formula seen as source — in the body or in a table cell — swaps to the
 * formula. The one place this wiring lives (change: cell-tree).
 */
export function loadMathThenRedraw(view: EditorView): void {
  ensureMath(() => {
    // The load resolves async — the editor may have been torn down since.
    try {
      view.dispatch({ effects: mathReadyEffect.of(null) });
    } catch {
      /* view destroyed before the converter finished loading — ignore */
    }
  });
}
