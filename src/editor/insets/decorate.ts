import { Decoration } from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";
import { composeInset, insetStyle } from "./compose";
import { lineContainers, newStackCache } from "./stack";
import { CODE_INSET, FOLD_OFFSET, MARKER_GAP, TASK_CHECK, ZERO, css, sub } from "./metrics";

/**
 * The composer's two outputs into the editor (change: editor-insets): one line
 * decoration per container line carrying the inset variables, and the CSS that
 * reads them. These rules are the ONLY left-inset rules for list, quote,
 * callout and code lines (gate: `scripts/check-app-surface.mjs` /
 * `editor-inset-outside-composer`); theme.ts keeps those lines' colours and
 * vertical spacing, never their left geometry.
 *
 * Why a transparent LEFT BORDER and never `padding-left`: drawSelection
 * (`rectanglesForRange`) samples only the first rendered `.cm-line`'s
 * paddingLeft as the left edge of a whole multi-line selection, so a per-line
 * paddingLeft notches every interior selection row inward (spec: 选区高亮限定在
 * 文本列内). Every `.cm-line` keeps paddingLeft 0.
 *
 * Why the bars are BACKGROUND LAYERS: a line can sit in any number of quotes,
 * at x positions that are not evenly spaced (`> - > x` has bars at 0 and after
 * a marker box), so a repeating gradient cannot draw them; one gradient layer
 * per level, each positioned at its own `--om-bar-N`, can. `background-origin:
 * border-box` anchors the positions to the line's true left edge — the default
 * `padding-box` starts after the transparent border, which would push every bar
 * into the text (change: callout-quote-stripe-position).
 */
export function decorateInsets(state: EditorState, from: number, to: number, deco: Range<Decoration>[]): void {
  const cache = newStackCache();
  const last = state.doc.lineAt(to).number;
  for (let ln = state.doc.lineAt(from).number; ln <= last; ln++) {
    const line = state.doc.line(ln);
    const c = lineContainers(state, line, cache);
    if (!c) continue;
    const inset = composeInset(c.layers);
    deco.push(
      Decoration.line({
        class: "om-inset" + (c.list ? " om-list-line" : "") + (inset.marker ? " om-list-marker-line" : ""),
        attributes: { style: insetStyle(inset) },
      }).range(line.from),
    );
    // Container indentation stays in the document (the column matters for Tab)
    // but contributes no width. REPLACED, never wrapped in a zero-width box:
    // the browser homes a caret at the end of such a box inside it, so an empty
    // item's IME composition would start in a clipped box and the candidate
    // window never showed (spec: live-preview-editor / 光标不落进零宽盒).
    for (const [a, b] of c.lead) deco.push(zeroWidth.range(a, b));
    for (const [a, b] of c.gap) deco.push(zeroWidth.range(a, b));
  }
}

/**
 * Container indentation and the marker→content gap render as nothing. Not
 * atomic: a caret can still stand on either side, which is what Tab and the
 * structure keys read.
 *
 * Not a hiding path for the landing (spec: caret-rules / 落点看得见): it hides
 * only indent whitespace, a caret inside it is drawn at the content edge, and
 * only a Find for runs of spaces can select into it (accepted; see the change's
 * apply notes). `landingExempt` says so to the landing verdict (`livePreview.ts`
 * `inlineLanding`); the gate registers the reason.
 */
const zeroWidth = Decoration.replace({ landingExempt: true });

/** Fold toggle x on a line the composer did not decorate (a top-level heading). */
const FOLD_DEFAULT = css(sub(ZERO, FOLD_OFFSET));

/** The inset rules. Spread into `editorMarkTheme` (theme.ts). */
export const insetStyles = {
  ".cm-line.om-inset": {
    borderLeft: "var(--om-inset) solid transparent",
    backgroundImage: "var(--om-inset-img, none)",
    backgroundPosition: "var(--om-inset-pos, 0 0)",
    backgroundSize: "var(--om-inset-size, auto)",
    backgroundRepeat: "no-repeat",
    backgroundOrigin: "border-box",
  },
  // Marker lines: the FIRST row backs up to the marker; soft-wrapped rows keep
  // the line's inset, which is the content column — hanging indent ("折行挂齐").
  ".cm-line.om-list-marker-line": { textIndent: "calc(var(--om-mark-x) - var(--om-inset))" },
  // The marker IS its box: `•`, `1.`, `100.` and a revealed `-` all occupy it, so
  // the content column does not depend on the glyph. This class exists in both
  // render paths (source marker and BulletWidget). The guaranteed gap keeps a
  // glyph that somehow exceeds its box off its text. Tabular figures make every
  // digit 1ch wide, which is what the box is sized in (metrics.ts).
  ".cm-line.om-list-marker-line .om-list-mark": { minWidth: "var(--om-mark-w)" },
  ".cm-line .om-list-mark": {
    display: "inline-block",
    paddingRight: css(MARKER_GAP),
    fontVariantNumeric: "tabular-nums",
    // text-indent INHERITS into an inline-block; zero it or it applies twice.
    textIndent: "0",
    // Baseline alignment hangs the box's descent below the line and makes list
    // lines taller than paragraphs; the box's line-height equals the line's, so
    // top alignment puts the glyph in the same place.
    verticalAlign: "top",
  },
  // The task checkbox is part of its list's marker box: its width plus one
  // marker gap is exactly the TASK_BOX `listBox` (metrics.ts) reserves for it,
  // at the end of the box, so the text starts at the list's content column.
  //
  // `font: inherit`: a form control does not inherit the text's font, so
  // without it `em` and `ch` here resolve on the input's own UA font (13.33px
  // system font)
  // and the checkbox comes out ~5px narrower than the box it was sized for —
  // a task's text then starts left of its own wrapped rows and of its plain
  // siblings (measured on the demo, change: demo-phone-and-list-indent).
  ".cm-line .om-checkbox": {
    font: "inherit",
    width: css(TASK_CHECK),
    height: css(TASK_CHECK),
    margin: `0 ${css(MARKER_GAP)} 0 0`,
  },
  // Code's right inset mirrors its left one (the left one is the composer's).
  ".cm-line.om-codeblock-line": { borderRight: `${css(CODE_INSET)} solid transparent` },
  // Fold toggles (headings and list items): the line is the positioning context
  // and its padding box starts at `--om-inset`, so subtract it. The length is
  // RESOLVED ON THE LINE (`--om-fold-left` is a registered <length>, ../primitives.ts),
  // because the composer's lengths are in the line's em and the toggle is a
  // chrome control with its own type size (change: editor-controls): an `em`
  // resolved on the 11px button put it 30% off, over the marker.
  ".cm-line.om-fold-heading, .cm-line.om-fold-list": {
    "--om-fold-left": `calc(var(--om-fold-x, ${FOLD_DEFAULT}) - var(--om-inset, 0px))`,
  },
  ".cm-line .om-fold-toggle": { left: "var(--om-fold-left)" },
} as const;
