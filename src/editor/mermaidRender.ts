import { AFTER_ROOT_ID, diagramDeclarationProblem, mermaidMarkup } from "./diagramMarkup";
import type { SafeMarkup } from "./markup";
import type { ColorScheme } from "./environment";
import { measureMermaidStep, nextDiagramId, type MermaidModule } from "./mermaid";

/**
 * How a diagram is drawn (change: editor-lean-deps, split out of `./mermaid.ts`):
 * the one configuration the built-in Mermaid renders with, its render that
 * borrows and restores Mermaid's global config, the clean-up that brings an
 * SVG inside the diagram profile, and a host renderer's SVG adopted into the
 * editor's id scheme. Loaded with the first diagram an editor draws — never in
 * an editor's first load — and never naming the `mermaid` package (that is
 * `./mermaidImport.ts`).
 */

// --- The configuration we render with ---------------------------------------

/**
 * One config, always applied whole (design D4). `securityLevel: "strict"`
 * sanitizes labels and disables click handlers — a document is untrusted
 * input. `suppressErrorRendering` keeps mermaid from drawing its own error
 * "bomb" into the page: a failure is ours to show (the source + mark).
 * A system font stack, so text is measured with the same face it is painted
 * with — no web font that might still be loading when mermaid measures.
 */
export const MERMAID_FONT =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';

export function mermaidConfig(scheme: ColorScheme): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: scheme === "dark" ? "dark" : "default",
    fontFamily: MERMAID_FONT,
    logLevel: "fatal",
    maxTextSize: MAX_TEXT_SIZE,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    secure: SECURE_KEYS,
  };
}

/** mermaid's own default, stated so a directive cannot raise it. */
const MAX_TEXT_SIZE = 50000;

/**
 * Config keys a diagram's `%%{init}%%` directive or front-matter `config:` may
 * NOT set (mermaid deletes them from directives, at any depth) — design D10.
 * mermaid's defaults, plus what keeps the diagram inside our profile: labels
 * stay SVG text (`htmlLabels`), no document-supplied CSS (`themeCSS`) and no
 * font stack carrying CSS (`fontFamily`, `altFontFamily`). `theme` and
 * `themeVariables` stay overridable: mermaid reduces each variable to colour
 * characters (`[\d "#%(),.;A-Za-z]`, no `:` or braces), so they can recolour a
 * diagram but not add a property.
 */
export const SECURE_KEYS = [
  "secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges",
  "htmlLabels", "themeCSS", "fontFamily", "altFontFamily",
];

/**
 * Give a host's diagram the editor's root id (`om-mermaid-N`), the one the
 * diagram profile scopes ids, `url(#…)` references and CSS by: its own root id
 * — wherever it starts an id or a `#` reference (`url(#…)`, a `<style>`
 * selector) and the name is the root's by `derivedFromRoot` (so mermaid's
 * `<id>_flowchart-v2-pointEnd` markers too, never a longer `<id>0`) — becomes
 * ours; an SVG with no root id gets ours. Renaming only; the result is still
 * vetted in full.
 */
// The root element's start tag, by name (a diagram is not an editor glyph).
const ROOT_START = new RegExp(String.raw`^\s*<(?:svg)\b`);
const ROOT_ID = new RegExp(String.raw`^\s*<(?:svg)\b[^>]*?\sid="([^"]+)"`);

export function adoptDiagram(drawing: string, id: string): string {
  const root = ROOT_ID.exec(drawing);
  if (!root) return drawing.replace(ROOT_START, (start) => `${start} id="${id}"`);
  const own = root[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return drawing.replace(new RegExp(`(\\sid="|#)${own}${AFTER_ROOT_ID}`, "g"), `$1${id}`);
}

/**
 * Render `body` with our config, leaving mermaid's site config as we found it.
 * Resolves to the sanitised SVG, or rejects with mermaid's own error or the
 * sanitiser's refusal.
 */
export function renderWith(mermaid: MermaidModule, body: string, scheme: ColorScheme): Promise<SafeMarkup> {
  const before = mermaid.mermaidAPI.getSiteConfig();
  mermaid.initialize(mermaidConfig(scheme));
  const start = performance.now();
  return mermaid.mermaidAPI
    .render(nextDiagramId(), body)
    .then(
      // Through the editor's one HTML sink (`./markup.ts`): anything outside the
      // diagram profile throws here and the diagram falls back to its source.
      (r) => {
        const laidOut = measureMermaidStep("render", start);
        const svg = mermaidMarkup(normalizeDiagram(r.svg));
        measureMermaidStep("sanitize", laidOut);
        return svg;
      },
      (e: unknown) => {
        throw new Error(mermaidReason(e));
      },
    )
    .finally(() => mermaid.initialize(before));
}

/**
 * Bring mermaid's own output inside the diagram profile before it is vetted
 * (design D9, D10) — by dropping declarations, never adding anything:
 *   - mermaid's themes carry rules for HTML it does not draw here (tooltips,
 *     popup menus: `position: absolute`, `z-index`, `margin`), and a document's
 *     `classDef` / `style` statements can ask for `position: fixed` or a
 *     viewport-sized box. Every declaration outside `DIAGRAM_CSS_PROPERTIES`
 *     (or failing `diagramDeclarationProblem`) is dropped, in the `<style>` and
 *     in `style` attributes alike — such a request is neutralised, the diagram
 *     still draws;
 *   - the dark theme paints with `url(#<id>-gradient)` in every diagram, but
 *     only some types define that gradient; a `url()` to an id the SVG does not
 *     define is dropped (it points at nothing).
 * A mistake here can only make `mermaidMarkup` refuse a diagram, never let
 * anything through: the result is still vetted in full.
 */
export function normalizeDiagram(diagram: string): string {
  const ids = new Set([...diagram.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const root = /\sid="([^"]+)"/.exec(diagram); // mermaid writes the root svg first, its id first
  const scope = "#" + (root ? root[1] : "");
  const keep = (body: string, onRoot: boolean) =>
    body
      .split(";")
      .filter((decl) => {
        const colon = decl.indexOf(":");
        if (colon < 1) return decl.trim() === "";
        const value = decl.slice(colon + 1);
        const dangling = [...value.matchAll(/url\(\s*#([\w-]+)\s*\)/g)].some((m) => !ids.has(m[1]));
        return !dangling && diagramDeclarationProblem(decl.slice(0, colon), value, onRoot) === null;
      })
      .join(";");
  const rootOnly = (prelude: string) =>
    prelude.split(",").some((sel) => sel.trim().startsWith(scope) && /^[^\s>+~&]*$/.test(sel.trim().slice(scope.length)));
  return diagram
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_all, open: string, css: string, close: string) =>
      open + css.replace(/([^{}]*)\{([^{}]*)\}/g, (_r, prelude: string, body: string) => `${prelude}{${keep(body, rootOnly(prelude))}}`) + close,
    )
    .replace(/(\sstyle=")([^"]*)(")/g, (_all, open: string, body: string, close: string) => open + keep(body, false) + close);
}

/**
 * Mermaid's parse errors are several lines: "Parse error on line N:", the
 * offending line, a caret line, then "Expecting …, got …". The hover shows one
 * line (`failureReason`), so keep the first and the last — where, and what.
 * Rewording only: the error is re-thrown, never swallowed.
 */
export function mermaidReason(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return lines[0] ?? text;
  const reason = `${lines[0]} ${lines[lines.length - 1]}`;
  return reason.length > 200 ? `${reason.slice(0, 199)}…` : reason;
}


/** A host renderer's SVG (`renderDiagram`), as the editor draws it: adopted, brought inside the profile, vetted. */
export function hostDiagram(svg: string): SafeMarkup {
  return mermaidMarkup(normalizeDiagram(adoptDiagram(svg, nextDiagramId())));
}
