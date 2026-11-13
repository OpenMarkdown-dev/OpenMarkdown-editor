import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { progressiveTree, treeChanged } from "../syntax";
import { mermaidFence, mermaidLoader, requestMermaid, shownMermaid } from "../mermaid";
import { MermaidWidget } from "../widgets";
import type { ColorScheme } from "../environment";
import { isRevealed } from "./reveal";
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
 *   - `MermaidRequests` (behind this entry's `extension`) is the driver: it
 *     asks for every DRAWN diagram the cache does not have — not one whose
 *     source the caret has revealed, by the field's own rule (`isRevealed`;
 *     change: mermaid-render-drawn-only, design D1) — and when one finishes
 *     dispatches `asyncRenderDone`, which rebuilds the block field. What it
 *     asked for last is all it wants: a queued render of a source it has moved
 *     past is dropped unrun (design D2).
 */

/** The scheme the editor is drawn in — the editor environment's, via the dark-theme facet. */
export const schemeOf = (state: EditorState): ColorScheme =>
  state.facet(EditorView.darkTheme) ? "dark" : "light";

/**
 * The bodies of the diagrams the block field draws (not revealed), those
 * touching `viewport` first. Reading mode reveals nothing, so it is every
 * diagram (design D4).
 */
export function drawnMermaidBodies(state: EditorState, viewport: { from: number; to: number }): string[] {
  const bodies: { body: string; near: boolean }[] = [];
  progressiveTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const fence = mermaidFence(state, node);
      if (fence && !isRevealed(state, fence)) {
        bodies.push({ body: fence.body, near: fence.to >= viewport.from && fence.from <= viewport.to });
      }
      return false;
    },
  });
  bodies.sort((a, b) => Number(b.near) - Number(a.near));
  return bodies.map((b) => b.body);
}

/**
 * One editor's render requests. Each `request` REPLACES what it wants (the
 * drawn bodies in the state's scheme); a queued render is run only while some
 * driver still wants it. Destroyed: wants nothing, hears nothing.
 */
export class MermaidRequests {
  private alive = true;
  private wanted = new Set<string>();
  constructor(private readonly redraw: () => void) {}

  request(state: EditorState, viewport: { from: number; to: number }): void {
    // No loader (the diagram-free entry, or a test state): nothing to ask for.
    const load = state.facet(mermaidLoader);
    if (!load) return;
    const scheme = schemeOf(state);
    const bodies = drawnMermaidBodies(state, viewport);
    const wanted = new Set(bodies.map((b) => `${scheme}\n${b}`));
    this.wanted = wanted;
    const done = () => {
      if (this.alive) this.redraw();
    };
    for (const body of bodies) {
      const key = `${scheme}\n${body}`;
      requestMermaid(body, scheme, load, done, () => this.alive && this.wanted.has(key));
    }
  }

  destroy(): void {
    this.alive = false;
  }
}

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
      private readonly requests: MermaidRequests;
      constructor(readonly view: EditorView) {
        this.requests = new MermaidRequests(() => view.dispatch({ effects: asyncRenderDone.of(null) }));
        this.request();
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          // Which diagrams are drawn follows the selection (reveal) — design D3.
          u.selectionSet ||
          treeChanged(u) ||
          u.startState.facet(EditorView.darkTheme) !== u.state.facet(EditorView.darkTheme)
        ) {
          this.request();
        }
      }
      destroy() {
        this.requests.destroy();
      }
      request() {
        this.requests.request(this.view.state, this.view.viewport);
      }
    },
  ),
};
