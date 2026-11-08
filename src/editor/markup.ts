/**
 * The editor's ONE HTML sink (spec: editor-host / 不可信内容渲染不执行脚本;
 * change: editor-untrusted-content, design D1).
 *
 * The editor renders documents other people wrote (an embedder feeds it shared
 * Markdown), so markup parsed by the browser is a script-injection surface. Two
 * producers legitimately hand the editor markup: the formula converter (Temml's
 * MathML, built from document TeX) and the editor's own glyph table (SVG). Both
 * pass through `sanitizeMarkup` here — an allow-list re-serialiser — and come
 * out as `SafeMarkup`, the only type `setMarkup` accepts. `setMarkup` is the only
 * place under `src/editor` that assigns markup to the DOM; the gate
 * `untrustedContent.gate.test.ts` fails on any other `innerHTML` / `outerHTML`
 * / `insertAdjacentHTML` / … and on a `SafeMarkup` cast outside this file.
 *
 * The sanitiser is pure (string in, string out) so it is node-testable:
 *   - a tag outside the allow-list (an `<a>`, a `<script>`, `annotation-xml`…),
 *     a comment / doctype / CDATA, or markup it cannot tokenise → THROWS. The
 *     math renderer's caller (`attemptRender`) turns that into the source with
 *     the failure mark — never a half-rendered formula;
 *   - an attribute outside the allow-list (`on*`, `href`, `xlink:href`, `src`,
 *     `id`…) or a `style` / `class` value outside its character set → DROPPED;
 *   - text is re-escaped, attribute values are decoded then re-quoted, so what
 *     the browser parses is exactly the token stream checked here.
 *
 * Strict CSP (change: editor-integration-fixes, design D7; spec: editor-host /
 * 内核样式只经注入样式表,不写内联 style 属性): what reaches the DOM through `setMarkup` raises no `style-src`
 * violation. A kept `style` attribute is not written as one — the sanitiser
 * moves its (vetted) value to `data-ome-style`, and `setMarkup` re-applies it
 * through the CSSOM (`el.style.setProperty`, which CSP allows) after insertion.
 * A kept `<style>` element (the diagram profile's) gets the editor's CSP nonce
 * (`EditorView.cspNonce`) before it is connected. Same allow-lists either way:
 * only the path by which a vetted value is applied differs.
 */

import { EditorView } from "@codemirror/view";

declare const SAFE: unique symbol;
/** Markup that went through `sanitizeMarkup` — the only thing `setMarkup` takes. */
export type SafeMarkup = string & { readonly [SAFE]: true };

export interface MarkupAllow {
  /** Allowed element names (lower case as written by the producer). */
  tags: ReadonlySet<string>;
  /** Allowed attribute names, on any allowed element. */
  attrs: ReadonlySet<string>;
  /**
   * Optional stricter vetting (the mermaid profile): sees EVERY attribute, value
   * decoded, before the allow-list. Return false to drop it; THROW to refuse the
   * whole markup — for what must never be silently dropped (a link, a handler).
   */
  vetAttr?: (tag: string, name: string, value: string) => boolean;
  /** Optional: sees every start tag with the elements already open around it (outermost first); THROW to refuse. */
  vetStart?: (tag: string, open: readonly string[]) => void;
  /** Optional: sees every text run, decoded, with the element it sits directly in; THROW to refuse. */
  vetText?: (parent: string | null, text: string) => void;
  /** Optional: sees every end tag (and the close of a self-closed element); THROW to refuse. */
  vetEnd?: (tag: string) => void;
}

export class UnsafeMarkupError extends Error {}

const MATH_TAGS = [
  "math", "semantics", "annotation", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace", "msup", "msub",
  "msubsup", "mfrac", "msqrt", "mroot", "mstyle", "mpadded", "mphantom", "menclose", "munder", "mover",
  "munderover", "mtable", "mtr", "mtd", "mlabeledtr", "mmultiscripts", "mprescripts", "none", "merror",
  // Temml wraps an equation number in a plain span inside <mtext>.
  "span",
];
const MATH_ATTRS = [
  "xmlns", "display", "displaystyle", "scriptlevel", "mathvariant", "mathsize", "mathcolor", "mathbackground",
  "lspace", "rspace", "stretchy", "symmetric", "largeop", "movablelimits", "accent", "accentunder", "form",
  "fence", "separator", "minsize", "maxsize", "width", "height", "depth", "voffset", "linethickness", "notation",
  "columnalign", "rowalign", "columnspacing", "rowspacing", "columnlines", "rowlines", "frame", "framespacing",
  "equalrows", "equalcolumns", "side", "columnspan", "rowspan", "align", "bevelled", "numalign", "denomalign",
  "encoding", "dir", "scriptminsize", "scriptsizemultiplier", "class", "style",
];

/** What a formula may contain: presentation MathML, no links, no ids, no foreign islands. */
export const MATHML_ALLOW: MarkupAllow = { tags: new Set(MATH_TAGS), attrs: new Set(MATH_ATTRS) };

/** What an editor glyph may contain: plain SVG shapes. */
export const GLYPH_SVG_ALLOW: MarkupAllow = {
  tags: new Set(["svg", "g", "path", "circle", "ellipse", "line", "rect", "polyline", "polygon"]),
  attrs: new Set([
    "xmlns", "width", "height", "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap",
    "stroke-linejoin", "aria-hidden", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
    "points", "class",
  ]),
};

/** class: space-separated plain tokens only. */
const CLASS_VALUE = /^[\w -]*$/;
/** style: a plain declaration list — no quotes, backslashes, `@`, `/`, `<`; no `url(` / `image(` / `expression(`. */
const STYLE_VALUE = /^[\w\s:;.,#%()+*-]*$/;
const STYLE_FETCH = /\b(url|image|image-set|cross-fade|element|expression|src)\s*\(/i;

const NAMESPACES = new Set(["http://www.w3.org/2000/svg", "http://www.w3.org/1998/Math/MathML"]);

const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/g;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decode the character references a serialiser writes (numeric + the XML five + nbsp). */
export function decodeEntities(s: string): string {
  return s.replace(ENTITY, (m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED[name];
    const cp = dec !== undefined ? Number(dec) : parseInt(hex as string, 16);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
  });
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

function attrValueOk(name: string, value: string): boolean {
  if (name === "class") return CLASS_VALUE.test(value);
  if (name === "style") return STYLE_VALUE.test(value) && !STYLE_FETCH.test(value);
  if (name === "xmlns") return NAMESPACES.has(value);
  // Every other allowed attribute is a plain value (a length, a keyword, a path
  // `d`); none of them is a URL, so a scheme-looking or markup-looking value is refused.
  return !/[<>"'`\\]/.test(value) && !/^\s*[a-z][a-z0-9+.-]*\s*:/i.test(value);
}

/**
 * Where a kept `style` attribute's value travels in `SafeMarkup` (never `style`
 * itself: a parsed style attribute is what a strict CSP blocks). No profile
 * allows this name, so a producer cannot supply it — only the sanitiser writes it.
 */
const STYLE_CARRIER = "data-ome-style";

/**
 * `SafeMarkup` as plain HTML for a page that lives OUTSIDE the editor (an
 * exported document, no CSP): each carried style goes back to a `style`
 * attribute, which is what `setMarkup` would have applied. Pure. Text and
 * attribute values are escaped (`<`, `>`, `"`), so every `<…>` is a tag and the
 * carrier can only be an attribute name there.
 */
export function standaloneMarkup(markup: SafeMarkup): string {
  return markup.replace(/<[^<>]*>/g, (tag) => tag.split(` ${STYLE_CARRIER}="`).join(' style="'));
}

const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const ATTR = /\s+([a-zA-Z][a-zA-Z0-9:_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/y;

/**
 * Re-serialise `markup` keeping only `allow`ed elements and attributes. Pure.
 * A kept `style` attribute comes out as `data-ome-style` (see the header).
 * Throws `UnsafeMarkupError` on a disallowed element, a comment / declaration /
 * processing instruction, an unquoted attribute, an end tag that does not
 * close the innermost open element, an element left open, or anything it
 * cannot tokenise — the element tree it checked is exactly the one it writes.
 */
export function sanitizeMarkup(markup: string, allow: MarkupAllow): string {
  let out = "";
  let i = 0;
  /** The open elements, outermost first: what the next text run or tag sits in. */
  const stack: string[] = [];
  while (i < markup.length) {
    const lt = markup.indexOf("<", i);
    const textEnd = lt === -1 ? markup.length : lt;
    if (textEnd > i) {
      const text = decodeEntities(markup.slice(i, textEnd));
      allow.vetText?.(stack.length ? stack[stack.length - 1] : null, text);
      out += escapeText(text);
    }
    if (lt === -1) break;
    const close = markup[lt + 1] === "/";
    let p = lt + (close ? 2 : 1);
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(markup.slice(p, p + 64));
    if (!nameMatch || !TAG_NAME.test(nameMatch[0])) throw new UnsafeMarkupError(`unparsable markup at ${lt}`);
    const name = nameMatch[0];
    if (!allow.tags.has(name)) throw new UnsafeMarkupError(`element <${name}> is not allowed`);
    p += name.length;
    if (close) {
      const gt = /^\s*>/.exec(markup.slice(p));
      if (!gt) throw new UnsafeMarkupError(`unparsable end tag </${name}`);
      if (stack[stack.length - 1] !== name) throw new UnsafeMarkupError(`end tag </${name}> does not close the open element`);
      stack.pop();
      allow.vetEnd?.(name);
      out += `</${name}>`;
      i = p + gt[0].length;
      continue;
    }
    allow.vetStart?.(name, stack);
    let attrs = "";
    for (;;) {
      ATTR.lastIndex = p;
      const a = ATTR.exec(markup);
      if (!a) break;
      p = ATTR.lastIndex;
      const attr = a[1];
      const raw = a[2] ?? a[3];
      const value = raw === undefined ? "" : decodeEntities(raw);
      if (allow.vetAttr && !allow.vetAttr(name, attr, value)) continue;
      if (allow.attrs.has(attr) && attrValueOk(attr, value)) {
        attrs += ` ${attr === "style" ? STYLE_CARRIER : attr}="${escapeAttr(value)}"`;
      }
    }
    const end = /^\s*(\/?)>/.exec(markup.slice(p));
    if (!end) throw new UnsafeMarkupError(`unparsable start tag <${name}`);
    out += `<${name}${attrs}${end[1] ? "/" : ""}>`;
    if (end[1]) allow.vetEnd?.(name);
    else stack.push(name);
    i = p + end[0].length;
  }
  if (stack.length) throw new UnsafeMarkupError(`element <${stack[stack.length - 1]}> is not closed`);
  return out;
}

/** A formula's MathML, made safe to parse. Throws (→ the failure mark) on anything outside MathML. */
export function mathMarkup(mathml: string): SafeMarkup {
  return sanitizeMarkup(mathml, MATHML_ALLOW) as SafeMarkup;
}

const glyphCache = new Map<string, SafeMarkup>();

/** An editor glyph's SVG, made safe to parse (memoised: the glyph table is small and fixed). */
export function glyphMarkup(svg: string): SafeMarkup {
  let safe = glyphCache.get(svg);
  if (safe === undefined) {
    safe = sanitizeMarkup(svg, GLYPH_SVG_ALLOW) as SafeMarkup;
    glyphCache.set(svg, safe);
  }
  return safe;
}

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
  /** `om-mermaid-3` itself, or `om-mermaid-3-…` / `om-mermaid-3_…` — never `om-mermaid-30`. */
  const underRoot = (id: string) =>
    rootId !== null && id.startsWith(rootId) && (id.length === rootId.length || /^[-_]/.test(id.slice(rootId.length)));
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

/**
 * Put sanitised markup into `el` — the editor's only markup assignment (gate:
 * `untrustedContent.gate.test.ts`). Parsed in an inert `<template>` (no CSP
 * applies there, nothing loads or runs), then:
 *   - every `<style>` the markup carries (a diagram's) gets the nonce from
 *     `view`'s `EditorView.cspNonce` before it is connected; no view or no
 *     nonce → it is left as is (a page without a style nonce has no CSP to meet);
 *   - the nodes move into `el`, and each `data-ome-style` declaration list is
 *     applied with `el.style.setProperty` and the carrier removed.
 */
export function setMarkup(el: Element, markup: SafeMarkup, view?: EditorView): void {
  const doc = el.ownerDocument;
  const template = doc.createElement("template");
  template.innerHTML = markup;
  const nonce = view?.state.facet(EditorView.cspNonce) ?? "";
  if (nonce) for (const style of template.content.querySelectorAll("style")) style.setAttribute("nonce", nonce);
  el.replaceChildren(template.content);
  for (const node of el.querySelectorAll(`[${STYLE_CARRIER}]`)) {
    const target = node as Element & ElementCSSInlineStyle;
    for (const [property, value] of styleDeclarations(node.getAttribute(STYLE_CARRIER) ?? "")) {
      target.style.setProperty(property, value);
    }
    node.removeAttribute(STYLE_CARRIER);
  }
}

/**
 * A vetted declaration list (`attrValueOk`'s `style` charset: no quotes, no
 * escapes, no `!`) as `[property, value]` pairs, for `style.setProperty`. Pure.
 */
export function styleDeclarations(list: string): [string, string][] {
  const out: [string, string][] = [];
  for (const decl of list.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 1) continue;
    const property = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (property && value) out.push([property.startsWith("--") ? property : property.toLowerCase(), value]);
  }
  return out;
}
