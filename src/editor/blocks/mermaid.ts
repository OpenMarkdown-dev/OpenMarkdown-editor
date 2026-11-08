import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { progressiveTree, treeChanged } from "../syntax";
import { mermaidFence, mermaidLoader, requestMermaid, shownMermaid } from "../mermaid";
import { MermaidWidget } from "../widgets";
import type { ColorScheme } from "../environment";
import { asyncRenderDone } from "./render";
import type { BlockEntry } from "./types";

/**
 * A ```` ```mermaid ```` fence — A (change: editor-mermaid). Rendered as the
 * diagram; the caret entering it reveals the fence's source, like block math.
 *
 * Rendering is async, so the entry is split in two:
 *   - `widget` is synchronous and only READS the render cache (`../mermaid`):
 *     a result → the diagram; a failure → it throws, and the framework shows
 *     the source with the failure mark; nothing yet → null, source unmarked;
 *   - `mermaidRenderer` (this entry's `extension`) is the driver: it asks for
 *     every diagram in the document that the cache does not have, and when one
 *     finishes dispatches `asyncRenderDone`, which rebuilds the block field.
 */

/** The scheme the editor is drawn in — the editor environment's, via the dark-theme facet. */
export const schemeOf = (state: EditorState): ColorScheme =>
  state.facet(EditorView.darkTheme) ? "dark" : "light";

export const mermaidEntry: BlockEntry = {
  id: "mermaid",
  mode: "A",
  node: "FencedCode",
  range: (state, node) => {
    const fence = mermaidFence(state, node);
    return fence && { from: fence.from, to: fence.to };
  },
  widget: (state, node, range) => {
    const fence = mermaidFence(state, node);
    if (!fence) return null;
    const out = shownMermaid(fence.body, schemeOf(state));
    if (!out || out.kind === "source") return null;
    if (out.kind === "failed") throw new Error(out.reason);
    return new MermaidWidget(out.value, range.from);
  },
  extension: ViewPlugin.fromClass(
    class {
      private alive = true;
      constructor(readonly view: EditorView) {
        this.request();
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          treeChanged(u) ||
          u.startState.facet(EditorView.darkTheme) !== u.state.facet(EditorView.darkTheme)
        ) {
          this.request();
        }
      }
      destroy() {
        this.alive = false;
      }
      /** Ask for every diagram in the document, those in view first. */
      request() {
        const { state, viewport } = this.view;
        // No loader (the diagram-free entry, or a test state): nothing to ask for.
        const load = state.facet(mermaidLoader);
        if (!load) return;
        const scheme = schemeOf(state);
        const bodies: { body: string; near: boolean }[] = [];
        progressiveTree(state).iterate({
          enter: (node) => {
            if (node.name !== "FencedCode") return;
            const fence = mermaidFence(state, node);
            if (fence) bodies.push({ body: fence.body, near: fence.to >= viewport.from && fence.from <= viewport.to });
            return false;
          },
        });
        bodies.sort((a, b) => Number(b.near) - Number(a.near));
        const redraw = () => {
          if (this.alive) this.view.dispatch({ effects: asyncRenderDone.of(null) });
        };
        for (const { body } of bodies) requestMermaid(body, scheme, load, redraw);
      }
    },
  ),
};
