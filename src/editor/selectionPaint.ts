import type { EditorState } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";

/**
 * A rendered block's selected state — the ONE place it is decided and marked
 * (spec: live-preview-editor / 选区只有一种画法, block-editing / 块的选中态只经框架
 * 产生; change: selection-paint, design D2).
 *
 * Why a block needs one at all: CodeMirror's selection layer is painted UNDER the
 * content and, by design, skips a block widget that starts or ends the range
 * (`rectanglesForRange` draws from the start block's bottom edge to the end
 * block's top edge) — ⌘A from offset 0 leaves a leading Properties block with no
 * selection colour. And an opaque widget (an image) hides the layer even where
 * it is drawn. So a block shows itself selected; the look is one rule in
 * `theme.ts` keyed on the attribute below, and nothing else may set it.
 *
 * Callers: `blocks/field.ts` wraps EVERY A / B block (so a new registry entry
 * gets it for free) and `livePreview.ts` wraps the image widget, the one inline
 * widget that stays rendered under a selection (reading mode) with opaque
 * content. Gate: `selectionPaint.gate.test.ts`.
 */

/** The attribute the one selected-state rule keys on. Only this module writes it. */
export const COVERED_ATTR = "data-om-covered";

/**
 * The attribute a block carries when the landing (the main selection) lies
 * inside it and the block cannot draw it at a finer grain (spec: caret-rules /
 * 落点看得见, outcome 3): the whole widget is marked. Set by `blocks/field.ts`
 * through this wrapper; styled once in `theme.ts`.
 */
export const LANDING_ATTR = "data-om-landing";

/** The host element's class (the framework's own, identical for every block). */
export const HOST_CLASS = "om-select-host";
/** Extra class on an inline host (an image inside a line). */
export const HOST_INLINE_CLASS = "om-select-host-inline";

/**
 * Does a non-empty selection range contain all of [from, to]? A caret never
 * covers anything, and touching one edge is not covering: a B block is atomic
 * (no endpoint lands inside it) and an A block touched by the selection is
 * revealed as source, where the selection layer paints it as lines.
 */
export function coveredBySelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => !r.empty && r.from <= from && r.to >= to);
}

function paint(host: HTMLElement, covered: boolean, landing: boolean) {
  if (covered) host.setAttribute(COVERED_ATTR, "");
  else host.removeAttribute(COVERED_ATTR);
  if (landing) host.setAttribute(LANDING_ATTR, "");
  else host.removeAttribute(LANDING_ATTR);
}

/** CM's own widget equality (`WidgetType.compare`, not in its public types). */
function sameWidget(a: WidgetType, b: WidgetType): boolean {
  return a === b || (a.constructor === b.constructor && a.eq(b));
}

/** The inner widget's own root inside a host. */
function innerDOM(host: HTMLElement): HTMLElement {
  return host.firstElementChild as HTMLElement;
}

/**
 * `inner` plus its selected state. Equal only when both the state and the inner
 * widget are; a change of state alone is applied by flipping the host's
 * attribute (`updateDOM` → true), so the inner DOM — a cell or property part
 * editor with focus and an IME composition — is never rebuilt for it. The other
 * members CM types forward to `inner`, which is handed its OWN root, never the host.
 */
export class SelectableWidget extends WidgetType {
  constructor(
    readonly inner: WidgetType,
    readonly covered: boolean,
    readonly flow: "block" | "inline",
    /** The landing lies inside and the block does not paint it itself: mark the whole widget. */
    readonly landing = false,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof SelectableWidget &&
      other.covered === this.covered &&
      other.flow === this.flow &&
      other.landing === this.landing &&
      sameWidget(this.inner, other.inner)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement(this.flow === "block" ? "div" : "span");
    host.className = this.flow === "block" ? HOST_CLASS : `${HOST_CLASS} ${HOST_INLINE_CLASS}`;
    host.appendChild(this.inner.toDOM(view));
    paint(host, this.covered, this.landing);
    return host;
  }

  /** CM passes the widget that built `dom` (only ever one of this class). */
  updateDOM(dom: HTMLElement, view: EditorView, prev: this): boolean {
    const child = innerDOM(dom);
    if (!child || prev.flow !== this.flow) return false;
    const same = sameWidget(this.inner, prev.inner);
    if (!same) {
      // The inner widget may update in place only from one of its own kind —
      // the same contract CM applies before calling `updateDOM` at all.
      if (prev.inner.constructor !== this.inner.constructor) return false;
      if (!this.inner.updateDOM(child, view, prev.inner)) return false;
    }
    paint(dom, this.covered, this.landing);
    return true;
  }

  destroy(dom: HTMLElement): void {
    const child = innerDOM(dom);
    if (child) this.inner.destroy(child);
  }

  coordsAt(dom: HTMLElement, pos: number, side: number) {
    const child = innerDOM(dom);
    return child ? this.inner.coordsAt(child, pos, side) : null;
  }

  ignoreEvent(event: Event): boolean {
    return this.inner.ignoreEvent(event);
  }

  get estimatedHeight(): number {
    return this.inner.estimatedHeight;
  }

  get lineBreaks(): number {
    return this.inner.lineBreaks;
  }
}

/** Wrap a rendered block (`"block"`) or an inline image (`"inline"`) with its selected state. */
export function withSelectedState(inner: WidgetType, covered: boolean, flow: "block" | "inline", landing = false): SelectableWidget {
  return new SelectableWidget(inner, covered, flow, landing);
}
