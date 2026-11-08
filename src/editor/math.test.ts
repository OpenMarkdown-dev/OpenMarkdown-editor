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

describe("mathBody", () => {
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
    await new Promise<void>((resolve) => ensureMath(resolve));
    expect(renderMath("\\sqrt{2}", false)).toContain("<msqrt>");
    expect(() => renderMath("\\frac{1}{", false)).toThrow(/Unexpected end of input/);
    expect(() => renderMath("\\begin{matrix} a", true)).toThrow();
    // Not a failure: Temml draws the formula and marks the command itself.
    expect(renderMath("\\foo x", false)).toContain("<math");
    // Never the painted-red error output that looked like a render.
    expect(() => renderMath("a}", false)).toThrow();
  });
});
