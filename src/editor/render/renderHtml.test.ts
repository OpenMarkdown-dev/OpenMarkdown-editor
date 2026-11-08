import { describe, expect, it } from "vitest";
import { collectAssets, renderHTML, safeHref, safeImageSrc } from "./renderHtml";
import { sanitizeMarkup, type SafeMarkup } from "../markup";

const r = (md: string) => renderHTML(md, { math: () => null });

describe("renderHTML: GFM basics", () => {
  it("headings carry GitHub slugs, repeated ones numbered", () => {
    expect(r("# Second part\n\n## The `setDoc` call\n\n# Second part\n")).toBe(
      '<h1 id="second-part">Second part</h1>\n<h2 id="the-setdoc-call">The <code>setDoc</code> call</h2>\n<h1 id="second-part-1">Second part</h1>\n',
    );
  });

  it("setext headings", () => {
    expect(r("Title\n=====\n")).toBe('<h1 id="title">Title</h1>\n');
  });

  it("emphasis, strong, code, strikethrough", () => {
    expect(r("*a* **b** `c` ~~d~~\n")).toBe("<p><em>a</em> <strong>b</strong> <code>c</code> <del>d</del></p>\n");
  });

  it("tight and loose lists", () => {
    expect(r("- a\n- b\n")).toBe("<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n");
    expect(r("- a\n\n- b\n")).toBe("<ul>\n<li><p>a</p>\n</li>\n<li><p>b</p>\n</li>\n</ul>\n");
  });

  it("ordered list keeps its start", () => {
    expect(r("3. a\n4. b\n")).toBe('<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>\n');
  });

  it("task items are static checkboxes", () => {
    expect(r("- [x] done\n- [ ] todo\n")).toBe(
      '<ul>\n<li class="om-task om-task-done"><input type="checkbox" disabled checked> done</li>\n<li class="om-task"><input type="checkbox" disabled> todo</li>\n</ul>\n',
    );
  });

  it("tables keep column alignment as classes, never style attributes", () => {
    const html = r("| a | b |\n|:--|--:|\n| 1 | 2 |\n");
    expect(html).toContain('<th class="om-align-left">a</th><th class="om-align-right">b</th>');
    expect(html).toContain('<td class="om-align-left">1</td><td class="om-align-right">2</td>');
    expect(html).not.toContain("style=");
  });

  it("fenced code keeps its language and its text exactly", () => {
    expect(r("```ts\nconst a = 1 < 2;\n```\n")).toBe(
      '<pre class="om-code"><code class="language-ts">const a = 1 &lt; 2;</code></pre>\n',
    );
  });

  it("a fence inside a quote loses the quote marks, not its text", () => {
    expect(r("> ```\n> x\n> y\n> ```\n")).toContain("<code>x\ny</code>");
  });

  it("hard break and horizontal rule", () => {
    expect(r("a  \nb\n\n---\n")).toBe("<p>a<br>\nb</p>\n<hr>\n");
  });
});

describe("renderHTML: links", () => {
  it("web links and #anchors work; local file links are kept as written", () => {
    expect(r("[w](https://x.dev) [a](#top) [n](notes/meeting.md)\n")).toBe(
      '<p><a href="https://x.dev">w</a> <a href="#top">a</a> <a href="notes/meeting.md">n</a></p>\n',
    );
  });

  it("reference links resolve; an undefined reference stays text", () => {
    expect(r("[a][r] [b]\n\n[r]: https://r.x \"T\"\n")).toBe('<p><a href="https://r.x" title="T">a</a> [b]</p>\n');
  });

  it("autolinks and bare URLs", () => {
    expect(r("<https://a.b> https://c.d\n")).toBe('<p><a href="https://a.b">https://a.b</a> <a href="https://c.d">https://c.d</a></p>\n');
  });

  it("a script scheme keeps the text and drops the target", () => {
    expect(r("[x](javascript:alert(1))\n")).toBe("<p>x</p>\n");
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
  });
});

describe("renderHTML: untrusted content", () => {
  it("raw HTML is shown as text, never interpreted", () => {
    const html = r('<script>alert(1)</script>\n\nhi <img src=x onerror="y">\n');
    expect(html).not.toMatch(/<script|<img src=x/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;y&quot;&gt;");
  });

  it("escapes text and attribute values", () => {
    expect(r('[a"b](https://x.y "t\\"<")\n')).toBe('<p><a href="https://x.y" title="t\\&quot;&lt;">a&quot;b</a></p>\n');
  });

  it("valid entities pass, anything else is escaped", () => {
    expect(r("&amp; &copy; AT&T\n")).toBe("<p>&amp; &copy; AT&amp;T</p>\n");
  });
});

describe("renderHTML: dialect", () => {
  it("callout with title and body; the marker line is not shown", () => {
    expect(r("> [!WARNING]\n> Back up first.\n")).toBe(
      '<div class="om-callout om-callout-warning">\n<p class="om-callout-title">Warning</p>\n<p>Back up first.</p>\n</div>\n',
    );
  });

  it("a plain quote stays a blockquote", () => {
    expect(r("> just a quote\n")).toBe("<blockquote>\n<p>just a quote</p>\n</blockquote>\n");
  });

  it("math falls back to its source while the converter is not loaded", () => {
    expect(r("x $a^2$\n")).toBe('<p>x <code class="om-math-source">$a^2$</code></p>\n');
  });

  it("a mermaid fence without a diagram renderer is a code block", () => {
    expect(r("```mermaid\ngraph LR\n```\n")).toContain('<code class="language-mermaid">graph LR</code>');
  });

  it("a drawn diagram keeps its own styles as plain style attributes", () => {
    // The editor's sanitiser carries `style` as `data-ome-style` (strict CSP);
    // an exported page has no setMarkup to re-apply it.
    const svg = sanitizeMarkup('<svg style="max-width: 650px;"><text style="fill: red">a data-ome-style="x"</text></svg>', {
      tags: new Set(["svg", "text"]),
      attrs: new Set(["style"]),
    }) as SafeMarkup;
    expect(svg).toContain("data-ome-style");
    const html = renderHTML("```mermaid\ngraph\n```\n", { diagram: () => svg });
    expect(html).toBe(
      '<figure class="om-mermaid"><svg style="max-width: 650px;"><text style="fill: red">a data-ome-style="x"</text></svg></figure>\n',
    );
  });

  it("image size, and the image hook maps the src", () => {
    const html = renderHTML("![dot|30x20](a.png)\n", { image: (s) => (s === "a.png" ? "data:image/png;base64,AA==" : null) });
    expect(html).toBe('<p><img src="data:image/png;base64,AA==" alt="dot" width="30" height="20"></p>\n');
  });

  it("frontmatter renders as a properties table", () => {
    expect(r("---\ntitle: Plan\n---\n")).toContain('<tr><th scope="row">title</th><td>Plan</td></tr>');
  });
});

describe("collectAssets", () => {
  it("lists image sources and mermaid bodies once each", () => {
    const md = "![a](x.png) ![b](x.png) ![c](https://r/y.png)\n\n```mermaid\ngraph\n```\n";
    expect(collectAssets(md)).toEqual({ images: ["x.png", "https://r/y.png"], diagrams: ["graph"] });
  });
});

describe("URL safety reads the URL as a browser does (security review 2026-11-07)", () => {
  it("a tab / newline inside the scheme does not smuggle javascript:", () => {
    for (const md of ["[x](java\tscript:alert(1))", "[x](<java\nscript:alert(1)>)", "![x](java\tscript:alert(1))"]) {
      const html = renderHTML(md);
      expect(html, md).not.toMatch(/href="[^"]*script:/i);
      expect(html, md).not.toMatch(/src="[^"]*script:/i);
    }
    expect(safeHref("java\tscript:alert(1)")).toBeNull();
    expect(safeHref(" \u0001javascript:alert(1)")).toBeNull();
    expect(safeImageSrc("da\tta:text/html,x")).toBeNull();
  });

  it("emits the normalised value, and keeps ordinary links", () => {
    expect(safeHref("https://exa\tmple.com/a")).toBe("https://example.com/a");
    expect(safeHref("  ./notes/a.md ")).toBe("./notes/a.md");
    expect(safeHref("#heading")).toBe("#heading");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
  });

  it("an entity in the scheme stays inert text, never a decoded scheme", () => {
    expect(renderHTML("[x](jav&#x61;script:alert(1))")).not.toMatch(/href="javascript:/i);
  });
});
