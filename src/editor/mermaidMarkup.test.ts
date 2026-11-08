import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attemptRenderAsync } from "./blocks/render";
import { mermaidMarkup, UnsafeMarkupError, vetDiagramCss } from "./markup";
import { mermaidConfig, normalizeDiagram, renderWith, type MermaidModule } from "./mermaid";

/**
 * The mermaid profile of the editor's one HTML sink (change: editor-mermaid,
 * design D9; spec: editor-host / 不可信内容渲染不执行脚本). Hostile samples:
 * what a diagram must never carry into the page, and what it is allowed to.
 */

const ROOT = "om-mermaid-1";
const svg = (inner: string, style = "") =>
  `<svg id="${ROOT}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${style ? `<style>${style}</style>` : ""}${inner}</svg>`;
const refused = (markup: string) => () => mermaidMarkup(markup);

describe("mermaidMarkup — refuses the whole diagram", () => {
  it.each([
    ["an <a> link", svg('<a href="javascript:alert(1)"><text>x</text></a>')],
    ["an <a> with xlink:href", svg('<a xlink:href="https://evil.example"><text>x</text></a>')],
    ["xlink:href on an allowed element", svg('<text xlink:href="javascript:alert(1)">x</text>')],
    ["href on an allowed element", svg('<rect href="https://evil.example"/>')],
    ["<use> pulling another resource", svg('<use href="https://evil.example/x.svg#a"/>')],
    ["foreignObject (an HTML island)", svg("<foreignObject><div>x</div></foreignObject>")],
    ["<script>", svg("<script>alert(1)</script>")],
    ["<image>", svg('<image src="https://evil.example/x.png"/>')],
    ["an event handler", svg('<rect onclick="alert(1)"/>')],
    ["an event handler, any case", svg('<g ONMOUSEOVER="alert(1)"/>')],
    ["a javascript: value", svg('<rect class="javascript:alert(1)"/>')],
    ["an entity-obfuscated javascript: value", svg('<rect fill="&#106;avascript:alert(1)"/>')],
    ["a data: value", svg('<rect fill="data:image/svg+xml,x"/>')],
    ["url() to a remote resource in an attribute", svg('<path marker-end="url(https://evil.example/m.svg#a)"/>')],
    ["url() to a remote resource in a style attribute", svg('<rect style="fill:url(https://evil.example/x)"/>')],
    ["url() to an id the diagram does not define", svg('<path marker-end="url(#om-mermaid-1-missing)"/>')],
    ["url() to a page element", svg('<path marker-end="url(#app-root)"/>')],
    ["a root that is not our diagram", '<svg id="app"><rect/></svg>'],
    ["no root id", "<svg><rect/></svg>"],
    ["a comment", svg("<!-- x --><rect/>")],
  ])("%s", (_what, markup) => {
    expect(refused(markup)).toThrow(UnsafeMarkupError);
  });
});

describe("the diagram's <style> — refused unless plain, scoped CSS", () => {
  const css = (text: string) => () => vetDiagramCss(text, ROOT, new Set());
  it.each([
    ["@import", "@import url(https://evil.example/x.css);"],
    ["@import without url()", '@import "https://evil.example/x.css";'],
    ["a remote url() in a scoped rule", `#${ROOT} .node{background:url(https://evil.example/x.png)}`],
    ["a remote url() quoted", `#${ROOT} .node{fill:url("https://evil.example/x")}`],
    ["@font-face", `@font-face{font-family:x;src:url(https://evil.example/f.woff)}`],
    ["expression()", `#${ROOT} .a{width:expression(alert(1))}`],
    ["a backslash escape (obfuscated @import)", "\\40 import url(x);"],
    ["a comment", `#${ROOT} .a{fill:red}/* x */`],
    ["an unscoped rule (styles the page)", ".cm-content{display:none}"],
    ["a rule scoped to another diagram", `#${ROOT}0 .a{fill:red}`],
    ["one unscoped selector in a list", `#${ROOT} .a, body{fill:red}`],
    ["an unknown at-rule", `@media screen{#${ROOT} .a{fill:red}}`],
    ["a brace hidden in a string", `#${ROOT} .a{content:"}"} body{display:none}`],
    ["a </style> breakout attempt", `#${ROOT} .a{fill:red}<script>`],
    ["javascript: in a value", `#${ROOT} .a{behavior:javascript:alert(1)}`],
  ])("%s", (_what, text) => {
    expect(css(text)).toThrow(UnsafeMarkupError);
  });

  it("an entity-encoded @import is decoded before it is vetted", () => {
    expect(refused(svg("<rect/>", `&#64;import url(https://evil.example/x.css);#${ROOT}{fill:red}`))).toThrow(
      UnsafeMarkupError,
    );
  });

  it("a </style> inside the CSS ends the element, and what follows is markup — refused", () => {
    expect(refused(svg("", `#${ROOT}{fill:red}</style><script>alert(1)</script><style>`))).toThrow(UnsafeMarkupError);
  });

  it("allows scoped rules, child combinators, font names, local url(#id) and @keyframes", () => {
    const ok = `#${ROOT}{font-family:"Segoe UI",sans-serif;fill:#333;}@keyframes dash{to{stroke-dashoffset:0;}}#${ROOT} text.actor&gt;tspan{fill:url(#${ROOT}-g)}`;
    const out = mermaidMarkup(svg(`<defs><linearGradient id="${ROOT}-g"><stop offset="0%"/></linearGradient></defs>`, ok));
    expect(out).toContain("@keyframes dash");
    expect(out).toContain(`url(#${ROOT}-g)`);
  });
});

describe("no parser differential: the element tree checked is the one the browser builds (design D9)", () => {
  it.each([
    ["an <img> inside <style>", svg("", `#${ROOT}{fill:red}<img src=x onerror=alert(1)>`)],
    ["an allowed element inside <style>", `<svg id="${ROOT}"><style>#${ROOT}{fill:red}<rect/></style></svg>`],
    ["</style> then an <a>", `<svg id="${ROOT}"><style>#${ROOT}{fill:red}</style><a href="javascript:alert(1)"><text>x</text></a></svg>`],
    ["an element inside <title>", `<svg id="${ROOT}"><title><g/></title></svg>`],
    ["<title> at all (not needed, not allowed)", `<svg id="${ROOT}"><title>x</title></svg>`],
    ["<desc>", `<svg id="${ROOT}"><desc>x</desc></svg>`],
    ["a rule split across two <style> elements", `<svg id="${ROOT}"><style>#${ROOT} .a{</style><style>position:fixed}</style></svg>`],
    ["a style split around an element", `<svg id="${ROOT}"><style>#${ROOT}{fill:red}</style><g/><style>body{display:none}</style></svg>`],
    ["an end tag that closes the wrong element", `<svg id="${ROOT}"><g><text>x</g></text></svg>`],
    ["an element left open", `<svg id="${ROOT}"><g>`],
    ["a second root after the diagram", `<svg id="${ROOT}"></svg><svg id="om-mermaid-2"></svg>`],
  ])("%s → refused", (_what, markup) => {
    expect(refused(markup)).toThrow(UnsafeMarkupError);
  });

  it("each <style> element's whole text is vetted as one unit", () => {
    // Entity-split, it still reads as one `position:fixed` once decoded.
    expect(refused(svg("<rect/>", `#${ROOT} .a{posi&#116;ion:fixed}`))).toThrow(/property position/);
  });
});

describe("no CSS overlay / UI redressing (design D10)", () => {
  const css = (text: string) => () => vetDiagramCss(text, ROOT, new Set());
  it.each([
    ["position: fixed", `#${ROOT} .a{position:fixed}`],
    ["z-index", `#${ROOT} .a{z-index:9999}`],
    ["inset / top / left", `#${ROOT} .a{top:0;left:0}`],
    ["inset", `#${ROOT} .a{inset:0}`],
    ["content", `#${ROOT} .a{content:x}`],
    ["margin", `#${ROOT}{margin:-500px}`],
    ["a viewport-sized box", `#${ROOT} .a{width:100vw;height:100vh}`],
    ["dynamic viewport units", `#${ROOT} .a{height:100dvh}`],
    ["filter with url()", `#${ROOT} .a{filter:url(#${ROOT}-f)}`],
    ["transform on the diagram's root", `#${ROOT}{transform:translate(-500px,-500px)}`],
    ["an unknown property", `#${ROOT} .a{-webkit-user-modify:read-write}`],
  ])("%s → refused", (_what, text) => {
    expect(css(text)).toThrow(UnsafeMarkupError);
  });

  it("allows what mermaid's own themes use: transform inside, filters without url(), custom properties", () => {
    expect(css(`#${ROOT} .milestone{transform:rotate(45deg) scale(0.8,0.8)}#${ROOT} .a{filter:none;--mermaid-font-family:x}`)).not.toThrow();
  });

  it("a style attribute is held to the same properties", () => {
    expect(refused(svg('<rect style="position:fixed;z-index:9999"/>'))).toThrow(/property position/);
    expect(refused(svg('<rect style="width:100vw"/>'))).toThrow(/viewport unit/);
  });

  it("a classDef / style statement asking for position:fixed is neutralised by normalisation, the diagram still draws", () => {
    const fromMermaid = svg(
      '<rect class="hot" style="position:fixed !important;z-index:9999 !important;fill:#f00 !important"/>',
      `#${ROOT} .hot&gt;*{position:fixed!important;z-index:9999!important;fill:#f00!important;}#${ROOT}{font-size:16px;}`,
    );
    const out = mermaidMarkup(normalizeDiagram(fromMermaid));
    expect(out).not.toMatch(/position|z-index/);
    expect(out).toContain("fill:#f00");
  });

  it("an init directive's themeCSS that escapes the diagram is neutralised the same way", () => {
    // themeCSS is a secure key (see the config test below), so mermaid drops it;
    // were it ever written, its rules would still be unscoped or filtered here.
    expect(refused(svg("<rect/>", `#${ROOT}{fill:red}.cm-editor{position:fixed;inset:0;z-index:9999}`))).toThrow(UnsafeMarkupError);
    const scoped = svg("<rect/>", `#${ROOT}{position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;fill:red}`);
    expect(mermaidMarkup(normalizeDiagram(scoped))).not.toMatch(/position|z-index|vw|vh|top|left/);
  });

  it("directives cannot unlock what the editor's config fixes", () => {
    const secure = mermaidConfig("light").secure as string[];
    for (const key of ["secure", "securityLevel", "startOnLoad", "maxTextSize", "htmlLabels", "themeCSS", "fontFamily", "altFontFamily"]) {
      expect(secure).toContain(key);
    }
  });
});

describe("what a diagram keeps", () => {
  it("markers referenced by local url(#id) under the diagram's prefix", () => {
    const out = mermaidMarkup(
      svg(`<defs><marker id="${ROOT}_pointEnd" refX="5" orient="auto"><path d="M 0 0 L 10 5 z"/></marker></defs><path d="M0 0" marker-end="url(#${ROOT}_pointEnd)"/>`),
    );
    expect(out).toContain(`marker-end="url(#${ROOT}_pointEnd)"`);
    expect(out).toContain(`id="${ROOT}_pointEnd"`);
  });

  it("drops ids outside the diagram's prefix (they could collide with or target the page), keeps the diagram", () => {
    const out = mermaidMarkup(svg('<g id="root-0"><rect id="app"/></g>'));
    expect(out).not.toMatch(/id="(root-0|app)"/);
    expect(out).toContain("<rect/>");
  });

  it("drops mermaid's data-* bookkeeping", () => {
    expect(mermaidMarkup(svg('<path data-points="W3siIn0=" d="M0 0"/>'))).not.toContain("data-points");
  });

  it("a real mermaid 11 dark sequence diagram passes once normalised (its tooltip CSS and dangling gradient refs dropped)", () => {
    const real = readFileSync(join(__dirname, "testdata/mermaid-sequence-dark.svg"), "utf8");
    // Raw, its theme CSS carries `position: absolute` / `z-index` / `margin`
    // and `url(#…-gradient)` to an id it never defines: refused as is.
    expect(() => mermaidMarkup(real)).toThrow(UnsafeMarkupError);
    const out = mermaidMarkup(normalizeDiagram(real));
    expect(out).toContain('aria-roledescription="sequence"');
    expect(out).not.toMatch(/\shref=|xlink:|\son\w+=|<a[\s>]|foreignObject|position\s*:|z-index/);
  });
});

describe("a hostile diagram falls back to source through attemptRenderAsync", () => {
  // What mermaid hands back is vetted in `renderWith`; a refusal is a failure.
  const returning = (out: string): MermaidModule => ({
    initialize: () => {},
    mermaidAPI: { getSiteConfig: () => ({}), render: async () => ({ svg: out }) },
  });
  it.each([
    ["a click directive turned into a javascript: link", svg('<a href="javascript:alert(1)"><text>A</text></a>')],
    ["a label carrying an <a>", svg('<text><a xlink:href="javascript:alert(1)">A</a></text>')],
    ["CSS fetching a remote resource", svg("<rect/>", `#${ROOT} .a{fill:url(https://evil.example/x)}`)],
    ["CSS @import", svg("<rect/>", `@import url(https://evil.example/x.css);`)],
  ])("%s → failed, never a half-sanitised diagram", async (_what, out) => {
    const r = await attemptRenderAsync(() => renderWith(returning(out), "graph TD", "light"));
    expect(r.kind).toBe("failed");
  });
});
