import { describe, expect, it } from "vitest";
import { dialectMarkdownParser as parser } from "./dialectParser";
const nodeNames = (src: string) => {
  const names = new Set<string>();
  parser.parse(src).iterate({ enter: (n) => void names.add(n.name) });
  return names;
};

describe("editor markdown grammar (spec: markdown-dialect)", () => {
  it("does not parse the unregistered Subscript / Superscript / Emoji dialects", () => {
    const names = nodeNames("H~2~O and x^2^ and :smile:\n");
    for (const n of ["Subscript", "SubscriptMark", "Superscript", "SuperscriptMark", "Emoji"]) {
      expect(names.has(n), n).toBe(false);
    }
  });

  it("keeps GFM: tables, task lists, strikethrough", () => {
    const names = nodeNames("| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~\n");
    for (const n of ["Table", "Task", "Strikethrough"]) expect(names.has(n), n).toBe(true);
  });

  it("keeps the registered parse-level dialects: math and frontmatter", () => {
    const names = nodeNames("---\ntitle: t\n---\n\n$x$ and\n\n$$\ny\n$$\n");
    expect([...names].some((n) => /math/i.test(n)), "math").toBe(true);
    expect([...names].some((n) => /frontmatter/i.test(n)), "frontmatter").toBe(true);
  });

  describe("strike-double-tilde: strikethrough is exactly two tildes (registry row, change strike-marks)", () => {
    /** The struck source spans, against the ASSEMBLED grammar — so any second strike parser shows up here. */
    const struck = (src: string) => {
      const out: string[] = [];
      parser.parse(src).iterate({ enter: (n) => void (n.name === "Strikethrough" && out.push(src.slice(n.from, n.to))) });
      return out;
    };

    it("two tildes strike, and their marks are two characters each", () => {
      expect(struck("~~Hi~~ there")).toEqual(["~~Hi~~"]);
      const marks: string[] = [];
      parser.parse("~~Hi~~").iterate({ enter: (n) => void (n.name === "StrikethroughMark" && marks.push("~~Hi~~".slice(n.from, n.to))) });
      expect(marks).toEqual(["~~", "~~"]);
    });

    it.each([
      ["a single tilde", "Hello, ~there~ world!"],
      ["subscript-looking", "H~2~O"],
      ["three tildes", "This will ~~~not~~~ strike."],
      ["two against three", "~~a~~~"],
      ["three against two", "~~~a~~"],
      ["across paragraphs", "这里 ~~开始\n\n结束~~ 了"],
      ["a home path", "cd ~/OpenMarkdown 和 ~/notes"],
      ["an approximation", "约 ~5 分钟"],
      ["spaced tildes", "a ~ b ~ c"],
      ["inside inline code", "`~~x~~`"],
    ])("%s is plain text: %s", (_label, src) => {
      expect(struck(src)).toEqual([]);
    });

    it("a ~~~ fence is still a code block, not strikethrough", () => {
      const names = nodeNames("~~~\ncode\n~~~\n");
      expect(names.has("FencedCode")).toBe(true);
      expect(names.has("Strikethrough")).toBe(false);
    });
  });
});
