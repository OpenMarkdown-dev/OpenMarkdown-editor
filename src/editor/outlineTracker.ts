import { ViewPlugin, type ViewUpdate, type EditorView } from "@codemirror/view";
import { outlineOf } from "./outline";
import { hostOf, type EditorHost } from "./host";

/**
 * Trailing-edge debounce (spec: outline-panel / 实时更新 · design D2): heading
 * structure only shifts on cross-line / heading-line edits, so a burst of
 * keystrokes coalesces into one re-extract instead of churning per character.
 * Same window as findPanel's RECOUNT_DEBOUNCE_MS — the two share the "structure
 * derived from the doc, refreshed on the trailing edge" shape.
 */
const OUTLINE_DEBOUNCE_MS = 120;

/**
 * Publish the ACTIVE document's heading outline through the host's `onOutline`
 * (spec: editor-host; the app's writes `useOutlineStore` for the sidebar
 * OUTLINE section — Option S, design D1): the editor owns the signal and
 * pushes on change / clears on teardown, so React never touches the EditorView
 * and a tab switch can't strand a stale outline. The extraction itself is the
 * pure `outlineOf`.
 */
export const outlineTracker = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** This state's host, fixed for the plugin's life (a swapped-in state builds a new plugin). */
    private readonly host: EditorHost;

    constructor(view: EditorView) {
      this.host = hostOf(view.state);
      // Seed immediately so the section reflects the document the moment the
      // editor mounts (tab switch / open), not only after the first edit.
      this.publish(view);
    }

    update(u: ViewUpdate) {
      if (u.docChanged) this.schedule(u.view);
    }

    private schedule(view: EditorView) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.publish(view);
      }, OUTLINE_DEBOUNCE_MS);
    }

    private publish(view: EditorView) {
      this.host.onOutline?.(outlineOf(view.state));
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
      // Tab switch tears this editor down — drop the outline so the next
      // document's section never shows this one's headings (spec: 切 tab 不陈旧).
      this.host.onOutline?.(null);
    }
  },
);
