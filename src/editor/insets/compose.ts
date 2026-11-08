import type { CalloutType } from "../callout";
import {
  CODE_INSET,
  FOLD_OFFSET,
  QUOTE_BAR,
  QUOTE_BOX,
  TASK_BOX,
  ZERO,
  add,
  css,
  markerBox,
  sub,
  type Len,
} from "./metrics";

/**
 * The inset composer (change: editor-insets; spec: live-preview-editor / 容器缩进
 * 只有一个合成器). Pure: a line's container stack in, its left-inset geometry out.
 *
 * One rule for every container, applied outermost first. A running x starts at
 * the text column's left edge; each container claims a box at x and moves x on:
 *
 *   quote / callout → a bar at x, then x += bar + gap
 *   list item       → its marker box at x (marker lines draw the marker there),
 *                     then x += marker box (+ checkbox box for a task item)
 *   code            → its fill starts at x, then x += code inset
 *
 * Whatever x is after the last container is where the line's text starts. That
 * is the whole of "a child's marker starts at its parent's content column": the
 * child's box is claimed at the x its parent left behind. Nothing here asks
 * "am I in a quote?" — a quote inside a list and a list inside a quote are the
 * same loop over a different stack.
 */

export type Layer =
  | { kind: "quote" }
  | { kind: "callout"; type: CalloutType }
  | {
      kind: "list";
      /** Visible marker characters the item's list is sized for (`•` = 1, `10.` = 3). */
      markerChars: number;
      /** This line carries the item's marker. */
      markerLine: boolean;
      /** A task item: a checkbox follows the marker. */
      task: boolean;
    }
  | { kind: "code" };

export interface Paint {
  /** Where the bar or fill starts, from the line's left edge. */
  x: Len;
  /** A CSS color (a theme token reference). */
  color: string;
}

export interface Inset {
  /** Where the line's text (and every soft-wrapped row) starts. */
  content: Len;
  /** One bar per quote / callout level, outermost first. */
  bars: Paint[];
  /** Background fills (callout tint, code block) running to the right edge, outermost first. */
  fills: Paint[];
  /**
   * Marker lines: the marker box's start and width. The width runs from the
   * marker to the content, minus a task's checkbox (which is its own element),
   * so containers opened on the same line (`- > quote`) are part of the hang.
   */
  marker: { x: Len; width: Len } | null;
  /**
   * The fold toggle's x: FOLD_OFFSET left of what it folds (the marker on a
   * marker line, the text otherwise), never left of the innermost bar's right
   * edge — the toggle may not paint over a bar (`floor`).
   */
  fold: { x: Len; floor: Len | null };
}

const QUOTE_COLOR = "var(--ome-border)";
const calloutColor = (t: CalloutType) => `var(--ome-callout-${t})`;
const CODE_FILL = "var(--ome-code-bg)";
// Translucent, never opaque: an opaque line background hides the selection layer
// drawn beneath `.cm-content` (spec: 底色元素上的选区可见).
const calloutTint = (t: CalloutType) => `color-mix(in oklab, var(--ome-callout-${t}) 7%, transparent)`;

/** The left-inset geometry of a line in `stack` (outermost first). */
export function composeInset(stack: readonly Layer[]): Inset {
  let x: Len = ZERO;
  const bars: Paint[] = [];
  const fills: Paint[] = [];
  let marker: { x: Len; taskBox: boolean } | null = null;
  for (const layer of stack) {
    switch (layer.kind) {
      case "quote":
        bars.push({ x, color: QUOTE_COLOR });
        x = add(x, QUOTE_BOX);
        break;
      case "callout":
        bars.push({ x, color: calloutColor(layer.type) });
        fills.push({ x, color: calloutTint(layer.type) });
        x = add(x, QUOTE_BOX);
        break;
      case "list": {
        // The first marker on the line is the one the row hangs from.
        if (layer.markerLine && !marker) marker = { x, taskBox: layer.task };
        x = add(x, markerBox(layer.markerChars), layer.task ? TASK_BOX : ZERO);
        break;
      }
      case "code":
        fills.push({ x, color: CODE_FILL });
        x = add(x, CODE_INSET);
        break;
    }
  }
  const content = x;
  const markerOut = marker
    ? { x: marker.x, width: sub(sub(content, marker.x), marker.taskBox ? TASK_BOX : ZERO) }
    : null;
  const anchor = markerOut ? markerOut.x : content;
  const last = bars[bars.length - 1];
  return {
    content,
    bars,
    fills,
    marker: markerOut,
    fold: { x: sub(anchor, FOLD_OFFSET), floor: last ? add(last.x, QUOTE_BAR) : null },
  };
}

/**
 * The CSS custom properties a line carries (set by a line decoration). Every
 * inset rule in the editor reads these and nothing else (`styles.ts`).
 *
 *   --om-inset        text start (the line's transparent left border)
 *   --om-bar-N        x of the N-th bar, outermost first
 *   --om-fill-N       x of the N-th fill
 *   --om-inset-img    background layers (image / position / size lists, in
 *   --om-inset-pos    step): bars on top, inner fills over outer. Longhands, not
 *   --om-inset-size   the `background` shorthand, so a line's background-COLOR
 *                     (agent glow, reveal flash) is never reset by an inset.
 *   --om-mark-x/-w    marker lines: marker box start and width
 *   --om-fold-x       fold toggle x, measured from the line's left edge
 */
export function insetVars(inset: Inset): Record<string, string> {
  const vars: Record<string, string> = { "--om-inset": css(inset.content) };
  const img: string[] = [];
  const pos: string[] = [];
  const size: string[] = [];
  inset.bars.forEach((b, i) => {
    vars[`--om-bar-${i}`] = css(b.x);
    img.push(`linear-gradient(${b.color}, ${b.color})`);
    pos.push(`var(--om-bar-${i}) 0`);
    size.push(`${css(QUOTE_BAR)} 100%`);
  });
  // Fills paint UNDER the bars, the innermost over the outer ones.
  for (let i = inset.fills.length - 1; i >= 0; i--) {
    const f = inset.fills[i];
    vars[`--om-fill-${i}`] = css(f.x);
    img.push(`linear-gradient(${f.color}, ${f.color})`);
    pos.push(`var(--om-fill-${i}) 0`);
    size.push(`calc(100% - var(--om-fill-${i})) 100%`);
  }
  if (img.length) {
    vars["--om-inset-img"] = img.join(", ");
    vars["--om-inset-pos"] = pos.join(", ");
    vars["--om-inset-size"] = size.join(", ");
  }
  if (inset.marker) {
    vars["--om-mark-x"] = css(inset.marker.x);
    vars["--om-mark-w"] = css(inset.marker.width);
  }
  const fx = css(inset.fold.x);
  vars["--om-fold-x"] = inset.fold.floor ? `max(${fx}, ${css(inset.fold.floor)})` : fx;
  return vars;
}

/** `insetVars` as an inline `style` attribute value. */
export function insetStyle(inset: Inset): string {
  return Object.entries(insetVars(inset))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}
