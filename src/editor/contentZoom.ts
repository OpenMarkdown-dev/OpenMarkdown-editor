import { ViewPlugin, type EditorView } from "@codemirror/view";
import { CONTENT_ZOOM_VAR, contentZoomChanged } from "@/lib/zoom";

/**
 * The editor's share of the content zoom (spec: workspace-shell / UI 缩放).
 *
 * The document scales by its FONT SIZE, never by CSS `zoom` / `transform` on
 * the editor: CodeMirror maps pointer coordinates to positions from measured
 * line geometry, and a zoomed or transformed ancestor is exactly what makes
 * clicks, selections and the caret land off-target. Every size inside the
 * document is already in `em` (headings, code, widgets, list gutters), so the
 * root font size carries all of it; the text column's width scales with it so a
 * line keeps its measure — the way Apple Notes enlarges the note, not the window.
 */

/** A CSS length multiplied by the content zoom. Pure — the theme's one door. */
export function zoomed(length: string): string {
  return `calc(${length} * var(${CONTENT_ZOOM_VAR}, 1))`;
}

/**
 * A variable changing restyles the text but does not resize the scroller, so
 * CodeMirror would keep its old line heights; re-measure on every zoom change.
 */
export const contentZoomMeasure = ViewPlugin.fromClass(
  class {
    private readonly unsubscribe: () => void;
    constructor(view: EditorView) {
      this.unsubscribe = contentZoomChanged.subscribe(() => view.requestMeasure());
    }
    destroy() {
      this.unsubscribe();
    }
  },
);
