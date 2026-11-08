import { tipAttrs } from "@/lib/tooltip";
import { Decoration } from "@codemirror/view";
import { type Range, StateEffect } from "@codemirror/state";
import { editorString } from "../strings";

/**
 * A rendered thing that cannot render shows its source — defined ONCE here
 * (spec: block-editing / 渲染失败的块显示源码、渲染失败只在一处接住; change:
 * block-fallback, design D1–D3).
 *
 * A renderer only draws, and has three answers:
 *   - its output            → rendered;
 *   - `null`                → "not now" (converter still loading, not a shape it
 *                             draws): the source stays, unmarked;
 *   - it THROWS             → "cannot": the source stays, with the failure mark.
 *
 * `attemptRender` is the only place a render error is caught. The block
 * framework (`field.ts`) runs every registry entry's `widget` through it, so a
 * new block gets the fallback by construction; inline math (`livePreview.ts`)
 * runs through the same call. Renderers never catch their own errors — the
 * gate in `render.gate.test.ts` holds that.
 *
 * The fallback replaces nothing and hides nothing, so what is on screen is the
 * document's text, editable as usual. An async renderer (mermaid, change:
 * editor-mermaid) goes through the async sibling `attemptRenderAsync` below:
 * the same three answers, settled later, kept in the renderer's cache, and
 * shown once `asyncRenderDone` makes the block field rebuild.
 */

export type RenderResult<T> =
  | { kind: "rendered"; value: T }
  | { kind: "source" }
  | { kind: "failed"; reason: string };

/** The renderer's own words, first line only (Temml appends a caret line). */
export function failureReason(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.trim().split("\n")[0].trim();
}

export function attemptRender<T>(render: () => T | null): RenderResult<T> {
  try {
    const value = render();
    return value == null ? { kind: "source" } : { kind: "rendered", value };
  } catch (e) {
    return { kind: "failed", reason: failureReason(e) };
  }
}

/**
 * `attemptRender` for a renderer that answers later: a rejection becomes the
 * same `failed` result a throw does. Never rejects itself.
 */
export function attemptRenderAsync<T>(render: () => Promise<T | null>): Promise<RenderResult<T>> {
  return Promise.resolve()
    .then(render)
    .then(
      (value): RenderResult<T> => (value == null ? { kind: "source" } : { kind: "rendered", value }),
      (e: unknown): RenderResult<T> => ({ kind: "failed", reason: failureReason(e) }),
    );
}

/**
 * Dispatched when an async renderer has a new result: the block field rebuilds
 * and swaps source → rendered (or → the failure mark). The async counterpart of
 * `mathReadyEffect`, shared by every async block.
 */
export const asyncRenderDone = StateEffect.define<null>();

/**
 * The one failure mark: a quiet dotted underline over the source (style:
 * `.om-render-failed` in `theme.ts`), the reason on hover. A mark, never a
 * replacement — and the block field keeps it OUT of its atomic ranges, so the
 * source under it stays ordinary editable text.
 */
export function failedSourceMark(from: number, to: number, reason: string): Range<Decoration> {
  return Decoration.mark({ class: FAILED_CLASS, attributes: failedAttrs(reason) }).range(from, to);
}

const FAILED_CLASS = "om-render-failed";

function failedAttrs(reason: string): Record<string, string> {
  return { ...tipAttrs(editorString("widget.renderFailed", { reason })), "data-om-render-failed": "" };
}

/**
 * The same mark as an element, for detached DOM the editor's decorations cannot
 * reach — a table cell (change: cell-tree): the source as text, wrapped.
 */
export function failedSourceElement(source: string, reason: string): HTMLElement {
  const el = document.createElement("span");
  el.className = FAILED_CLASS;
  for (const [k, v] of Object.entries(failedAttrs(reason))) el.setAttribute(k, v);
  el.textContent = source;
  return el;
}
