import { CONTROL_SIZE } from "@/components/ui/control";
import { HSCROLL_STYLE } from "./hscroll";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { zoomed } from "./contentZoom";
import { insetStyles } from "./insets/decorate";
import { COVERED_ATTR, HOST_CLASS, HOST_INLINE_CLASS, LANDING_ATTR } from "./selectionPaint";
import { TABLE_CELL_BOX, TYPE_SCALE, editorTokenDefaults, headingType } from "./tokens";
import { editorStyleBase } from "./primitives";

/**
 * Selection tint strength (change: editor-theme-parity, design D3). ONE value for
 * both themes on purpose — measured, the two are symmetric, so a per-theme alpha
 * would be a second knob buying nothing:
 *
 *   light  22% → #C9DDF1   --foreground 11.50:1   selection-vs-background 1.35:1
 *   dark   22% → #1E3047   --foreground  9.02:1   selection-vs-background 1.35:1
 *
 * Exported (rather than inlined into the color-mix below) so the contrast test can
 * assert the WCAG floor against the SAME number the theme paints with — the value
 * keeps a single copy (app-theme spec).
 */
export const SELECTION_ALPHA = 0.22;

/**
 * Selection fill. Deliberately `color-mix` off the accent token (`--ome-accent`,
 * which the app maps to `--primary`) rather than a literal selection token:
 * `--primary` is the single human-accent token (app-theme spec: "MUST NOT 出现
 * 第二处人-accent 定义"), and a literal would be exactly that second copy. Safe
 * here where it would not be in index.css — this theme is injected by
 * CodeMirror at RUNTIME, so it never passes through Lightning CSS, whose var()-based color-mix downlevelling is the caveat in
 * CLAUDE.md.
 */
const SELECTION_FILL = `color-mix(in oklch, var(--ome-accent) ${SELECTION_ALPHA * 100}%, transparent)`;

/**
 * The selection rule's two selectors (change: editor-theme-parity, design D1).
 *
 * The focused one MUST mirror CodeMirror's own baseTheme selector segment for
 * segment. CM ships
 *
 *   &light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground
 *
 * at specificity (0,5,0); the obvious `&.cm-focused .cm-selectionBackground` is
 * only (0,3,0) and LOSES, which is how this app shipped dark mode painting CM's
 * factory `#d7d4f0` under near-white text (1.03:1 — invisible). Matching the shape
 * ties the specificity and `StyleModule.mount` puts app themes last, so we win the
 * tie. This is the idiom CM's own official themes use, not a hack.
 *
 * NOT solved with `!important`: that wins too, but erases the information about
 * which layer ought to win, and forces every later legitimate override to escalate.
 *
 * Exported so `selectionRule.test.ts` can assert the specificity relationship
 * against the INSTALLED @codemirror/view — the silent-override failure mode has no
 * other alarm (app-theme spec: 静默失效可被发现).
 */
export const SELECTION_SELECTOR_UNFOCUSED = ".cm-selectionBackground";
export const SELECTION_SELECTOR_FOCUSED =
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground";

/**
 * The browser's native selection, switched off inside the document content — the
 * ONE native-selection rule in the app (spec: live-preview-editor / 选区只有一种
 * 画法; change: selection-paint, design D1).
 *
 * `drawSelection()` hides the native selection only inside `.cm-line`, and forces
 * it to the system `Highlight` on any focused descendant of `.cm-content` (its
 * `hideNativeSelection`, both `!important`). So everything in the content that is
 * not a line — block widgets and the text and buttons in them, the gaps WebKit
 * paints between blocks, a focused cell / property part editor — showed the OS
 * accent colour (orange on the machine this was found on) on top of, or instead
 * of, our selection colour. Measured: 489 selected text nodes outside any line in
 * `fixtures/README.md` under ⌘A, every one in the table.
 *
 * Scope is `.cm-content` and everything in it, nested editors included (this
 * theme is shared with them, and the selector is a descendant one). The find
 * panel's input sits outside `.cm-content` and keeps its native selection; there
 * is no native text input inside the content (part-editor gate).
 *
 * `!important` because CM's rules are: a normal declaration never beats an
 * important one, however specific. `&.cm-editor` (the theme class and
 * `.cm-editor` sit on the same root) adds the one class that makes ours strictly
 * more specific than CM's `:focus` pair — out-ranked, not left to mount order.
 * `selectionRule.test.ts` checks both against the INSTALLED @codemirror/view.
 */
export const NATIVE_SELECTION_SELECTORS = [
  "&.cm-editor .cm-content::selection",
  "&.cm-editor .cm-content ::selection",
  "&.cm-editor .cm-content :focus::selection",
  "&.cm-editor .cm-content :focus ::selection",
] as const;
export const NATIVE_SELECTION_OFF = { backgroundColor: "transparent !important" } as const;

/**
 * A rendered block's selected look — the ONE rule for it (spec: live-preview-
 * editor / 选区只有一种画法; change: selection-paint, design D3). The state is set
 * only by `selectionPaint.ts`, on a host the block framework owns.
 *
 * The host's own fill is `--background` while covered: CM's selection layer may
 * or may not be drawn underneath (a block in the middle of the range gets the
 * layer's big "between" rectangle, a block that starts or ends it gets nothing),
 * and masking it makes the result the same in every position — surface + ONE
 * `SELECTION_FILL`, the colour a selected line has, never a double 39% layer. The
 * fill itself lies OVER the content so opaque content (an image) shows selected
 * too, the way browsers tint a selected image. The editor sits straight on the
 * body's `--background` (measured), so the mask is invisible.
 */
// A block holding the landing it cannot paint finer is drawn as selected — the
// same one look (spec: caret-rules / 落点看得见, outcome 3).
const SELECTED_HOST = `.${HOST_CLASS}[${COVERED_ATTR}], .${HOST_CLASS}[${LANDING_ATTR}]`;
const SELECTED_HOST_AFTER = `.${HOST_CLASS}[${COVERED_ATTR}]::after, .${HOST_CLASS}[${LANDING_ATTR}]::after`;
const selectedStateStyles = {
  [`.${HOST_CLASS}`]: { position: "relative" },
  // An image inside a line: shrink-wraps the image, still capped at the column.
  [`.${HOST_INLINE_CLASS}`]: { display: "inline-block", maxWidth: "100%", verticalAlign: "top" },
  [SELECTED_HOST]: { backgroundColor: "var(--ome-bg)" },
  [SELECTED_HOST_AFTER]: {
    content: "''",
    position: "absolute",
    inset: "0",
    background: SELECTION_FILL,
    pointerEvents: "none",
  },
};

/**
 * Editor chrome + markdown typography. Rendered styling (bold shown bold,
 * heading sizes, ...) comes from the highlight style and applies in both
 * source and preview states; the live-preview plugin only hides/reveals marks.
 */

/**
 * The outer editor's LAYOUT (spec: block-editing / 嵌套编辑器不受外层样式影响;
 * change: block-framework, design D3). Every selector here is a CHILD chain from
 * the editor root, never a bare `.cm-content` / `.cm-scroller`: `EditorView.theme`
 * prefixes keys as DESCENDANT selectors (`.ͼx .cm-content`), so a bare key also
 * matches any editor nested inside a block widget — the 2rem / 40vh content
 * padding, the 41rem max-width and the scroller inset all leaked into the table-
 * cell spike and stretched a one-line cell to 473px. Rendering styles that
 * nested editors SHOULD share live in `editorMarkTheme` below.
 */
/**
 * The type of code in the rendered document — inline code and every line of a
 * fenced block (spec: live-preview-editor / 代码只有一种字体). One object, so
 * the two cannot drift; gate: `codeFont.gate.test.ts`, harness case `code-font`.
 */
export const CODE_TYPE = { fontFamily: "var(--ome-font-mono)", fontSize: TYPE_SCALE.code.fontSize } as const;

export const editorLayoutTheme = EditorView.theme({
  "&": {
    height: "100%",
    // The content zoom's editor share (spec: UI 缩放; ./contentZoom.ts): every
    // size inside the document is in em, so this one root size scales it all.
    fontSize: zoomed(TYPE_SCALE.body.fontSize),
  },
  "& > .cm-scroller": {
    // The prose stack is a token (its default and CJK fallbacks: ./tokens.ts).
    fontFamily: "var(--ome-font)",
    lineHeight: TYPE_SCALE.body.lineHeight,
    // Horizontal breathing room lives on the SCROLLER, not `.cm-content`
    // (change: selection-highlight-text-column; spec: live-preview-editor / 选区高亮
    // 限定在文本列内). drawSelection measures the selection block from `.cm-content`'s
    // bounding rect (± the first `.cm-line`'s padding — see @codemirror/view
    // rectanglesForRange). While the 2.5rem inset sat on `.cm-content`, that rect was
    // the PADDED box, so a multi-line selection painted across the 2.5rem padding =
    // "past the text" on both sides. Hosting the inset here makes `.cm-content` the
    // pure text column, so the selection block stops at the text edges. This padding
    // also supplies the narrow-pane gutter the content padding used to (pane < column
    // width: text keeps a 2.5rem breathing edge instead of hugging the pane border).
    //
    // HORIZONTAL ONLY. The vertical padding used to sit here too and moved to
    // `.cm-content` (change: editor-blank-area-click) — see the note there. The two
    // directions have OPPOSITE homes and neither may follow the other: horizontal
    // here (or the selection block paints past the text), vertical there (or the
    // blank below the text isn't clickable).
    padding: "0 2.5rem",
  },
  "& > .cm-scroller > .cm-content": {
    // Pure text column = former visible width (46rem − 2×2.5rem). maxWidth retuned
    // from 46rem so the on-screen text width AND centering are unchanged: on a wide
    // pane the scroller's 2.5rem pad + the auto margins reproduce the old
    // (auto-margin + 2.5rem content-pad) x-position exactly; on a narrow pane the
    // scroller pad reproduces the old inset. Only the box drawSelection tracks
    // shrinks — from padded box to text column — which is the whole fix.
    // Scales with the content zoom so a line keeps its measure (./contentZoom.ts).
    maxWidth: zoomed(TYPE_SCALE.measure),
    margin: "0 auto",
    // Zero horizontal (moved to the scroller, see above) — keep it at 0 so no padding
    // re-inflates the box the selection layer measures.
    //
    // VERTICAL padding lives HERE, not on the scroller (change: editor-blank-area-click;
    // spec: live-preview-editor / 正文之外的空白区落点). Two CM facts force it:
    //   1. CM registers its mouse handlers on `contentDOM` only (`ensureHandlers`:
    //      `dom = this.view.contentDOM`). Padding on the scroller is OUTSIDE that box,
    //      so clicks there never reach CM — and since the scroller isn't
    //      contenteditable, they drop focus instead. That made every pixel of the
    //      2rem/40vh a dead zone: with the text tall enough to fill the scroller's
    //      content box, the blank below the last line was 100% dead ("only the last
    //      line is clickable").
    //   2. CM MEASURES this element's paddingTop/paddingBottom into `documentPadding`
    //      / `contentHeight` (viewState). Padding on the scroller is invisible to it —
    //      `view.documentPadding` read {top: 0, bottom: 0} while 435px of blank existed.
    // Hosting it here makes the whole vertical extent part of contentDOM, so clicks
    // land via CM's native mouse handling (drag-select and multi-click come free) and
    // CM's height model matches the DOM (`documentTop` == the first line's top, so
    // coordinate hit-testing does not shift by a paddingTop).
    // Horizontal blank (outside the 41rem column) stays dead by design: widening this
    // box would regress 选区高亮限定在文本列内 — `rectanglesForRange` reads only
    // `contentRect.left/right`, which is exactly why the vertical move is safe.
    padding: "2rem 0 40vh",
    caretColor: "var(--ome-fg)",
  },
});

/**
 * Rendering styles (marks, line classes, caret and selection colours), shared
 * on purpose by the outer editor and any nested editor (`nestedEditorBase()`).
 *
 * A node that carries `.ome-state` sets its resting fill with `backgroundColor`,
 * never the `background` shorthand: the shorthand also resets
 * `background-image`, which is where `.ome-state` paints its layer (design D2/D10).
 */
export const editorMarkTheme = EditorView.theme({
  ...insetStyles,
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--ome-fg)", borderLeftWidth: "2px" },
  // No drawn caret where keys do not type (spec: caret-rules / 落点看得见, L3):
  // `base.ts` marks a non-editable view; selection ranges keep painting.
  "&.om-no-caret > .cm-scroller > .cm-cursorLayer": { display: "none" },
  // The landing's visible stand-in (a hidden URL's link text in Reading mode)
  // and the landing painted in a table cell: the selection fill.
  ".om-landing": { background: SELECTION_FILL },
  // Marks painted inside table cells are `<mark>`s: keep the text's own ink.
  "mark.om-landing, mark.cm-searchMatch": { color: "inherit" },
  [`${SELECTION_SELECTOR_UNFOCUSED}, ${SELECTION_SELECTOR_FOCUSED}`]: {
    background: SELECTION_FILL,
  },
  [NATIVE_SELECTION_SELECTORS.join(", ")]: NATIVE_SELECTION_OFF,
  ...selectedStateStyles,

  // Heading fold (change: heading-fold + heading-fold-inline-toggle; spec:
  // live-preview-editor / 标题折叠). The clickable handle is an INLINE chevron
  // hugging each heading — NOT CM's left-edge gutter, whose arrow stranded far
  // from the heading once the centred content column narrowed. The heading line
  // becomes a positioning context; the handle is absolutely-positioned just left
  // of the text so it never shifts the heading. Hidden until the heading line is
  // hovered; stays visible while that heading is folded so there's always a way
  // back.
  ".om-fold-heading, .om-fold-list": { position: "relative" },
  // The handle is an sm icon button from the editor's one factory
  // (`controls.ts`, change: editor-controls): its box, corner, glyph colour and
  // hover are the classes'. This rule only PLACES it and shows it. Its x comes
  // from the inset composer (`insets/`, change: editor-insets): a fixed offset
  // left of the marker or heading text, never over a quote bar.
  ".om-fold-toggle": {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    opacity: "0",
    transition: "opacity 0.12s ease",
  },
  // Reveal on line hover; persist while folded (a collapsed section must stay
  // reopenable).
  '.om-fold-heading:hover .om-fold-toggle, .om-fold-list:hover .om-fold-toggle, .om-fold-toggle[aria-expanded="false"]': {
    opacity: "1",
  },
  // Chevron points ▾ (down) when expanded, rotates to ▸ (right) when folded.
  ".om-fold-toggle svg": { transition: "transform 0.12s ease" },
  '.om-fold-toggle[aria-expanded="false"] svg': { transform: "rotate(-90deg)" },
  // The fold placeholder `…` is TEXT, not a box (spec: app-chrome / 折叠占位是
  // 文字,不是盒子): muted, no fill, no frame. The node carries `.ome-state`
  // (foldPlaceholderDOM), so a hover fill appears only under the pointer; the
  // horizontal padding gives that fill somewhere to land. CodeMirror's baseTheme
  // paints a grey box here — the resting values below take it back.
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "var(--ome-radius)",
    color: "var(--ome-muted-fg)",
    padding: "0 0.3em",
    margin: "0 0.1em",
    cursor: "pointer",
  },

  // Live-preview element styles
  ".om-inline-code": {
    ...CODE_TYPE,
    background: "var(--ome-code-bg)",
    borderRadius: "4px",
    padding: "0.1em 0.3em",
  },
  ".om-link": { color: "var(--ome-accent)", cursor: "pointer" },
  // Fallback label for an empty-text link `[](url)` — muted + dotted underline
  // so it reads as "no name, showing the target" (spec: 空文本链接不渲染为空白).
  ".om-link-fallback": {
    color: "var(--ome-muted-fg)",
    textDecoration: "underline dotted",
    textUnderlineOffset: "2px",
    cursor: "pointer",
  },
  ".om-url-chip": {
    display: "inline-flex",
    alignItems: "center",
    verticalAlign: "baseline",
    maxWidth: "18rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    backgroundColor: "var(--ome-code-bg)",
    color: "var(--ome-muted-fg)",
    border: "1px solid var(--ome-border)",
    borderRadius: "var(--ome-radius)",
    padding: "0 0.4em",
    margin: "0 0.1em",
    fontSize: "0.85em",
    fontFamily: "var(--ome-font-mono)",
    cursor: "pointer",
    gap: "0.25em",
  },
  // The chip's glyph is the `link` role, a content mark (`refChip.ts`); the
  // label shrinks and ellipsizes beside it.
  ".om-url-chip-label": { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis" },
  // Quote and callout lines: colour only. Their left inset — the bar(s), the gap,
  // the text start — is the inset composer's (`insets/`, change: editor-insets),
  // which draws one bar per quote level and keeps `.cm-line` paddingLeft 0.
  ".om-blockquote-line": { color: "var(--ome-muted-fg)" },
  // GitHub callouts, Hybrid style (change: callout-rendering; contract in
  // app-theme + live-preview-editor specs): neutral-leaning box + colored left
  // stripe + colored icon/title only — color area kept small so a persistent
  // callout never competes with the "who's acting" accents. `--cc` is set per
  // type on the line class and inherited by the header widget inside it.
  ".om-callout-note": { "--cc": "var(--ome-callout-note)" },
  ".om-callout-tip": { "--cc": "var(--ome-callout-tip)" },
  ".om-callout-important": { "--cc": "var(--ome-callout-important)" },
  ".om-callout-warning": { "--cc": "var(--ome-callout-warning)" },
  ".om-callout-caution": { "--cc": "var(--ome-callout-caution)" },
  // The callout's bar and translucent tint are background layers drawn by the
  // inset composer from `--callout-<type>` (`insets/compose.ts`); the tint stays
  // translucent so the selection layer beneath `.cm-content` shows through
  // (spec: 底色元素上的选区可见).
  ".om-callout-first": {
    paddingTop: "0.3em",
    borderTopRightRadius: "6px",
  },
  ".om-callout-last": {
    paddingBottom: "0.3em",
    borderBottomRightRadius: "6px",
  },
  ".om-callout-h": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35em",
    fontWeight: "600",
    color: "var(--cc)",
  },
  ".om-callout-h svg": { display: "block" },
  // Code lines: the fill and the left inset are the inset composer's (a code
  // block inside a quote or list starts at that container's content column);
  // the mirrored right inset lives next to it (`insets/decorate.ts`).
  // The code type is on every line of the block, not on its tokens: a fence
  // with a language is tokenised by that language's parser, whose tags carry
  // no font, and a fence without one is plain text.
  ".om-codeblock-line": CODE_TYPE,
  ".om-codeblock-first": {
    borderRadius: "6px 6px 0 0",
    paddingTop: "0.25em",
    // Positioning context for the absolute copy button living in this line.
    position: "relative",
  },
  ".om-codeblock-last": {
    borderRadius: "0 0 6px 6px",
    paddingBottom: "0.25em",
  },
  // Copy button overlaid top-right; hidden until the block's first line is
  // hovered (or the button is keyboard-focused), so it never clutters the code.
  // An md outline icon button from the one factory (`controls.ts`, change:
  // editor-controls): box, frame, corner and hover are the classes'. Here only
  // its place, its show / hide, and a --background SURFACE — it floats over the
  // code fill, where a transparent button would take the code's colour.
  ".om-code-copy": {
    position: "absolute",
    top: "0.25em",
    // The code line's inner inset moved from padding to a 0.75em transparent right
    // border (change: selection-highlight-text-column, round 2), so this button's
    // abspos containing block (the line's padding box) shrank 0.75em on the right.
    // Subtract that here to keep the button visually 0.4em from the code block's edge.
    right: "calc(0.4em - 0.75em)",
    zIndex: "1",
    backgroundColor: "var(--ome-bg)",
    opacity: "0",
    transition: "opacity 0.12s ease",
  },
  ".om-codeblock-first:hover .om-code-copy, .om-code-copy:focus-visible": {
    opacity: "1",
  },
  // List markers: colour only. The marker box, the hanging indent and the
  // zero-width source indentation are the inset composer's (`insets/`, change:
  // editor-insets; why source spaces cannot be rendered literally: docs/dev-notes.md「比例字体」).
  ".om-list-mark": { color: "var(--ome-accent)" },
  // `@agent` addressing token (change: agent-addressing) — the provenance color
  // (`--agent`, the warm "agent-related" orange, NOT --primary/--destructive) +
  // a touch of weight so "this line is aimed at the agent" reads at a glance.
  // Color only; the raw `@agent` text is never concealed (disk stays plain GFM).
  ".om-agent": { color: "var(--ome-agent)", fontWeight: "600" },
  ".om-hr-widget": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "middle",
  },
  ".om-hr-widget hr": { border: "none", borderTop: "2px solid var(--ome-border)" },
  // Rendered math (change: code-highlight-and-math). MathML lays itself out; we
  // only give block math its own centered line with horizontal scroll for wide
  // equations, and keep inline math on the text baseline.
  // Its sideways scroll and edge cue are HSCROLL_STYLE's (./hscroll.ts).
  ".om-math-block": {
    display: "block",
    textAlign: "center",
    padding: "0.3em 0",
    ...HSCROLL_STYLE,
  },
  ".om-math-inline": { display: "inline-block" },
  // A mermaid diagram (change: editor-mermaid): centred — mermaid sizes its SVG
  // to width 100% with a max-width of its natural width, so a wider diagram
  // scales down to the column, but only to the readable floor (`min-width` set
  // by `MermaidWidget`; change: mermaid-large-diagrams, design D5); past that it
  // scrolls sideways in its own box. A scroll container still clips what it
  // paints, and `contain: paint` stays: contained (design D10), whatever a
  // diagram's CSS might still try, it paints only inside its own box.
  ".om-mermaid": {
    display: "block",
    position: "relative",
    // Sideways scroll and its cue: the one definition (`hscroll.ts`; watcher in `MermaidWidget`).
    ...HSCROLL_STYLE,
    overflowY: "hidden",
    // `inline-size` as on `.om-table-wrap`: the box's width is the column's,
    // never the diagram's, so a wide diagram scrolls in here and never makes
    // `.cm-content` (and the editor) scroll sideways.
    contain: "inline-size paint",
    textAlign: "center",
    padding: "0.5em 0",
    cursor: "text",
  },
  ".om-mermaid svg": { maxWidth: "100%", height: "auto" },
  // A large diagram's hint inside its placeholder (change: mermaid-large-diagrams):
  // centred words and the Render button, in the muted ink.
  ".om-mermaid-hint": {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5em",
    padding: "0.5em 1em",
    textAlign: "center",
    color: "var(--ome-muted-fg)",
  },
  ".om-mermaid-hint p": { margin: "0" },
  ".om-math-block math, .om-math-inline math": { fontSize: "1.05em" },
  // The one placeholder (change: render-placeholder-size, design D2): a
  // rendered thing not drawn yet. A quiet empty box — the code surface, the
  // editor radius, no animation; padding, never margin, so CodeMirror measures
  // all of it. Its size is set per box from the one size order (`blocks/pending.ts`).
  ".om-pending": {
    backgroundColor: "var(--ome-code-bg)",
    borderRadius: "var(--ome-radius)",
    boxSizing: "border-box",
    cursor: "text",
  },
  // A block box centres what a deferred block puts in it (its content slot).
  '.om-pending[data-om-pending="block"]': { display: "flex", flexDirection: "column", justifyContent: "center", margin: "0", padding: "0.3em 0" },
  '.om-pending[data-om-pending="inline"]': { display: "inline-block", verticalAlign: "bottom" },
  // A renderer that could not render: its source stays, with this quiet mark
  // (change: block-fallback, design D2). Underline, not colour or an icon —
  // it takes no room and pushes nothing; muted, not --destructive (red is for
  // real errors). The reason is the mark's hover title (`blocks/render.ts`).
  ".om-render-failed": {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: "var(--ome-muted-fg)",
    textUnderlineOffset: "3px",
    cursor: "help",
  },
  ".om-checkbox": {
    // Size and gap: `insets/decorate.ts` (part of the item's marker region).
    verticalAlign: "middle",
    accentColor: "var(--ome-accent)",
    cursor: "pointer",
  },
  ".om-task-done": { textDecoration: "line-through", color: "var(--ome-muted-fg)" },
  // The one box rule for images: never wider than the column, height following
  // the ratio when the column caps a written width (change: image-size, D3).
  ".om-image": { maxWidth: "100%", height: "auto", borderRadius: "6px", display: "block", margin: "0.25em 0" },
  // The image's frame (`imageElement.ts`): inside a line — a table cell's text
  // and its picture share a row — and never wider than its column, which in a
  // table is the cell (change: table-cell-images, D3).
  ".om-image-frame": { display: "inline-block", maxWidth: "100%", verticalAlign: "top", position: "relative" },
  // Drag-to-resize's grip (`imageResize.ts`; change: image-resize, D3): an md
  // ghost icon button from the editor's one factory (`controls.ts`, change:
  // editor-controls) — the ruler's square, the one control corner, the hover /
  // pressed layers of `.ome-state`, the glyph muted and rising to --foreground
  // in a state, like a panel head's ⤢ / ✕. This rule only places and shows it.
  // One difference: a ghost button is transparent at rest and would vanish on
  // a picture, so it sits on --muted, a SURFACE colour (never a state token —
  // those are only `.ome-state`'s). Dragging declares `aria-pressed`.
  // In every image frame's bottom-right corner, 6px in; shown only on an
  // EDITABLE surface — reading mode's content is `contenteditable="false"` —
  // while the picture is hovered or dragged. On a picture under 32px tall
  // (`data-om-small`, set by the plugin on hover) it sits outside the corner.
  ".om-image-handle": {
    display: "none",
    position: "absolute",
    right: "6px",
    bottom: "calc(0.25em + 6px)",
    backgroundColor: "var(--ome-muted)",
    cursor: "nwse-resize",
    touchAction: "none",
    userSelect: "none",
  },
  ".om-image-handle > svg": { pointerEvents: "none" },
  ".om-image-frame[data-om-small] > .om-image-handle": { right: `-${CONTROL_SIZE.md.px + 4}px`, bottom: "0.25em" },
  '.cm-content[contenteditable="true"] .om-image-frame:hover > .om-image-handle, .om-image-frame[data-om-resizing] > .om-image-handle':
    { display: "flex" },
  ".om-image-frame[data-om-small][data-om-resizing]::after": { right: "0", bottom: "calc(100% + 2px)" },
  ".om-image-frame[data-om-resizing]::after": {
    content: "attr(data-om-resizing)",
    position: "absolute",
    right: `${CONTROL_SIZE.md.px + 10}px`,
    bottom: "calc(0.25em + 10px)",
    padding: "0 4px",
    borderRadius: "4px",
    font: "11px/16px system-ui, sans-serif",
    fontVariantNumeric: "tabular-nums",
    color: "var(--ome-fg)",
    background: "var(--ome-muted)",
    pointerEvents: "none",
  },
  ".om-image-broken": {
    color: "var(--ome-muted-fg)",
    fontStyle: "italic",
  },
  // Vertical spacing lives on the wrapper as PADDING (inside CM's measured
  // border-box), NOT as margin on the table — margin sits outside the measured
  // box and makes CM under-measure the block, drifting clicks below it
  // (change: live-preview-widget-click-offset).
  // Wide tables scroll horizontally inside their own box instead of squeezing
  // columns / overflowing the document (change: table-cell-render-and-overflow).
  // Only overflow-X — overflow-Y stays default so the vertical padding above
  // doesn't spawn a stray vertical scrollbar.
  //
  // `contain: inline-size`: the wrapper's own width is the column's, never the
  // table's. Without it the wrapper still reports the table's full width as its
  // intrinsic size, `.cm-content` (a flex item with an auto basis) grows to it,
  // and CodeMirror then pins that width as the content's `flex-basis` while the
  // line is in view — on a pane narrower than one table (a phone, a narrow
  // embed) every line of text runs off the right edge instead of the table
  // scrolling in its own box (change: editor-site, found on the 390px page).
  //
  // The sideways scroll and its edge cue are HSCROLL_STYLE's (./hscroll.ts).
  ".om-table-wrap": { padding: "0.5em 0", ...HSCROLL_STYLE, contain: "inline-size" },
  ".om-table": {
    borderCollapse: "collapse",
    // `max-content`, NOT `auto`: an auto-layout table shrinks to fit its container
    // (squeezing cells until CJK text wraps char-by-char — looks compressed, never
    // scrolls). `max-content` sizes to the columns' natural width so a wide table
    // overflows the wrap and its `overflow-x` produces a real horizontal scroll;
    // a narrow table stays under the wrap width and shows no scrollbar
    // (change: table-cell-render-and-overflow).
    width: "max-content",
    maxWidth: "none",
  },
  ".om-table th, .om-table td": {
    border: "1px solid var(--ome-border)",
    // Padding and the empty-cell floor: the one cell box, shared with the export.
    ...TABLE_CELL_BOX,
    // Default; per-column `:---:` alignment is applied as an inline style on the
    // cell (change: smart-table-editing) and overrides this (spec: 列对齐体现在渲染).
    textAlign: "left",
    // Cap column width so one very long cell wraps instead of stretching the whole
    // table into an endless horizontal scroll (change: table-cell-render-and-overflow).
    // With `width:max-content` on the table, columns grow to content but stop at this
    // cap; `break-word` lets an unbreakable long token (URL / long word) still break.
    maxWidth: "32em",
    overflowWrap: "break-word",
  },
  // Header row distinct from data rows: shaded background + bold (spec: 表头与数据行区分).
  ".om-table th": { backgroundColor: "var(--ome-code-bg)", fontWeight: "600" },
  // In-place cell editing (change: table-inline-cell-editing): the edited cell
  // is the current item — `.ome-state` + data-selected draw the neutral selected
  // fill (change: flat-states); the input sits flush inside it (seamless —
  // inherits font/weight/alignment, no chrome) so editing reads continuous with
  // the render (spec: 单元格原位编辑). `size` (chars) sizes it to content.
  ".om-table-cell-input": {
    font: "inherit",
    color: "inherit",
    textAlign: "inherit",
    background: "transparent",
    border: "none",
    outline: "none",
    padding: "0",
    margin: "0",
    appearance: "none",
    WebkitAppearance: "none",
    minWidth: "2ch",
  },
  // Properties block (change: properties-block; spec: live-preview-editor /
  // Properties 块): frontmatter as name | value rows. Vertical spacing is the
  // wrapper's PADDING (inside CM's measured box), never margin (spec: 渲染态点击
  // 落点精度). Neutral surface; hover and the editing part (data-selected) are
  // `.ome-state`'s fills, like an edited table cell.
  //
  // The block lays out by ITS OWN width, never the viewport's (change:
  // demo-phone-and-list-indent, design D3; spec: Properties 块按自身宽度排版): it is
  // a size container, and below 26em of its own type (≈374px at the default
  // size; em so the content zoom scales it) each row stacks — name and ✕ on
  // one line, the value under it across the full row. An embedded editor's
  // width is not the viewport's, so a media query would be wrong in a side panel.
  ".om-props": {
    padding: "0.4em 0 0.9em",
    fontSize: "0.9em",
    containerType: "inline-size",
  },
  ".om-prop-row": {
    display: "grid",
    gridTemplateColumns: "minmax(6em, 10em) 1fr auto auto",
    alignItems: "baseline",
    columnGap: "0.75em",
    padding: "0.15em 0.5em",
    borderRadius: "var(--ome-radius)",
  },
  ".om-prop-key": {
    color: "var(--ome-muted-fg)",
    cursor: "text",
    overflowWrap: "anywhere",
  },
  ".om-prop-value": { color: "var(--ome-fg)", cursor: "text", overflowWrap: "anywhere", minHeight: "1.5em" },
  ".om-prop-readonly": {
    cursor: "default",
    color: "var(--ome-muted-fg)",
    fontFamily: "var(--ome-font-mono)",
    fontSize: "0.9em",
    whiteSpace: "pre-wrap",
  },
  // The row's ✕ and the foot's Add / Edit source are sm ghost buttons from
  // the editor's one factory (`controls.ts`, change: editor-controls); here
  // only their grid cell and show / hide.
  ".om-prop-del": { gridColumn: "4", alignSelf: "center", visibility: "hidden" },
  ".om-prop-row:hover .om-prop-del": { visibility: "visible" },
  ".om-props-foot": { display: "flex", gap: "0.5em", padding: "0.25em 0.5em 0" },
  "@container (max-width: 26em)": {
    ".om-prop-row": { gridTemplateColumns: "1fr auto auto" },
    ".om-prop-value": { gridColumn: "1 / -1", gridRow: "2" },
    ".om-prop-del": { gridColumn: "3", gridRow: "1" },
  },

  // Find panel (change: find-ui) — chrome and controls use editor tokens only,
  // so the scheme flipping the tokens restyles the panel automatically.
  ".cm-panels": { background: "var(--ome-bg)", color: "var(--ome-fg)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--ome-border)" },
  // The panel's type is the chrome label tier (a class, `findPanel.ts`); its
  // buttons and fields are the editor's factory controls on the md ruler
  // (`controls.ts`, change: editor-controls) — none of them is sized here.
  ".om-find-panel": {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "8px 12px",
  },
  ".om-find-row": { display: "flex", alignItems: "center", gap: "6px" },
  ".om-find-input": {
    flex: "1",
    minWidth: "0",
    background: "var(--ome-bg)",
    color: "var(--ome-fg)",
    // The frame AND the corner are `.ome-field`'s (./primitives.ts): --ome-border
    // at rest, the accent while focused. The height, inset and type size are the
    // md ruler's classes (`editorFieldClasses`). Writing any of them here would
    // fork them.
    fontFamily: "inherit",
    outline: "none",
  },
  ".om-find-input::placeholder": { color: "var(--ome-muted-fg)" },
  // 0/0 error state (design D4): error color on the input, never a dialog.
  ".om-find-input.om-find-no-match": {
    borderColor: "var(--ome-danger)",
    color: "var(--ome-danger)",
  },
  ".om-find-count": {
    color: "var(--ome-muted-fg)",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    minWidth: "3em",
    textAlign: "center",
  },
  // The find buttons (`.om-find-button`) have no rule here: they are the
  // factory's md ghost controls. Hover and the case toggle's aria-pressed are
  // `.ome-state`'s fills, neutral — no blue fill, frame or text (spec:
  // app-chrome). The × close button's "(Esc)" hint lives in its tooltip
  // (find.close; change: editor-interaction-fixes, design D1).
  // Match highlights: replace CM's default yellow with theme-following primary;
  // the selected match is stronger than its siblings.
  ".cm-searchMatch": {
    background: "color-mix(in oklch, var(--ome-accent) 18%, transparent)",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    background: "color-mix(in oklch, var(--ome-accent) 42%, transparent)",
  },

  // Link-target autocompletion menu (change: link-autocomplete). Themed with app
  // variables like the find panel, so `.dark` flipping the variables restyles it;
  // replaces CM's unthemed default box.
  // The former `boxShadow: rgba(0,0,0,0.12)` is gone (change: theme-activation,
  // design D5): it was the last black color literal outside the syntax palette,
  // and a black shadow is invisible on a dark ground anyway. Separation is
  // carried by the solid --background fill + --border outline — the same recipe
  // the five modal overlays use. Deliberately NOT replaced by a lightened shadow
  // or a shadow-color token: that is the first brick of the elevation system
  // design D5 rules out.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    background: "var(--ome-bg)",
    // The surface's ink, themed: CodeMirror's dark baseTheme sets the tooltip
    // to white, and the selected row inherits it once handed back.
    color: "var(--ome-fg)",
    border: "1px solid var(--ome-border)",
    borderRadius: "8px",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    fontSize: "0.9em",
    maxHeight: "16em",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "baseline",
    gap: "0.5em",
    padding: "3px 10px",
    color: "var(--ome-fg)",
    lineHeight: "1.5",
  },
  // The selected completion is `.ome-state` (linkComplete's optionClass) and
  // takes the neutral selected fill — no --primary. CodeMirror's baseTheme
  // paints its own `li[aria-selected] { background: #17c / #347 (#777 / #444
  // while disabled); color: white }` at (0,3,2), which out-ranks `.ome-state`
  // AND leaves a blue background-colour underneath; raising specificity could
  // not remove that colour. So this is the named "hand back" exception (design
  // D10; gate state-not-by-fill): clear the library's colour and re-paint the
  // ONE layer. Only these three values are allowed here.
  ".cm-tooltip-autocomplete > ul > li[aria-selected], .cm-tooltip-autocomplete-disabled > ul > li[aria-selected]": {
    backgroundColor: "transparent",
    backgroundImage: "var(--ome-state-layer, none)",
    color: "inherit",
  },
  ".cm-completionLabel": { flex: "0 1 auto", overflow: "hidden", textOverflow: "ellipsis" },
  ".cm-completionDetail": {
    marginLeft: "auto",
    paddingLeft: "1.5em",
    color: "var(--ome-muted-fg)",
    fontStyle: "normal",
    fontSize: "0.85em",
    whiteSpace: "nowrap",
  },
  // Type icons add visual noise for a two-kind (file/heading) menu; hide them.
  ".cm-completionIcon": { display: "none" },
});

/**
 * The editor's self-contained style base (change: editor-style-tokens): the
 * token defaults and the style primitives. Shared by the outer editor and any
 * nested one, like `editorMarkTheme`.
 */
export const editorStyleFoundation = [editorTokenDefaults, ...editorStyleBase];

/** Both halves, for the outer editor, on the style foundation. */
export const editorTheme = [...editorStyleFoundation, editorLayoutTheme, editorMarkTheme];

export const markdownHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    // Heading sizes: the type scale (./tokens.ts TYPE_SCALE), shared with the
    // rendered-HTML stylesheet (change: render-export).
    { tag: t.heading1, ...headingType(1) },
    { tag: t.heading2, ...headingType(2) },
    { tag: t.heading3, ...headingType(3) },
    { tag: t.heading4, ...headingType(4) },
    { tag: t.heading5, ...headingType(5) },
    { tag: t.heading6, ...headingType(6) },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    // Family only: inline code's size is `CODE_TYPE` on its `.om-inline-code`
    // mark, which wraps this span — a size here too would compound (0.81em).
    { tag: t.monospace, fontFamily: "var(--ome-font-mono)" },
    { tag: t.url, color: "var(--ome-muted-fg)" },
    // No `t.link` rule: the parser tags every bracket pair, link or not. The
    // link colour is `.om-link`, added only where `isLink` says so (linkRefs.ts).
    { tag: t.quote, color: "var(--ome-muted-fg)" },
    { tag: t.contentSeparator, color: "var(--ome-muted-fg)" },
    // Formatting marks (#, **, `, >, ...) — muted when revealed
    { tag: t.processingInstruction, color: "var(--ome-muted-fg)" },
    // Fence info string (`` ```python ``) shares the labelName tag with reference
    // LinkLabels; render it as muted meta so the language id reads like the ``` marks
    // beside it, not as a clickable accent-blue link (change: codeblock-polish).
    { tag: t.labelName, color: "var(--ome-muted-fg)" },
    { tag: t.meta, color: "var(--ome-muted-fg)" },
    // Code block token colors — macOS Terminal ANSI family (change: unify-app-theme,
    // design D4). ANSI hue is the anchor; L re-tuned in oklch (NOT the raw hex — those
    // are white-terminal-toned and go muddy in dark mode) to a single mid value that
    // reads on both the near-white and near-black backgrounds. keyword=Magenta,
    // string=Green, number=amber, typeName=Cyan. function/propertyName carry the code
    // "blue" but are de-tuned per D5 (chroma ~2x below --primary's, L nudged, hue → teal)
    // so a function name never reads as a clickable accent-blue link. The values are
    // the `syntax-*` tokens (./tokens.ts, change: editor-style-tokens) — the one place
    // the editor writes a colour literal.
    { tag: t.keyword, color: "var(--ome-syntax-keyword)" },
    { tag: t.string, color: "var(--ome-syntax-string)" },
    { tag: t.comment, color: "var(--ome-muted-fg)", fontStyle: "italic" },
    { tag: t.number, color: "var(--ome-syntax-number)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--ome-syntax-function)" },
    { tag: t.typeName, color: "var(--ome-syntax-type)" },
    { tag: t.propertyName, color: "var(--ome-syntax-property)" },
    // Extended token coverage (change: code-highlight-and-math). @lezer/highlight
    // parent chains already carry controlKeyword/tagName/integer/… onto the tags
    // above; these are the leftover high-value tags that inherit nothing styled
    // (bool/regexp/escape descend from `literal`, className/namespace from `name`).
    // Each REUSES an existing ANSI literal — no new color: bool→keyword magenta,
    // regexp→string green, escape→number amber, className/namespace→typeName cyan.
    // Plain variableName + operators stay foreground on purpose (calmer, not VS Code).
    { tag: t.bool, color: "var(--ome-syntax-keyword)" },
    { tag: t.regexp, color: "var(--ome-syntax-string)" },
    { tag: t.escape, color: "var(--ome-syntax-number)" },
    { tag: [t.className, t.namespace], color: "var(--ome-syntax-type)" },
  ]),
);

/**
 * Source-mode variant: same tag→color/weight mapping as markdownHighlighting
 * but with every fontSize/lineHeight stripped — uniform type size is the
 * vim-style plaintext contract (palette-polish design D2; 2026-07-04 lesson:
 * enlarged headings break the $EDITOR plaintext expectation). Color overlap
 * with markdownHighlighting is accepted over a shared toggled style.
 */
export const sourceHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    // All heading levels identical: bold + color, never size (still separable
    // from t.strong, which stays foreground-colored).
    { tag: t.heading, fontWeight: "700", color: "var(--ome-accent)" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.monospace, fontFamily: "var(--ome-font-mono)" },
    { tag: t.url, color: "var(--ome-muted-fg)" },
    { tag: t.link, color: "var(--ome-accent)" },
    { tag: t.quote, color: "var(--ome-muted-fg)" },
    { tag: t.contentSeparator, color: "var(--ome-muted-fg)" },
    { tag: t.processingInstruction, color: "var(--ome-muted-fg)" },
    // Fence info string (`` ```python ``) shares the labelName tag with reference
    // LinkLabels; render it as muted meta so the language id reads like the ``` marks
    // beside it, not as a clickable accent-blue link (change: codeblock-polish).
    { tag: t.labelName, color: "var(--ome-muted-fg)" },
    { tag: t.meta, color: "var(--ome-muted-fg)" },
    // Same Terminal ANSI family as markdownHighlighting (design D4/D5); kept in
    // lockstep with that block by value.
    { tag: t.keyword, color: "var(--ome-syntax-keyword)" },
    { tag: t.string, color: "var(--ome-syntax-string)" },
    { tag: t.comment, color: "var(--ome-muted-fg)", fontStyle: "italic" },
    { tag: t.number, color: "var(--ome-syntax-number)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--ome-syntax-function)" },
    { tag: t.typeName, color: "var(--ome-syntax-type)" },
    { tag: t.propertyName, color: "var(--ome-syntax-property)" },
    // Extended token coverage (change: code-highlight-and-math); kept in lockstep
    // with markdownHighlighting above by value. See that block for rationale.
    { tag: t.bool, color: "var(--ome-syntax-keyword)" },
    { tag: t.regexp, color: "var(--ome-syntax-string)" },
    { tag: t.escape, color: "var(--ome-syntax-number)" },
    { tag: [t.className, t.namespace], color: "var(--ome-syntax-type)" },
  ]),
);
