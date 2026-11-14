/**
 * Sideways-scrolling blocks and their scroll cue — the ONE definition (change:
 * demo-phone-and-list-indent, design D4; spec: live-preview-editor / 横向滚动的块
 * 显示可滚提示). Phone browsers hide the scrollbar until you scroll, so a wide
 * table or formula cut off at the column's edge gave no sign there was more.
 *
 * To make a block scroll sideways with the cue, a consumer does two things:
 *
 *   1. spreads `HSCROLL_STYLE` into the block's theme rule (overflow + cue);
 *   2. calls `watchHScroll(el)` where it builds the element, and the returned
 *      disposer (or `unwatchHScroll(el)`) when the element goes away — for a
 *      CodeMirror widget, in `destroy(dom)`.
 *
 * Today: the table wrap, block math and a wide Mermaid diagram (`widgets.ts`). Any other sideways
 * scroller in editor code fails the gate in `editorStyle.gate.test.ts`.
 *
 * The cue is a `mask-image` fade over the last 1.5em of each side with content
 * past it. A mask fades the block's own pixels, so it is right on any host
 * background (a host may make the editor root transparent) — a shadow drawn
 * with `background-attachment: local` would need to know that colour. A mask
 * paints only; it does not take clicks, cell edits or scrollbar drags.
 */

/** Which edges have content past them: "" (none), "start", "end" or "both". */
export type HScrollState = "" | "start" | "end" | "both";

/** Sub-pixel layout rounding is not content: 1px of slack at each edge. */
const TOLERANCE = 1;

/** Pure: the cue state of a box from its scroll metrics. */
export function hscrollState(scrollLeft: number, scrollWidth: number, clientWidth: number): HScrollState {
  const overflow = scrollWidth - clientWidth;
  if (overflow <= TOLERANCE) return "";
  // RTL hosts report a negative scrollLeft; its magnitude is the distance from the start.
  const fromStart = Math.abs(scrollLeft);
  const start = fromStart > TOLERANCE;
  const end = overflow - fromStart > TOLERANCE;
  return start && end ? "both" : start ? "start" : end ? "end" : "";
}

/** How much of an edge the cue fades. */
const FADE = "1.5em";
// The mask is an alpha stencil, not paint: `black` = keep, `transparent` = fade.
const KEEP = "black";
const mask = (image: string) => ({ maskImage: image, WebkitMaskImage: image });

/** Spread into the theme rule of every block that scrolls sideways. */
export const HSCROLL_STYLE = {
  overflowX: "auto",
  '&[data-hscroll="end"]': mask(`linear-gradient(to right, ${KEEP} calc(100% - ${FADE}), transparent)`),
  '&[data-hscroll="start"]': mask(`linear-gradient(to right, transparent, ${KEEP} ${FADE})`),
  '&[data-hscroll="both"]': mask(
    `linear-gradient(to right, transparent, ${KEEP} ${FADE}, ${KEEP} calc(100% - ${FADE}), transparent)`,
  ),
} as const;

const watched = new WeakMap<HTMLElement, () => void>();

/**
 * Keep `el`'s `data-hscroll` in step with its scroll position and size: on
 * scroll (passive) and through a ResizeObserver on the box and its content, so
 * a column resize or a re-rendered table updates the cue. Watching an element
 * twice replaces the first watch. Returns the disposer.
 */
export function watchHScroll(el: HTMLElement): () => void {
  watched.get(el)?.();
  const update = () => {
    const s = hscrollState(el.scrollLeft, el.scrollWidth, el.clientWidth);
    if (s) el.dataset.hscroll = s;
    else delete el.dataset.hscroll;
  };
  el.addEventListener("scroll", update, { passive: true });
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  if (ro) {
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
  }
  update();
  const dispose = () => {
    el.removeEventListener("scroll", update);
    ro?.disconnect();
    if (watched.get(el) === dispose) watched.delete(el);
  };
  watched.set(el, dispose);
  return dispose;
}

/** Stop watching `el` (no-op when it is not watched). */
export function unwatchHScroll(el: HTMLElement): void {
  watched.get(el)?.();
}
