import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GLYPH_SVG_ALLOW, MATHML_ALLOW, UnsafeMarkupError, mermaidMarkup, sanitizeMarkup, styleDeclarations } from "./markup";
import { ensureMath, renderMath } from "./math";
import { EDITOR_GLYPHS, glyphSvg, type EditorGlyph } from "./controls";
import { resolveLinkTarget } from "./linkResolve";
import { editorImageSrc, isScriptUrl, normalizeUrl } from "./safeUrl";
import { resolveImageSrc } from "./imageResolve";
import { parseInlineSegments } from "./inlineCell";
import { dialectMarkdownParser } from "./dialectParser";
import { attemptRender } from "./blocks/render";

/**
 * Hostile samples against every sink the audit lists (spec: editor-host /
 * 不可信内容渲染不执行脚本; change: editor-untrusted-content). The browser half
 * (nothing executes when `fixtures/rendering/untrusted.md` is opened) is the
 * manual test; here, each chokepoint's decision is checked in node.
 */

/** Markup that could run script or fetch when parsed. */
const LIVE = /<(script|a|img|iframe|object|embed|svg|style|foreignObject|annotation-xml)\b|\son\w+=|href=|src=|javascript:/i;

describe("sanitizeMarkup — the one HTML sink", () => {
  const clean = (m: string) => sanitizeMarkup(m, MATHML_ALLOW);

  it("refuses elements outside the allow-list (→ the failure mark, never half-rendered)", () => {
    for (const m of [
      "<math><script>alert(1)</script></math>",
      "<math><a href=\"javascript:alert(1)\">x</a></math>",
      "<math><img src=x onerror=alert(1)></math>",
      "<math><annotation-xml encoding=\"text/html\"><img src=x></annotation-xml></math>",
      "<math><svg><script>alert(1)</script></svg></math>",
      "<math><!-- <img src=x onerror=alert(1)> --></math>",
      "<math><![CDATA[<img src=x onerror=alert(1)>]]></math>",
      "<math><mi x=unquoted onclick=alert(1)>a</mi></math>",
    ]) {
      expect(() => clean(m), m).toThrow(UnsafeMarkupError);
    }
  });

  it("drops attributes outside the allow-list or with live values", () => {
    expect(clean('<math><mi onclick="alert(1)" mathvariant="normal">x</mi></math>')).toBe(
      '<math><mi mathvariant="normal">x</mi></math>',
    );
    expect(clean('<math><mtr id="clobber"></mtr></math>')).toBe("<math><mtr></mtr></math>");
    expect(clean('<math><mi style="background:url(https://evil.example/t.png)">x</mi></math>')).toBe("<math><mi>x</mi></math>");
    expect(clean('<math><mi class="a&quot; onclick=&quot;x">x</mi></math>')).toBe("<math><mi>x</mi></math>");
    expect(clean('<math><mi xlink:href="javascript:alert(1)">x</mi></math>')).toBe("<math><mi>x</mi></math>");
    expect(clean('<math><mi mathcolor="javascript:alert(1)">x</mi></math>')).toBe("<math><mi>x</mi></math>");
  });

  it("re-escapes text, so decoded entities never become tags", () => {
    expect(clean("<math><mtext>&lt;img src=x onerror=alert(1)&gt;</mtext></math>")).toBe(
      "<math><mtext>&lt;img src=x onerror=alert(1)&gt;</mtext></math>",
    );
    expect(clean("<math><mtext>&#60;script&#62;</mtext></math>")).toBe("<math><mtext>&lt;script&gt;</mtext></math>");
  });

  it("keeps every editor glyph intact (the glyph table passes the sink unchanged)", () => {
    for (const role of Object.keys(EDITOR_GLYPHS) as EditorGlyph[]) {
      const svg = glyphSvg(role, 16);
      expect(svg).toContain(EDITOR_GLYPHS[role]);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('aria-hidden="true"');
      expect(sanitizeMarkup(svg, GLYPH_SVG_ALLOW)).toBe(svg);
    }
    // A content mark's size is a class (never a style attribute — strict CSP), and survives the sink.
    const mark = glyphSvg("link", "inline");
    expect(mark).toContain('class="ome-glyph ome-icon-inline"');
    expect(sanitizeMarkup(mark, GLYPH_SVG_ALLOW)).toBe(mark);
  });
});

describe("strict CSP — the sink writes no style attribute (change: editor-integration-fixes)", () => {
  const clean = (m: string) => sanitizeMarkup(m, MATHML_ALLOW);

  it("a kept style value travels as data-ome-style (applied through the CSSOM by setMarkup), unchanged", () => {
    expect(clean('<math style="display:block math"><mi style="color:red;padding:1px">x</mi></math>')).toBe(
      '<math data-ome-style="display:block math"><mi data-ome-style="color:red;padding:1px">x</mi></math>',
    );
  });

  it("the same allow-list decides: a style value outside it is still dropped, not carried", () => {
    expect(clean('<math><mi style="background:url(https://evil.example/t.png)">x</mi></math>')).toBe("<math><mi>x</mi></math>");
    expect(clean('<math><mi style="color:red !important">x</mi></math>')).toBe("<math><mi>x</mi></math>");
  });

  it("a producer cannot supply the carrier itself", () => {
    expect(clean('<math><mi data-ome-style="position:fixed">x</mi></math>')).toBe("<math><mi>x</mi></math>");
    const root = "om-mermaid-1";
    const out = mermaidMarkup(`<svg id="${root}"><rect data-ome-style="position:fixed"/></svg>`);
    expect(out).not.toContain("data-ome-style");
  });

  it("a diagram's style attribute is vetted, then carried; its <style> element stays (setMarkup gives it the nonce)", () => {
    const root = "om-mermaid-2";
    const out = mermaidMarkup(`<svg id="${root}"><style>#${root} .a{fill:red}</style><rect style="fill:#f00;stroke:#000"/></svg>`);
    expect(out).toContain('<rect data-ome-style="fill:#f00;stroke:#000"/>');
    expect(out).toContain(`<style>#${root} .a{fill:red}</style>`);
    expect(out).not.toMatch(/\sstyle=/);
    expect(() => mermaidMarkup(`<svg id="${root}"><rect style="position:fixed"/></svg>`)).toThrow(/property position/);
  });

  it("styleDeclarations splits a vetted list into setProperty pairs", () => {
    expect(styleDeclarations("display:block math; Color : red;;--x:1px;bad")).toEqual([
      ["display", "block math"],
      ["color", "red"],
      ["--x", "1px"],
    ]);
    expect(styleDeclarations("")).toEqual([]);
  });
});

describe("math — document TeX through Temml and the sink", () => {
  beforeAll(async () => {
    await new Promise<void>((resolve) => ensureMath(resolve));
  });
  const render = (tex: string) => attemptRender(() => renderMath(tex, true));

  it("a rendered formula carries no style attribute (strict CSP): Temml's styles ride data-ome-style", () => {
    for (const tex of [String.raw`\int_0^1 x\,dx = \tfrac{1}{2}`, String.raw`\mathbf{x} \quad \frac{a}{b}`, String.raw`\color{red}{x}\hspace{1em}y`]) {
      for (const display of [true, false]) {
        const out = attemptRender(() => renderMath(tex, display));
        expect(out.kind, tex).toBe("rendered");
        if (out.kind === "rendered") expect(out.value, tex).not.toMatch(/\sstyle=/);
      }
    }
    const block = attemptRender(() => renderMath("x", true));
    expect(block.kind === "rendered" && block.value).toMatch(/data-ome-style="[^"]+"/);
  });

  it("never emits a link, a script, an image or an id for hostile TeX", () => {
    const hostile = [
      String.raw`\href{javascript:alert(1)}{click}`,
      String.raw`\url{javascript:alert(1)}`,
      String.raw`\href{data:text/html,<script>alert(1)</script>}{x}`,
      String.raw`\class{x" onclick="alert(1)}{y}`,
      String.raw`\style{background:url(https://evil.example/t)}{y}`,
      String.raw`\htmlId{x}{y}`,
      String.raw`\data{foo=bar}{y}`,
      String.raw`\includegraphics{https://evil.example/t.png}`,
      String.raw`\text{<img src=x onerror=alert(1)>}`,
      String.raw`\text{<script>alert(1)</script>}`,
      String.raw`\ref{x}`,
      String.raw`\begin{equation}x\label{clobber}\end{equation}`,
      String.raw`\color{red" onclick="alert(1)}{x}`,
    ];
    for (const tex of hostile) {
      const out = render(tex);
      if (out.kind === "rendered") {
        // Only tags matter: escaped text (`&lt;img …&gt;`) is inert by construction.
        const tags = (out.value.match(/<[^>]*>/g) ?? []).join("");
        expect(tags, tex).not.toMatch(LIVE);
        expect(tags, tex).not.toMatch(/\sid=/);
        expect(out.value, tex).not.toMatch(/<(?!\/?[a-z]+[\s>])/);
      } else {
        expect(out.kind, tex).toBe("failed");
      }
    }
  });

  it("still renders ordinary formulas (no regression for normal content)", () => {
    for (const tex of [
      String.raw`E = mc^2`,
      String.raw`\frac{a}{b} + \sqrt[3]{x}`,
      String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
      String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`,
      String.raw`\cancel{x} \boxed{y} \color{red}{z}`,
      String.raw`\sum_{i=0}^n \int_a^b \lim_{x\to0}`,
      String.raw`\overbrace{abc}^{x} \underbrace{y}_{z}`,
      String.raw`\mathbb{R} \mathcal{A} \operatorname{sin} x`,
      String.raw`\begin{equation}x\tag{1}\end{equation}`,
    ]) {
      expect(render(tex).kind, tex).toBe("rendered");
    }
  });
});

describe("links — Cmd/Ctrl+click never hands a script URL to the host", () => {
  const hostile = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6A;avascript:alert(1)",
    "&#106avascript:alert(1)",
    "javascript&colon;alert(1)",
    "javascript&#58;alert(1)",
    "vbscript:msgbox(1)",
    "livescript:x",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "< javascript:alert(1)>",
  ];
  it("classifies every obfuscation as blocked", () => {
    for (const href of hostile) expect(resolveLinkTarget(href, "/notes").kind, JSON.stringify(href)).toBe("blocked");
  });

  it("keeps ordinary links as they were", () => {
    expect(resolveLinkTarget("https://example.com/a#b", "/notes")).toEqual({ kind: "external", url: "https://example.com/a#b" });
    expect(resolveLinkTarget("mailto:a@b.c", "/notes")).toEqual({ kind: "external", url: "mailto:a@b.c" });
    expect(resolveLinkTarget("./other.md", "/notes")).toEqual({ kind: "local", absPath: "/notes/other.md", heading: null });
    expect(resolveLinkTarget("#Intro", "/notes")).toEqual({ kind: "anchor", heading: "Intro" });
    expect(resolveLinkTarget("<https://example.com/a b>", "/notes")).toEqual({ kind: "external", url: "https://example.com/a b" });
    // A link whose label merely mentions javascript is fine.
    expect(resolveLinkTarget("./javascript-notes.md", "/notes").kind).toBe("local");
  });

  it("normalises the way a browser parses", () => {
    expect(normalizeUrl(" ht\ttps://a.example/ ")).toBe("https://a.example/");
    expect(isScriptUrl("data:image/png;base64,AAAA", "image")).toBe(false);
    expect(isScriptUrl("data:image/png;base64,AAAA", "link")).toBe(true);
  });
});

describe("images — the one image chokepoint", () => {
  it("with no host: only absolute https loads; everything else shows its source", () => {
    expect(editorImageSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    for (const src of [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "data:text/html,<script>alert(1)</script>",
      "http://example.com/a.png",
      "./a.png",
      "/etc/passwd",
      "../../api/delete?id=1",
      "file:///etc/passwd",
      "blob:https://x/1",
    ]) {
      expect(editorImageSrc(src), src).toBeNull();
    }
  });

  it("with a host: the host's answer, minus script-capable URLs", () => {
    const passThrough = (s: string) => s;
    expect(editorImageSrc("javascript:alert(1)", passThrough)).toBeNull();
    expect(editorImageSrc("&#106;avascript:alert(1)", passThrough)).toBeNull();
    expect(editorImageSrc("data:text/html,<script>", passThrough)).toBeNull();
    expect(editorImageSrc("data:image/png;base64,AAAA", passThrough)).toBe("data:image/png;base64,AAAA");
    expect(editorImageSrc("http://example.com/a.png", passThrough)).toBe("http://example.com/a.png");
    expect(editorImageSrc("x", () => null)).toBeNull();
  });

  it("the app's resolver keeps working for normal images", () => {
    const app = (s: string) => resolveImageSrc(s, "/notes", (p) => `asset://localhost${p}`);
    expect(editorImageSrc("pic.png", app)).toBe("asset://localhost/notes/pic.png");
    expect(editorImageSrc("https://example.com/a.png", app)).toBe("https://example.com/a.png");
    expect(editorImageSrc("javascript:alert(1)", app)).toBeNull();
    expect(editorImageSrc("../outside.png", app)).toBeNull();
  });
});

describe("raw HTML — shown as source, never rendered", () => {
  const nodeNames = (src: string) => {
    const names: string[] = [];
    dialectMarkdownParser.parse(src).iterate({ enter: (n) => void names.push(n.name) });
    return names;
  };

  it("the grammar reads raw HTML as HTML nodes, which the gate keeps out of every renderer", () => {
    expect(nodeNames("<script>alert(1)</script>\n")).toContain("HTMLBlock");
    expect(nodeNames('<img src=x onerror="alert(1)">\n')).toContain("HTMLBlock");
    expect(nodeNames("<!-- <img src=x onerror=alert(1)> -->\n")).toContain("CommentBlock");
    expect(nodeNames('text <img src=x onerror="alert(1)"> more\n')).toContain("HTMLTag");
  });

  it("a table cell shows inline HTML as its text", () => {
    const src = 'a <img src=x onerror="alert(1)"> <script>alert(1)</script> b';
    const segs = parseInlineSegments(src);
    expect(segs.every((s) => s.kind === "text")).toBe(true);
    expect(segs.map((s) => (s.kind === "text" ? s.text : "")).join("")).toBe(src);
  });

  it("the hostile fixture exists and carries every sample class", () => {
    const fixture = readFileSync(join(__dirname, "../../fixtures/rendering/untrusted.md"), "utf8");
    for (const needle of ["javascript:", "onerror", "<script>", "\\href{javascript:", "vbscript:", "data:text/html", "&#106;avascript:"]) {
      expect(fixture, needle).toContain(needle);
    }
  });
});
