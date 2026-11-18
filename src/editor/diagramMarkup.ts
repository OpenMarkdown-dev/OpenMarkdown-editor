import { sanitizeMarkup, UnsafeMarkupError, type MarkupAllow, type SafeMarkup } from "./markup";

/**
 * The diagram profile of the editor's one sanitiser (`./markup.ts`; spec:
 * editor-host / 不可信内容渲染不执行脚本). Its own module because only the
 * diagram code uses it: `./mermaidRender.ts` imports it, and that file loads
 * with the first diagram (change: editor-lean-deps, design D6), so the first
 * load does not carry it. Built-in Mermaid and a host's `renderDiagram` both
 * come through here. Like `./markup.ts` it may mint `SafeMarkup` (gate:
 * `untrustedContent.gate.test.ts` U2) and it has no markup sink (U1): the
 * markup it returns reaches the DOM through `setMarkup` only.
 */

// --- Mermaid diagrams (change: editor-mermaid, design D9) -------------------

/**
 * What a mermaid diagram may contain — rendered with `htmlLabels: false`, so
 * labels are SVG text: no `<a>`, no `foreignObject`, no `<use>`, no `<image>`,
 * no `<script>`. Anything else refuses the whole diagram. `<style>` is
 * text-only and nothing nests in it (design D9: no element may sit where the
 * browser would parse it differently from this tokeniser); mermaid's
 * `<title>` / `<desc>` are not needed and not allowed.
 */
const MERMAID_TAGS = [
  "svg", "g", "defs", "style", "symbol", "marker", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "text", "tspan", "linearGradient", "stop", "filter", "feDropShadow",
];
const MERMAID_ATTRS = [
  "xmlns", "id", "class", "style", "role", "aria-roledescription", "viewBox", "width", "height", "transform",
  "transform-origin", "d", "points", "x", "y", "x1", "y1", "x2", "y2", "dx", "dy", "cx", "cy", "r", "rx", "ry",
  "fill", "fill-rule", "clip-rule", "stroke", "stroke-width", "stroke-dasharray", "opacity", "text-anchor",
  "dominant-baseline", "alignment-baseline", "font-size", "font-family", "font-style", "font-weight", "name",
  "refX", "refY", "markerUnits", "markerWidth", "markerHeight", "orient", "marker-start", "marker-end",
  "gradientUnits", "offset", "stop-color", "stop-opacity", "stdDeviation", "flood-color", "flood-opacity",
];
/** Elements whose content must be text only: nothing may start inside them. */
const MERMAID_TEXT_ONLY = new Set(["style"]);

/**
 * The CSS properties a diagram may set (its `<style>` and its `style`
 * attributes) — what mermaid 11's own themes use, minus everything that can
 * lift content out of the diagram's box: no `position`, `z-index`, `inset` /
 * `top` / `left` / `right` / `bottom`, `content`, `margin`, `float`… (design D10).
 * Custom properties (`--…`) are allowed; their values are vetted like any other.
 */
export const DIAGRAM_CSS_PROPERTIES: ReadonlySet<string> = new Set([
  "alignment-baseline", "animation", "animation-delay", "animation-direction", "animation-duration",
  "animation-iteration-count", "animation-name", "animation-timing-function", "background", "background-color",
  "border", "border-color", "border-radius", "border-style", "border-width", "box-shadow", "color", "cursor",
  "display", "dominant-baseline", "fill", "fill-opacity", "filter", "font", "font-family", "font-size",
  "font-style", "font-variant", "font-weight", "height", "letter-spacing", "line-height", "marker-end",
  "marker-start", "max-width", "opacity", "overflow", "padding", "pointer-events", "shape-rendering", "stroke",
  "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "stroke-width",
  "text-align", "text-anchor", "text-decoration", "transform", "transform-origin", "vertical-align",
  "visibility", "white-space", "width",
]);
const VIEWPORT_UNIT = /\d(?:vw|vh|vmin|vmax|vi|vb|[sld]v[hwib]|[sld]vmin|[sld]vmax)\b/i;

/**
 * One declaration of a diagram's CSS, judged: null = fine, else why not.
 * `onRoot`: the rule targets the diagram's root element itself (no `transform`
 * there — it could move the whole diagram). Pure; shared by the vetting below
 * and the normalisation in `./mermaid.ts`.
 */
export function diagramDeclarationProblem(property: string, value: string, onRoot: boolean): string | null {
  const prop = property.trim().toLowerCase();
  if (!prop.startsWith("--") && !DIAGRAM_CSS_PROPERTIES.has(prop)) return `property ${prop}`;
  if (VIEWPORT_UNIT.test(value)) return `viewport unit in ${prop}`;
  // `filter`, and its backdrop / prefixed variants.
  if (prop.endsWith("filter") && /url\s*\(/i.test(value)) return `url() in ${prop}`;
  if (onRoot && (prop === "transform" || prop === "transform-origin")) return `${prop} on the diagram's root`;
  return null;
}

/** The id mermaid gives the diagram's root `<svg>` (`renderWith` in `./mermaid.ts`). */
const MERMAID_ROOT_ID = /^om-mermaid-\d+$/;

/**
 * THE rule for "this name is the diagram's root id, or derived from it": the
 * root id, then the end or a character that is not a letter or digit (`_`,
 * `-`, `.`, `:` …). So `d`, `d_flowchart-v2-pointEnd` (mermaid's markers),
 * `d-g`, `d.x` are the root `d`'s; `d10` is not root `d1`'s. One definition:
 * the sanitiser keeps ids by it (`mermaidMarkup`), and a host's diagram is
 * renamed by it (`adoptDiagram` in `./mermaidRender.ts`). As a regex source,
 * for the place after the root id: the end, or no letter or digit next.
 */
export const AFTER_ROOT_ID = "(?![A-Za-z0-9])";
export function derivedFromRoot(name: string, rootId: string): boolean {
  return name.startsWith(rootId) && new RegExp(`^${AFTER_ROOT_ID}`).test(name.slice(rootId.length));
}
/** Never dropped quietly: a link, an event handler, a resource load. */
const MERMAID_REFUSED_ATTR = /^(on|xlink:|xml:base$|href$|src$|srcset$|action$|formaction$|background$|ping$)/i;
const SCRIPT_SCHEME = /(?:java|vb|live)script\s*:|data\s*:/i;
/** Fetches or runs code in CSS — `url()` is checked separately (local fragments only). */
const CSS_REFUSED = /@import|@font-face|@namespace|expression\s*\(|(?:image|image-set|cross-fade|element|src)\s*\(|-moz-binding|behavior\s*:|javascript\s*:/i;
const URL_REF = /url\(\s*([^)]*?)\s*\)/gi;

function vetDeclarations(body: string, onRoot: boolean, refuse: (why: string) => never): void {
  for (const decl of body.split(";")) {
    if (!decl.trim()) continue;
    const colon = decl.indexOf(":");
    if (colon < 1) refuse(`malformed declaration ${decl.trim().slice(0, 30)}`);
    const problem = diagramDeclarationProblem(decl.slice(0, colon), decl.slice(colon + 1), onRoot);
    if (problem) refuse(problem);
  }
}

/**
 * The CSS of a diagram's own `<style>` (its whole text, as one unit), vetted —
 * THROWS on anything outside: no comments, backslash escapes, `<`, `@import` /
 * `@font-face`, `expression()`, no `url()` but `url(#<this diagram's id>…)`,
 * quoted strings only as plain font names, every top-level rule scoped to
 * `#<rootId>` (or an `@keyframes` whose steps are `from` / `to` / percentages),
 * and every declaration a `DIAGRAM_CSS_PROPERTIES` property without viewport
 * units. `refs` collects the fragment ids it points at, for the caller to check
 * they exist in the same SVG. Pure.
 */
export function vetDiagramCss(css: string, rootId: string, refs: Set<string>): void {
  const refuse = (why: string): never => {
    throw new UnsafeMarkupError(`diagram style: ${why}`);
  };
  if (/[\\<]|\/\*/.test(css)) refuse("escape, comment or markup in CSS");
  if (CSS_REFUSED.test(css)) refuse("fetching or scripting construct");
  for (const m of css.matchAll(URL_REF)) {
    const target = m[1].replace(/^["']|["']$/g, "");
    if (!target.startsWith("#" + rootId) || !/^#[\w-]+$/.test(target)) refuse(`url(${m[1]}) is not a local reference`);
    refs.add(target.slice(1));
  }
  // Strings: plain font names only, so no brace, quote or semicolon can hide inside one.
  const bare = css.replace(/"[\w ,.-]*"|'[\w ,.-]*'/g, "x");
  if (/["']/.test(bare)) refuse("quoted string");
  const scope = "#" + rootId;
  const scoped = (sel: string) => sel.startsWith(scope) && !/^[\w-]/.test(sel.slice(scope.length));
  /** The selector picks the root element itself (`#id`, `#id:hover`), not something inside it. */
  const rootOnly = (sel: string) => /^[^\s>+~]*$/.test(sel.slice(scope.length));
  let i = 0;
  while (i < bare.length) {
    const open = bare.indexOf("{", i);
    if (open < 0) {
      if (bare.slice(i).trim()) refuse("trailing text");
      break;
    }
    const prelude = bare.slice(i, open).trim();
    if (prelude.includes("}")) refuse("unbalanced braces");
    if (prelude.startsWith("@")) {
      if (!/^@keyframes\s+[\w-]+$/.test(prelude)) refuse(`at-rule ${prelude.split(/\s/)[0]}`);
      // Steps: `from{…}` / `to{…}` / `50%{…}`, then the closing brace.
      let j = open + 1;
      for (;;) {
        const step = /^\s*(?:(?:from|to|\d+(?:\.\d+)?%)\s*,?\s*)+\{([^{}]*)\}/.exec(bare.slice(j));
        if (!step) break;
        vetDeclarations(step[1], false, refuse);
        j += step[0].length;
      }
      const close = /^\s*\}/.exec(bare.slice(j));
      if (!close) refuse("malformed @keyframes");
      i = j + close![0].length;
      continue;
    }
    const selectors = prelude.split(",").map((sel) => sel.trim());
    if (!prelude || !selectors.every(scoped)) refuse(`selector not scoped to ${scope}: ${prelude.slice(0, 40)}`);
    const close = bare.indexOf("}", open);
    if (close < 0 || bare.slice(open + 1, close).includes("{")) refuse("unbalanced braces");
    vetDeclarations(bare.slice(open + 1, close), selectors.some(rootOnly), refuse);
    i = close + 1;
  }
}

/**
 * A mermaid diagram's SVG, made safe to parse — or THROWS (→ the source with
 * the failure mark; never a half-sanitised diagram). On top of the tag / attr
 * allow-list:
 *   - the root is an `<svg>` whose id is `om-mermaid-<n>`;
 *   - a link, handler or load attribute (`href`, `xlink:*`, `on*`, `src`, …), or a
 *     script / data scheme in any value, refuses the diagram;
 *   - `url()` only as `url(#<id>)` with an id this SVG defines, under the root
 *     id's prefix (markers, gradients, filters);
 *   - other ids are kept only under the root id's prefix (`om-mermaid-<n>-…`),
 *     so none can collide with or target the page; unprefixed ones are dropped;
 *   - `<style>` holds text only (no element may start inside it); its whole
 *     text passes `vetDiagramCss`; every `style` attribute's declarations pass
 *     the same property check.
 */
export function mermaidMarkup(svg: string): SafeMarkup {
  let rootId: string | null = null;
  const ids = new Set<string>();
  const refs = new Set<string>();
  /** The text of the `<style>` element now open; null when none is. */
  let styleText: string | null = null;
  const refuse = (why: string): never => {
    throw new UnsafeMarkupError(`diagram: ${why}`);
  };
  /**
   * `om-mermaid-3` itself, or `om-mermaid-3-…` / `om-mermaid-3_…` — never
   * `om-mermaid-30` (`derivedFromRoot`); and only `[\w-]` names, so a kept id
   * is one CSS and `url(#…)` can name.
   */
  const underRoot = (id: string) => rootId !== null && derivedFromRoot(id, rootId) && /^[\w-]+$/.test(id);
  const profile: MarkupAllow = {
    tags: new Set(MERMAID_TAGS),
    attrs: new Set(MERMAID_ATTRS),
    vetStart(tag, open) {
      const inside = open.find((t) => MERMAID_TEXT_ONLY.has(t));
      if (inside) refuse(`<${tag}> inside <${inside}>`);
      if (open.length === 0 && (tag !== "svg" || rootId !== null)) refuse("not one svg element at the root");
      if (tag === "style") styleText = "";
    },
    vetAttr(tag, name, value) {
      if (MERMAID_REFUSED_ATTR.test(name)) refuse(`attribute ${name} on <${tag}>`);
      if (SCRIPT_SCHEME.test(value)) refuse(`script or data scheme in ${name}`);
      if (rootId === null) {
        if (tag !== "svg") refuse("the root is not an svg element");
        if (name === "id") {
          if (!MERMAID_ROOT_ID.test(value)) refuse(`root id ${value}`);
          rootId = value;
          ids.add(value);
          return true;
        }
      }
      for (const m of value.matchAll(URL_REF)) {
        const target = m[1].replace(/^["']|["']$/g, "");
        if (!/^#[\w-]+$/.test(target) || !underRoot(target.slice(1))) refuse(`url(${m[1]}) is not a local reference`);
        refs.add(target.slice(1));
      }
      if (name === "style") vetDeclarations(value, false, refuse);
      if (name === "id") {
        if (!underRoot(value)) return false;
        ids.add(value);
      }
      return true;
    },
    vetText(parent, text) {
      if (parent === "style") styleText = (styleText ?? "") + text;
    },
    vetEnd(tag) {
      if (tag !== "style") return;
      if (rootId === null) refuse("<style> before the root id");
      vetDiagramCss(styleText ?? "", rootId!, refs);
      styleText = null;
    },
  };
  const out = sanitizeMarkup(svg, profile);
  if (rootId === null) refuse("no root svg id");
  for (const ref of refs) if (!ids.has(ref)) refuse("url(#" + ref + ") points outside the diagram");
  return out as SafeMarkup;
}
