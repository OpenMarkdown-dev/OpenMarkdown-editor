import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { progressiveTree, treeChanged } from "../syntax";
import {
  CACHE_LIMIT,
  diagramSize,
  isLargeDiagram,
  mermaidFence,
  mermaidLoadFailed,
  mermaidLoader,
  requestMermaid,
  shownMermaid,
} from "../mermaid";
import { editorTextButton } from "../controls";
import { editorString } from "../strings";
import { MermaidWidget } from "../widgets";
import type { ColorScheme } from "../environment";
import { mapBlockStart } from "./pending";
import { isRevealed } from "./reveal";
import { asyncRenderDone, type PendingContent, pending } from "./render";
import type { BlockEntry } from "./types";

/**
 * A ```` ```mermaid ```` fence — A (change: editor-mermaid). Rendered as the
 * diagram; the caret entering it reveals the fence's source, like block math.
 *
 * Rendering is async, so the entry is split in two:
 *   - `widget` is synchronous and only READS the render cache (`../mermaid`):
 *     a result → the diagram; a failure → it throws, and the framework shows
 *     the source with the failure mark; nothing yet → `pending()`, the one
 *     placeholder (change: render-placeholder-size); not a diagram (unclosed,
 *     empty) → null, source unmarked;
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
 * The large-diagram blocks the user pressed "Render" on, in this editor state
 * (change: mermaid-large-diagrams, design D3 as settled 2026-11-14): kept by
 * the BLOCK, not by its source — each entry is the fence's start, mapped
 * through every change, so the approval survives the block's own edits (its
 * start does not move when its lines are edited) and follows the block when
 * text above it changes, but is never shared with a different block, even one
 * with the same source. Deleting the block's start drops it. Bounded like the
 * render cache, oldest dropped. Scheme-free: once asked, a theme switch
 * re-renders as usual.
 */
const askDiagram = StateEffect.define<number>();

export const askedDiagrams = StateField.define<readonly number[]>({
  create: () => [],
  update(starts, tr) {
    let out = starts;
    if (tr.docChanged) {
      // The one start rule (`mapBlockStart`): text inserted exactly at the
      // start pushes the asked block down rather than taking its approval.
      out = out.flatMap((p) => {
        const m = mapBlockStart(p, tr.changes);
        return m === null ? [] : [m];
      });
    }
    for (const e of tr.effects) {
      if (e.is(askDiagram)) out = [...out.filter((p) => p !== e.value), e.value].slice(-CACHE_LIMIT);
    }
    return out;
  },
});

/**
 * The ONE predicate (design D3): a large diagram whose block the user has not
 * asked for is never rendered automatically. Read by the driver (it does not
 * ask for it) and the entry's widget (it shows the hint).
 */
export function waitsForUser(state: EditorState, fence: { from: number; body: string }): boolean {
  return isLargeDiagram(fence.body) && !(state.field(askedDiagrams, false) ?? []).includes(fence.from);
}

/**
 * The bodies of the diagrams the block field draws (not revealed) and that do
 * not wait for the user (`waitsForUser`; change: mermaid-large-diagrams), those
 * touching `viewport` first. Reading mode reveals nothing, so it is every
 * diagram (design D4).
 */
export function drawnMermaidBodies(state: EditorState, viewport: { from: number; to: number }): string[] {
  const bodies: { body: string; near: boolean }[] = [];
  progressiveTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const fence = mermaidFence(state, node);
      // A large diagram the user has not asked for is never requested (D3).
      if (fence && !isRevealed(state, fence) && !waitsForUser(state, fence)) {
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

/**
 * The "Render" press for a large diagram (design D4): ask for exactly this
 * block (by its start), and rebuild so the placeholder shows "Rendering…" and
 * the driver requests it. The button's handler, exported so it is tested
 * without a DOM.
 */
export function pressRender(from: number, dispatch: (spec: { effects: StateEffect<unknown>[] }) => void): void {
  dispatch({ effects: [askDiagram.of(from), asyncRenderDone.of(null)] });
}

/** The words and button a large diagram's placeholder holds (design D4): its content slot. */
export function largeDiagramHint(from: number, body: string): PendingContent {
  const size = diagramSize(body);
  return {
    key: `mermaid-large:${size}`,
    build: (view) => {
      const el = document.createElement("div");
      el.className = "om-mermaid-hint";
      const text = document.createElement("p");
      text.textContent = editorString("widget.largeDiagram", { size: String(size) });
      const button = editorTextButton({ label: editorString("widget.renderDiagram"), size: "sm", weight: "outline" });
      button.dataset.omMermaidRender = "";
      // The button's own press: not a reveal, not a caret move.
      button.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      button.addEventListener("click", (e) => {
        e.preventDefault();
        pressRender(from, (spec) => view.dispatch(spec));
      });
      el.append(text, button);
      return el;
    },
  };
}

/** An asked-for large diagram still rendering: the same box, "Rendering…". */
const RENDERING: PendingContent = {
  key: "mermaid-large:rendering",
  build: () => {
    const el = document.createElement("div");
    el.className = "om-mermaid-hint";
    const text = document.createElement("p");
    text.textContent = editorString("widget.renderingDiagram");
    el.append(text);
    return el;
  },
};

/**
 * When the driver asks again: the document, the selection (which diagrams are
 * drawn follows the reveal — design D3), the parse, or the scheme changed; or
 * the blocks the user asked for changed — the "Render" press of a large
 * diagram (change: mermaid-large-diagrams), so the asked body is requested at
 * once. NOT on every rebuild (`asyncRenderDone`): a render ending — a failed
 * load included — dispatches one, and asking again then would retry the load
 * in a loop. Asking again is cheap: cached and in-flight bodies are skipped.
 */
export function driverShouldRequest(u: Pick<ViewUpdate, "docChanged" | "selectionSet" | "startState" | "state">): boolean {
  return (
    u.docChanged ||
    u.selectionSet ||
    treeChanged(u) ||
    u.startState.facet(EditorView.darkTheme) !== u.state.facet(EditorView.darkTheme) ||
    u.startState.field(askedDiagrams, false) !== u.state.field(askedDiagrams, false)
  );
}

export const mermaidEntry: BlockEntry = {
  id: "mermaid",
  mode: "A",
  node: "FencedCode",
  range: (state, node) => {
    const fence = mermaidFence(state, node);
    return fence && { from: fence.from, to: fence.to };
  },
  // A diagram not drawn before reserves a few lines, not one — enough for the
  // large-diagram hint and its button.
  pendingMinHeight: "6em",
  widget: (state, node, range) => {
    const fence = mermaidFence(state, node);
    if (!fence) return null;
    const out = shownMermaid(fence.body, schemeOf(state));
    // A loader that resolved nothing ("source") leaves the fence a code block.
    if (out?.kind === "source") return null;
    // Nothing yet: the placeholder — unless no render can come (mermaid's load
    // failed, or this state has no loader and nothing cached): source, unmarked.
    if (!out || out.kind === "pending") {
      if (mermaidLoadFailed() || !state.facet(mermaidLoader)) return null;
      // Large: the hint until the user asks, then "Rendering…" (design D4).
      if (waitsForUser(state, fence)) return pending({ content: largeDiagramHint(fence.from, fence.body) });
      return pending(isLargeDiagram(fence.body) ? { content: RENDERING } : {});
    }
    if (out.kind === "failed") throw new Error(out.reason);
    return new MermaidWidget(out.value, range.from);
  },
  // Which large blocks the user asked for, then the driver.
  extension: [
    askedDiagrams,
    ViewPlugin.fromClass(
      class {
        private readonly requests: MermaidRequests;
        constructor(readonly view: EditorView) {
          this.requests = new MermaidRequests(() => view.dispatch({ effects: asyncRenderDone.of(null) }));
          this.request();
        }
        update(u: ViewUpdate) {
          if (driverShouldRequest(u)) this.request();
        }
        destroy() {
          this.requests.destroy();
        }
        request() {
          this.requests.request(this.view.state, this.view.viewport);
        }
      },
    ),
  ],
};
