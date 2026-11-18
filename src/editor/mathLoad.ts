import type { EditorView } from "@codemirror/view";
import { ensureMath, mathLoader, mathNeedsLoad, mathReadyEffect } from "./math";

/**
 * Start the built-in formula converter's one-time load for `view` (when it is the one `view` draws with), and redraw `view` once
 * it has: `mathReadyEffect` rebuilds the inline plugin and the block field, so
 * every formula seen as source — in the body or in a table cell — swaps to the
 * formula. The one place this wiring lives (change: cell-tree).
 */
export function loadMathThenRedraw(view: EditorView): void {
  const load = view.state.facet(mathLoader);
  if (!load || !mathNeedsLoad(view.state)) return;
  ensureMath(load, () => {
    // The load resolves async — the editor may have been torn down since.
    try {
      view.dispatch({ effects: mathReadyEffect.of(null) });
    } catch {
      /* view destroyed before the converter finished loading — ignore */
    }
  });
}
