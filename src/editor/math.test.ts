import { importTemml } from "./mathImport";
import { describe, it, expect } from "vitest";
import { parser } from "@lezer/markdown";
import { ensureMath, mathMarkdown, mathBody, renderMath } from "./math";

// The @lezer/markdown parser runs standalone in node (no EditorView needed —
// see CLAUDE.md), so we assert the syntax tree directly.
const mathParser = parser.configure([mathMarkdown]);

function nodeNames(src: string): Set<string> {
  const names = new Set<string>();
  mathParser.parse(src).iterate({ enter: (n) => void names.add(n.name) });
  return names;
}

describe("math markdown extension", () => {
  it("recognizes inline $…$", () => {
    expect(nodeNames("an $a^2 + b^2$ formula")).toContain("InlineMath");
  });

  it("recognizes single-line block $$…$$", () => {
    expect(nodeNames("$$E = mc^2$$")).toContain("BlockMath");
  });

  it("recognizes multi-line block $$…$$", () => {
    expect(nodeNames("$$\n\\int_0^1 x\\,dx\n$$")).toContain("BlockMath");
  });

  it("does NOT treat prose dollars as math", () => {
    // Space before the closing `$` disqualifies it (CommonMark-math rule).
    expect(nodeNames("Cost is $5 and $10 total")).not.toContain("InlineMath");
  });

  it("does NOT open inline math on a dangling $", () => {
    expect(nodeNames("that is $5")).not.toContain("InlineMath");
  });

  it("does NOT treat empty $$$$ as a block", () => {
    expect(nodeNames("$$$$")).not.toContain("BlockMath");
  });

  it("keeps $ inside a code span as code, not math", () => {
    const names = nodeNames("`$x$`");
    expect(names).toContain("InlineCode");
    expect(names).not.toContain("InlineMath");
  });
});

/** The sources of the math nodes, in document order. */
function mathSources(src: string): string[] {
  const out: string[] = [];
  mathParser.parse(src).iterate({
    enter: (n) => {
      if (n.name === "InlineMath" || n.name === "BlockMath") out.push(src.slice(n.from, n.to));
    },
  });
  return out;
}

describe("math delimiters (change: editor-dialect; vectors in syntaxSupport.ts)", () => {
  it("a closing $ followed by a digit closes nothing (Pandoc)", () => {
    expect(mathSources("from $20-$30")).toEqual([]);
    expect(mathSources("$1,000-$2,000")).toEqual([]);
  });

  it("a failed closing $ does not send the scan on to a later one", () => {
    expect(mathSources("$5 and $10 and $x$")).toEqual(["$x$"]);
  });

  it("an escaped $ inside a formula does not close it", () => {
    expect(mathSources("$a\\$b$")).toEqual(["$a\\$b$"]);
    expect(mathSources("\\$5 and $x$")).toEqual(["$x$"]);
  });

  it("$$…$$ inside a line is one inline formula, never $ + $…$ + $", () => {
    expect(mathSources("inline $$x^2$$ here")).toEqual(["$$x^2$$"]);
    expect(mathSources("$$x$$ then")).toEqual(["$$x$$"]);
    expect(mathSources("a $$ b")).toEqual([]);
    expect(mathSources("$$$x$$$")).toEqual([]);
  });

  it("\\(…\\) is inline math; an unclosed \\( stays an escape", () => {
    expect(mathSources("a \\( x \\) b \\(y\\)")).toEqual(["\\( x \\)", "\\(y\\)"]);
    expect(mathSources("\\(a and b")).toEqual([]);
    expect(mathSources("\\(\\) and \\(  \\)")).toEqual([]);
  });

  it("\\[ … \\] is block math only as a paragraph of its own", () => {
    expect(mathSources("\\[\nx = 1\n\\]")).toEqual(["\\[\nx = 1\n\\]"]);
    expect(mathSources("\\[ x \\]\n\nafter")).toEqual(["\\[ x \\]"]);
    expect(mathSources("\\[x\\]")).toEqual([]);
    expect(mathSources("text\n\\[\nx\n\\]")).toEqual([]);
    expect(mathSources("\\[ a \\] b \\[ c \\]")).toEqual([]);
  });

  it("an unclosed \\[ swallows nothing", () => {
    const names = nodeNames("\\[\nx\n\nlater paragraph");
    expect(names).not.toContain("BlockMath");
  });
});

describe("mathBody", () => {
  it("strips each delimiter pair", () => {
    expect(mathBody("\\( x \\)")).toBe("x");
    expect(mathBody("\\[\nx = 1\n\\]")).toBe("x = 1");
    expect(mathBody("$$x$$")).toBe("x");
    expect(mathBody("$a\\$$")).toBe("a\\$");
    expect(mathBody("$$\nunclosed")).toBe("unclosed");
  });

  it("strips $$ block delimiters", () => {
    expect(mathBody("$$E = mc^2$$")).toBe("E = mc^2");
  });

  it("strips $ inline delimiters", () => {
    expect(mathBody("$a^2$")).toBe("a^2");
  });

  it("trims surrounding whitespace", () => {
    expect(mathBody("$$  x + y  $$")).toBe("x + y");
  });
});

describe("renderMath is a renderer that throws (change: block-fallback, design D4)", () => {
  it("is null before the converter loads, then renders, throws on bad TeX, renders unknown commands", async () => {
    // The converter loads once per module; this file never loaded it before.
    expect(renderMath("x", false)).toBeNull();
    await new Promise<void>((resolve) => ensureMath(importTemml, resolve));
    expect(renderMath("\\sqrt{2}", false)).toContain("<msqrt>");
    expect(() => renderMath("\\frac{1}{", false)).toThrow(/Unexpected end of input/);
    expect(() => renderMath("\\begin{matrix} a", true)).toThrow();
    // Not a failure: Temml draws the formula and marks the command itself.
    expect(renderMath("\\foo x", false)).toContain("<math");
    // Never the painted-red error output that looked like a render.
    expect(() => renderMath("a}", false)).toThrow();
  });
});
