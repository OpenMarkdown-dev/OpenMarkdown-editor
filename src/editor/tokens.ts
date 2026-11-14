import { EditorView } from "@codemirror/view";
import { MONO_FONT_FAMILY } from "@/lib/fonts";

/**
 * THE EDITOR'S DESIGN TOKENS — the one table (spec: editor-host / 编辑器样式自成
 * 一体; change: editor-style-tokens, design D1–D3).
 *
 * The editor ships to hosts that have none of the app's CSS (no Tailwind, no
 * index.css, no app tokens), so it styles itself ONLY through `--ome-<role>`
 * custom properties, and brings a light and a dark default for every one of
 * them. Every colour, corner and font the editor paints with is a role here;
 * editor code writes `var(--ome-<role>)` and never a literal or another
 * variable (gate: `editorStyle.gate.test.ts`). This file is the only place in
 * the editor a colour literal may be written.
 *
 * WHERE THE DEFAULTS LIVE (design D2): injected by CodeMirror, not a CSS file —
 * nothing for an embedder to import, and the light / dark half follows the
 * editor environment's `colorScheme` through CM's own `&light` / `&dark`
 * classes. They are declared on the OUTERMOST editor's root under `:where()`,
 * at specificity zero, so:
 *   - a host overrides a token by declaring it on `.cm-editor` (any selector
 *     beats zero) — the app maps its semantic tokens there (index.css), which
 *     is how the app keeps ONE source for every value it renders;
 *   - a nested editor (a table cell being edited) declares nothing and
 *     inherits its outer editor's values, so it never shows the light
 *     defaults inside a dark editor (nested editors carry no scheme of their
 *     own).
 * A token set on an ANCESTOR of the editor (`:root`) does not reach it — the
 * root's own default wins over inheritance. That is the stated contract: set
 * tokens on `.cm-editor`.
 *
 * The defaults MIRROR the app's palette (index.css), so an embedder that sets
 * nothing gets the OpenMarkdown look; `tokens.test.ts` holds every mapped
 * default equal to the app value it is mapped from — the mirror cannot drift
 * (design D3, a stated trade-off: two copies, one gate).
 */

type TokenValue = string | { light: string; dark: string };

/** Every token: role → default (one value, or a light and a dark one). */
export const EDITOR_TOKENS = {
  /** The document surface, and a floating control's resting surface. */
  bg: { light: "oklch(0.99 0.002 95)", dark: "oklch(0.2 0.005 270)" },
  /** Body text, the caret. */
  fg: { light: "oklch(0.25 0.01 95)", dark: "oklch(0.87 0.005 270)" },
  /** A quiet surface (the image grip's resting fill). */
  muted: { light: "oklch(0.96 0.004 95)", dark: "oklch(0.24 0.005 270)" },
  /** Secondary text: marks, meta, placeholders, ghost controls at rest. */
  "muted-fg": { light: "oklch(0.55 0.01 95)", dark: "oklch(0.6 0.01 270)" },
  /** Hairlines: table rules, quote bars, frames. */
  border: { light: "oklch(0.91 0.005 95)", dark: "oklch(0.29 0.005 270)" },
  /** The human accent: links, selection, find hits, focus, list marks. */
  accent: { light: "oklch(0.55 0.17 255)", dark: "oklch(0.64 0.16 255)" },
  /** An error (find with no match). */
  danger: { light: "oklch(0.55 0.19 25)", dark: "oklch(0.65 0.17 25)" },
  /** Agent presence (the `@agent` addressing token). */
  agent: { light: "oklch(0.62 0.15 55)", dark: "oklch(0.7 0.14 55)" },
  /** The spelling squiggle, and nothing else (spec: app-theme / 拼写标记色是一个 token 角色). */
  spelling: { light: "oklch(0.6 0.2 25)", dark: "oklch(0.68 0.18 25)" },
  /** Inline code, code blocks, table headers — translucent, so the selection shows through. */
  "code-bg": { light: "oklch(0.25 0.01 95 / 0.05)", dark: "oklch(0.87 0.005 270 / 0.06)" },
  "callout-note": { light: "oklch(0.52 0.15 250)", dark: "oklch(0.7 0.13 250)" },
  "callout-tip": { light: "oklch(0.52 0.12 150)", dark: "oklch(0.72 0.11 150)" },
  "callout-important": { light: "oklch(0.52 0.15 300)", dark: "oklch(0.7 0.13 300)" },
  "callout-warning": { light: "oklch(0.62 0.12 82)", dark: "oklch(0.78 0.11 82)" },
  "callout-caution": { light: "oklch(0.54 0.17 28)", dark: "oklch(0.68 0.15 28)" },
  /** The two state layers (`.ome-state`, `./primitives.ts`); read nowhere else. */
  "state-hover": { light: "oklch(0.25 0.01 95 / 0.05)", dark: "oklch(0.87 0.005 270 / 0.07)" },
  "state-selected": { light: "oklch(0.25 0.01 95 / 0.09)", dark: "oklch(0.87 0.005 270 / 0.12)" },
  /** The one control corner (and a state fill's). */
  radius: "6px",
  /**
   * The document's prose stack. CJK fallbacks: the Chinese faces carry no
   * Hangul, so Korean names its own (change: i18n-korean) — Apple SD Gothic
   * Neo on macOS, Malgun Gothic on Windows.
   */
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Apple SD Gothic Neo', 'Microsoft YaHei', 'Malgun Gothic', sans-serif",
  /** Code (spec: live-preview-editor / 代码只有一种字体): the app's one monospace stack. */
  "font-mono": MONO_FONT_FAMILY,
  /**
   * Syntax colours — macOS Terminal ANSI family (change: unify-app-theme, design
   * D4; spec: app-theme / 语法色取自 Terminal ANSI 家族). ANSI hue is the anchor;
   * L re-tuned in oklch to a single mid value that reads on both the near-white
   * and near-black grounds — ONE value for both schemes. keyword=Magenta,
   * string=Green, number=amber, type=Cyan. function / property carry the code
   * "blue" de-tuned per D5 (chroma ~2x below the accent's, hue → teal) so a
   * function name never reads as a clickable link. Contrast ≥ 3.7:1 on both
   * grounds (verified). The app maps none of these: they are the editor's own.
   */
  "syntax-keyword": "oklch(0.58 0.15 328)",
  "syntax-string": "oklch(0.58 0.12 142)",
  "syntax-number": "oklch(0.6 0.12 95)",
  "syntax-function": "oklch(0.58 0.08 235)",
  "syntax-type": "oklch(0.6 0.1 204)",
  "syntax-property": "oklch(0.6 0.06 232)",
} as const satisfies Record<string, TokenValue>;

/**
 * THE TYPE SCALE — the document's sizes, the one table the editor's theme and
 * the rendered-HTML stylesheet both read (change: render-export; spec:
 * render-style / 样式只有一个来源). Moved here from `theme.ts` so an exported
 * document and the editor cannot drift: `theme.ts` builds its heading styles,
 * body size, line height, text column and code size from these entries, and
 * `render/renderStyle.ts` writes the same numbers into its CSS.
 *
 * Sizes inside the document are in `em` (they follow the body size, which the
 * editor zooms); the body size and the column width are the only absolute
 * lengths.
 */
export const TYPE_SCALE = {
  body: { fontSize: "16px", lineHeight: "1.7" },
  /** The text column (the editor's `.cm-content` max-width). */
  measure: "41rem",
  /** Code type size (inline and fenced): `theme.ts` CODE_TYPE. */
  code: { fontSize: "0.9em" },
  /** h1 … h6. `muted` = drawn in `--ome-muted-fg` (h6). */
  headings: [
    { fontSize: "1.8em", fontWeight: "700", lineHeight: "1.3", muted: false },
    { fontSize: "1.5em", fontWeight: "700", lineHeight: "1.3", muted: false },
    { fontSize: "1.25em", fontWeight: "700", lineHeight: null, muted: false },
    { fontSize: null, fontWeight: "700", lineHeight: null, muted: false },
    { fontSize: "0.9em", fontWeight: "700", lineHeight: null, muted: false },
    { fontSize: "0.85em", fontWeight: "700", lineHeight: null, muted: true },
  ],
} as const;

/**
 * The table cell's box — ONE definition the editor theme (`.om-table th, .om-table
 * td` in `theme.ts`) and the exported document's stylesheet (`th, td` in
 * `render/renderStyle.ts`) both spread (spec: live-preview-editor / 空单元格保有可点的
 * 最小尺寸; change: render-placeholder-size, design D7). Besides the padding, a
 * floor so an empty cell can be seen and clicked: about three characters wide,
 * and one text line tall. Table cells ignore `min-height` (CSS 2.1 leaves it
 * undefined for cells; browsers drop it), so the floor is the cell's `height`,
 * which for a table cell acts as a minimum: one line plus the vertical padding.
 * A cell with text grows past it as before. Gate: `tableCellBox.test.ts`.
 */
export const TABLE_CELL_BOX = {
  // The floor below counts the padding: border-box here, not only from the
  // editor's primitives — the exported document has no box-sizing reset.
  boxSizing: "border-box",
  padding: "0.3em 0.75em",
  minWidth: "3ch",
  height: "calc(1lh + 0.6em)",
} as const;

/** One heading level's CSS declarations (camelCase keys), from TYPE_SCALE. */
export function headingType(level: 1 | 2 | 3 | 4 | 5 | 6): Record<string, string> {
  const h = TYPE_SCALE.headings[level - 1];
  const out: Record<string, string> = { fontWeight: h.fontWeight };
  if (h.fontSize) out.fontSize = h.fontSize;
  if (h.lineHeight) out.lineHeight = h.lineHeight;
  if (h.muted) out.color = "var(--ome-muted-fg)";
  return out;
}

export type EditorToken = keyof typeof EDITOR_TOKENS;

/** The custom property of a token: `--ome-<role>`. */
export const tokenProperty = (token: EditorToken): string => `--ome-${token}`;

/** A token's default for one scheme. */
export function tokenDefault(token: EditorToken, scheme: "light" | "dark"): string {
  const v: TokenValue = EDITOR_TOKENS[token];
  return typeof v === "string" ? v : v[scheme];
}

function declarations(scheme: "light" | "dark"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of Object.keys(EDITOR_TOKENS) as EditorToken[]) out[tokenProperty(token)] = tokenDefault(token, scheme);
  return out;
}

/** The outermost editor only: a nested one inherits its outer editor's values. */
const OUTERMOST = ":not(.cm-editor .cm-editor)";

/**
 * The defaults, declared on the outermost editor's root at specificity zero
 * (`:where`), per scheme. CM turns `&light` / `&dark` into the class the
 * `darkTheme` facet puts on the root — the editor environment's colorScheme.
 * Exported so the tests can read the selectors they become.
 */
export const TOKEN_DEFAULT_SELECTORS = {
  light: `:where(&light${OUTERMOST})`,
  dark: `:where(&dark${OUTERMOST})`,
} as const;

/**
 * The document surface (spec: editor-host / 底色与前景色 token 涂编辑器根): the
 * outermost editor's root is painted with `--ome-bg` and inked with `--ome-fg`,
 * so a host that overrides those two tokens changes the surface without
 * writing `background` / `color` itself. Zero specificity, like the defaults:
 * any host rule on `.cm-editor` wins. A nested editor (a table cell being
 * edited) paints nothing — it sits on its cell's own surface and inherits ink.
 * In the app the tokens map to `--background` / `--foreground` (index.css), the
 * ground the editor already sat on, so the app does not change.
 */
export const ROOT_PAINT_SELECTOR = `:where(&${OUTERMOST})`;

export const editorTokenDefaults = EditorView.baseTheme({
  [TOKEN_DEFAULT_SELECTORS.light]: declarations("light"),
  [TOKEN_DEFAULT_SELECTORS.dark]: declarations("dark"),
  [ROOT_PAINT_SELECTOR]: { backgroundColor: "var(--ome-bg)", color: "var(--ome-fg)" },
});

/**
 * The scheme, as a stable attribute on the editor's root (spec: editor-host /
 * 根元素带稳定的明暗属性; change: editor-integration-fixes, design D1):
 * `data-ome-scheme="light" | "dark"`, the ONE selector a host keys per-scheme
 * token values on (`.cm-editor[data-ome-scheme="dark"] { … }`). CodeMirror's
 * own light / dark marker is a generated class name (`&dark` compiles to `ͼ…`),
 * not something a host can write; there is no `cm-light` / `cm-dark`.
 *
 * Computed from the `darkTheme` facet, which is the editor environment's
 * colorScheme (seeded and kept current by `mountEditor`, `./index.ts`), so the
 * attribute can never disagree with the defaults it sits beside. Installed on
 * the outer editor only: a nested editor carries no scheme of its own and
 * inherits its outer editor's values, so it carries no attribute either.
 */
export const SCHEME_ATTRIBUTE = "data-ome-scheme";

/** The root's attributes for a scheme — pure, for the tests. */
export const schemeAttributes = (dark: boolean): Record<string, string> => ({ [SCHEME_ATTRIBUTE]: dark ? "dark" : "light" });

export const schemeAttribute = EditorView.editorAttributes.compute([EditorView.darkTheme], (state) =>
  schemeAttributes(state.facet(EditorView.darkTheme)),
);
