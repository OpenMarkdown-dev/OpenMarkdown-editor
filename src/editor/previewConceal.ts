/**
 * The facts about WHAT live-preview hides and WHAT stands in its place — kept in
 * one leaf module because two consumers need them and a second copy would drift
 * (change: reading-mode-plain-copy).
 *
 * The consumers:
 *   - `livePreview.ts` / `widgets.ts` — turn these into decorations and widgets.
 *   - `plainCopy.ts` — turns them into the text that reading-mode copy puts on
 *     the clipboard.
 *
 * Only the load-bearing DATA lives here, not the branch logic. The renderer's
 * `enterNode` also owns reveal-on-touch, decoration classes and widget
 * construction, none of which the copy path needs: reading mode never reveals,
 * so copy only ever asks "is this concealed, and what is visible instead?".
 * Drift between the two would show up as "what I see and what I copied differ",
 * which is precisely the bug this module guards against — so anything that is
 * literally the same value (the mark set, the glyphs) belongs here, and nothing
 * that is merely similar does.
 */

/** Marks whose parent element decides reveal state; all hidden in reading mode. */
export const FORMATTING_MARKS = new Set([
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "HeaderMark",
  "LinkMark",
  "QuoteMark",
]);

/** Visible stand-in for an unordered list marker (`BulletWidget`). */
export const BULLET_GLYPH = "•";

/**
 * Visible stand-ins for a task marker. The rendered form is a checkbox control,
 * which has no text; these glyphs are the closest plain-text carrier of the same
 * information. Deliberately NOT `[ ]` / `[x]` — putting the source markers back
 * would defeat the point of copying rendered text.
 */
export const TASK_GLYPH = { checked: "☑", unchecked: "☐" } as const;

/**
 * True when a link has no text between `[` and `]` — `[](url)`. Positional: the
 * URL child starts two chars after the `]` (`](`), so an empty label means the
 * link start plus one IS that position. Such a link renders as a short label
 * derived from the URL instead of blank (spec: 空文本链接不渲染为空白).
 */
export function linkTextIsEmpty(linkFrom: number, urlFrom: number): boolean {
  return linkFrom + 1 === urlFrom - 2;
}

/**
 * The inline nodes live preview replaces WHOLE with a widget that turns back
 * into source the moment the selection touches it (`livePreview.ts` cases
 * `Image` / `InlineMath`). Read by the undo landing (`caret.ts`, spec:
 * caret-rules R2a), which must put the caret where it does NOT reveal one; a
 * node added to the renderer as a touch-revealed widget belongs here too
 * (`livePreview.test.ts` holds the two together).
 */
export const REVEAL_ON_TOUCH_NODES: ReadonlySet<string> = new Set(["Image", "InlineMath"]);
