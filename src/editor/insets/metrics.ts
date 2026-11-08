/**
 * Indent metrics (change: editor-insets; spec: live-preview-editor / 容器缩进只有
 * 一个合成器). The ONE place that says how wide each piece of a container's left
 * inset is. The composer (`compose.ts`) adds these up; nothing else in the editor
 * may set a left inset for a list, quote, callout or code line (gate:
 * `scripts/check-app-surface.mjs` / `editor-inset-outside-composer`).
 *
 * Every value is font-relative (`em` or `ch`), so the content zoom — which scales
 * the editor's root font size (`../contentZoom.ts`) — scales the whole scheme.
 * The quote bar's 3px is the single exception, and on purpose: it is a hairline
 * stroke, not a distance text is laid out against (spec: 选区高亮限定在文本列内 /
 * 左侧装饰条).
 *
 * Where each number comes from — none of them is tuned against a measurement:
 *   - MARKER_GAP = 1ch: a marker is followed by one character of space, the
 *     same rule for `•`, `1.`, `100.` and the task checkbox.
 *   - marker box = (visible marker characters) × 1ch + MARKER_GAP. Digits render
 *     with tabular figures (`.om-list-mark`), and a tabular digit's advance IS
 *     `1ch` (the width of "0") by definition, so a box sized in `ch` holds its
 *     marker for any digit count — `100.` cannot overflow. The bullet is one
 *     visible character (`•`). `.`/`)` are narrower than a digit, so they never
 *     overflow their `1ch` either.
 *   - QUOTE_BAR = 3px, QUOTE_GAP = 1em, CODE_INSET = 0.75em, FOLD_OFFSET = 1.4em:
 *     the values the quote, callout, code block and heading fold already had
 *     (spec: 选区高亮…, 标题折叠); this change moves them here, it does not
 *     re-pick them.
 *   - TASK_CHECK = 0.8125em: the native checkbox's 13px at the 16px base size,
 *     kept as-is but now expressed in em so it scales with the content zoom.
 */

/** A CSS length as a sum of font-relative and absolute parts. */
export interface Len {
  em: number;
  ch: number;
  px: number;
}

export const ZERO: Len = { em: 0, ch: 0, px: 0 };

export const len = (em = 0, ch = 0, px = 0): Len => ({ em, ch, px });

export function add(...parts: Len[]): Len {
  return parts.reduce((a, b) => ({ em: a.em + b.em, ch: a.ch + b.ch, px: a.px + b.px }), ZERO);
}

export function sub(a: Len, b: Len): Len {
  return { em: a.em - b.em, ch: a.ch - b.ch, px: a.px - b.px };
}

const round = (n: number) => Math.round(n * 10000) / 10000;

/** CSS text for a length: `0px`, `1.25em`, or `calc(1em + 2ch + 3px)`. */
export function css(l: Len): string {
  const terms: string[] = [];
  for (const [v, unit] of [
    [l.em, "em"],
    [l.ch, "ch"],
    [l.px, "px"],
  ] as const) {
    const r = round(v);
    if (r !== 0) terms.push(`${r}${unit}`);
  }
  if (terms.length === 0) return "0px";
  if (terms.length === 1) return terms[0];
  return `calc(${terms.join(" + ").replace(/\+ -/g, "- ")})`;
}

/** One character of space after every marker (bullet, number, checkbox). */
export const MARKER_GAP: Len = len(0, 1);

/** The quote / callout bar: a hairline stroke (absolute on purpose). */
export const QUOTE_BAR: Len = len(0, 0, 3);
/** Space between a quote bar and the quote's content. */
export const QUOTE_GAP: Len = len(1);
/** A code block's inner inset (left; the right one mirrors it in theme.ts). */
export const CODE_INSET: Len = len(0.75);
/** A fold toggle sits this far left of the line it folds (heading or item). */
export const FOLD_OFFSET: Len = len(1.4);
/** The task checkbox's own width (and height). */
export const TASK_CHECK: Len = len(0.8125);

/** Visible characters of a bullet marker once rendered (`•`). */
export const BULLET_CHARS = 1;

/** Width of a list marker box holding `chars` visible characters, gap included. */
export function markerBox(chars: number): Len {
  return add(len(0, chars), MARKER_GAP);
}

/** Width a quote or callout adds before its content. */
export const QUOTE_BOX: Len = add(QUOTE_BAR, QUOTE_GAP);

/** Width a task checkbox adds after the marker, gap included. */
export const TASK_BOX: Len = add(TASK_CHECK, MARKER_GAP);
