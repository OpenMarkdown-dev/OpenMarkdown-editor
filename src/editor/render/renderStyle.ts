import { CALLOUT_TYPES } from "../callout";
import { EDITOR_TOKENS, TYPE_SCALE, headingType, tokenDefault, tokenProperty, type EditorToken } from "../tokens";

/**
 * The stylesheet for the renderer's semantic HTML (spec: render-style; change:
 * render-export) — `h1`, `p`, `blockquote`, `table`, callouts, math, task
 * lists, sized images — GENERATED, never hand-kept.
 *
 * It defines no value of its own:
 *   - every colour, font family and corner is a `var(--ome-<role>)` from the
 *     editor's token table (`../tokens.ts` EDITOR_TOKENS), and the table's
 *     defaults for the chosen scheme are declared once, on `.om-doc`;
 *   - every font size and line height comes from the type scale
 *     (`../tokens.ts` TYPE_SCALE), the same entries the editor's theme reads.
 * So an exported page and the editor cannot drift; the gate
 * `renderStyle.test.ts` fails on a colour or font literal, or a size outside
 * the scale. Spacing (padding, margins, rule widths) is layout, written here
 * as in the editor's own theme.
 *
 * Exports are always light for now (decided 2026-11-06); the dark half is
 * here for the stylesheet package, where a reader's `prefers-color-scheme`
 * picks it (`scheme: "auto"`).
 */
export type StyleScheme = "light" | "dark" | "auto";

/** The class on the element that holds rendered HTML (`<body>` of an export). */
export const DOC_CLASS = "om-doc";

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function rule(selector: string, decls: Record<string, string>): string {
  const body = Object.entries(decls)
    .map(([k, v]) => `  ${kebab(k)}: ${v};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

const v = (token: EditorToken) => `var(${tokenProperty(token)})`;

function tokenDecls(scheme: "light" | "dark"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of Object.keys(EDITOR_TOKENS) as EditorToken[]) out[tokenProperty(token)] = tokenDefault(token, scheme);
  return out;
}

/** Custom properties are written as-is (no kebab conversion of `--ome-*`). */
function propsRule(selector: string, decls: Record<string, string>): string {
  const body = Object.entries(decls)
    .map(([k, val]) => `  ${k}: ${val};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

const D = `.${DOC_CLASS}`;

function rules(): string[] {
  const out: string[] = [];
  out.push(
    rule(D, {
      background: v("bg"),
      color: v("fg"),
      fontFamily: v("font"),
      fontSize: TYPE_SCALE.body.fontSize,
      lineHeight: TYPE_SCALE.body.lineHeight,
      margin: "0",
    }),
  );
  out.push(rule(`${D} .om-doc-body`, { maxWidth: TYPE_SCALE.measure, margin: "0 auto", padding: "2rem 2.5rem" }));
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    out.push(rule(`${D} h${level}`, { ...headingType(level), margin: "1.2em 0 0.4em" }));
  }
  out.push(rule(`${D} p, ${D} ul, ${D} ol, ${D} pre, ${D} table, ${D} blockquote`, { margin: "0 0 0.8em" }));
  out.push(rule(`${D} a`, { color: v("accent"), textDecoration: "none" }));
  out.push(rule(`${D} a:hover`, { textDecoration: "underline" }));
  out.push(rule(`${D} strong`, { fontWeight: "700" }));
  out.push(rule(`${D} del`, { textDecoration: "line-through" }));
  out.push(
    rule(`${D} code`, {
      fontFamily: v("font-mono"),
      fontSize: TYPE_SCALE.code.fontSize,
      background: v("code-bg"),
      borderRadius: v("radius"),
      padding: "0.1em 0.3em",
    }),
  );
  out.push(
    rule(`${D} pre`, {
      background: v("code-bg"),
      borderRadius: v("radius"),
      padding: "0.75em 1em",
      overflowX: "auto",
    }),
  );
  out.push(rule(`${D} pre code`, { background: "none", padding: "0", whiteSpace: "pre" }));
  out.push(
    rule(`${D} blockquote`, {
      borderLeft: `3px solid ${v("border")}`,
      color: v("muted-fg"),
      padding: "0 0 0 1em",
      marginLeft: "0",
    }),
  );
  out.push(rule(`${D} .om-callout`, { borderLeft: "3px solid", padding: "0.4em 1em", margin: "0 0 0.8em", borderRadius: v("radius") }));
  out.push(rule(`${D} .om-callout > :last-child`, { marginBottom: "0" }));
  out.push(rule(`${D} .om-callout-title`, { fontWeight: "700", margin: "0 0 0.3em" }));
  for (const type of CALLOUT_TYPES) {
    const c = v(`callout-${type}` as EditorToken);
    out.push(rule(`${D} .om-callout-${type}`, { borderLeftColor: c }));
    out.push(rule(`${D} .om-callout-${type} .om-callout-title`, { color: c }));
  }
  out.push(rule(`${D} hr`, { border: "none", borderTop: `1px solid ${v("border")}`, margin: "1.5em 0" }));
  out.push(rule(`${D} img`, { maxWidth: "100%", height: "auto", borderRadius: v("radius") }));
  out.push(rule(`${D} .om-image-missing`, { color: v("muted-fg") }));
  out.push(rule(`${D} .om-table-wrap`, { overflowX: "auto", margin: "0 0 0.8em" }));
  out.push(rule(`${D} table`, { borderCollapse: "collapse" }));
  out.push(rule(`${D} th, ${D} td`, { border: `1px solid ${v("border")}`, padding: "0.3em 0.75em", textAlign: "left" }));
  out.push(rule(`${D} th`, { background: v("code-bg"), fontWeight: "700" }));
  out.push(rule(`${D} .om-align-center`, { textAlign: "center" }));
  out.push(rule(`${D} .om-align-right`, { textAlign: "right" }));
  out.push(rule(`${D} .om-align-left`, { textAlign: "left" }));
  out.push(rule(`${D} li.om-task`, { listStyle: "none" }));
  out.push(rule(`${D} li.om-task input`, { margin: "0 0.4em 0 -1.4em", accentColor: v("accent") }));
  out.push(rule(`${D} .om-agent`, { color: v("agent") }));
  out.push(rule(`${D} .om-math-block`, { overflowX: "auto", textAlign: "center", margin: "0 0 0.8em" }));
  out.push(rule(`${D} .om-mermaid`, { margin: "0 0 0.8em", textAlign: "center" }));
  out.push(rule(`${D} .om-mermaid svg`, { maxWidth: "100%", height: "auto" }));
  out.push(rule(`${D} .om-props`, { fontSize: TYPE_SCALE.code.fontSize }));
  out.push(rule(`${D} .om-props th`, { color: v("muted-fg"), fontWeight: "400" }));
  out.push(rule(`${D} .om-props td`, { whiteSpace: "pre-wrap" }));
  out.push(`@media print {\n${rule(`  ${D} .om-doc-body`, { maxWidth: "none", padding: "0" })}\n${rule(`  ${D} pre code`, { whiteSpace: "pre-wrap" })}\n}`);
  return out;
}

/** The stylesheet text for a scheme. */
export function renderStylesheet(scheme: StyleScheme = "light"): string {
  const head =
    scheme === "auto"
      ? `${propsRule(D, tokenDecls("light"))}\n@media (prefers-color-scheme: dark) {\n${propsRule(`  ${D}`, tokenDecls("dark"))}\n}`
      : propsRule(D, tokenDecls(scheme));
  return `/* Generated by OpenMarkdown from its editor tokens — do not edit. */\n${head}\n${rules().join("\n")}\n`;
}
