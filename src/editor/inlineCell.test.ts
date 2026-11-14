import { describe, expect, it } from "vitest";
import { displayOffsetOf, parseInlineSegments, splitRun, type CellMark, type InlineSegment } from "./inlineCell";

/**
 * A table cell's inline segments, read off the editor grammar's tree (changes:
 * table-cell-render-and-overflow, cell-tree). Only the string→data parse is tested here; the DOM builder (`renderInlineCell`)
 * is a thin dumb mapper and needs a DOM (no jsdom in node — see CLAUDE.md), so it
 * is verified by the browser harness (`table-cell-images`) and manual test instead. Cases derive from the spec Scenarios.
 */

// Runs also carry their source range (change: caret-landing-visible); those are
// pinned in their own describe below, so the shape tests read the text only.
const text = (t: string): InlineSegment => expect.objectContaining({ kind: "text", text: t });
const code = (t: string): InlineSegment => expect.objectContaining({ kind: "code", text: t });

describe("parseInlineSegments", () => {
  it("plain text is a single text segment", () => {
    expect(parseInlineSegments("just words")).toEqual([text("just words")]);
  });

  it("renders bold", () => {
    expect(parseInlineSegments("**李四**")).toEqual([{ kind: "strong", children: [text("李四")] }]);
    expect(parseInlineSegments("__bold__")).toEqual([{ kind: "strong", children: [text("bold")] }]);
  });

  it("renders italic", () => {
    expect(parseInlineSegments("*x*")).toEqual([{ kind: "em", children: [text("x")] }]);
    expect(parseInlineSegments("_y_")).toEqual([{ kind: "em", children: [text("y")] }]);
  });

  it("renders inline code literally (no nesting inside)", () => {
    expect(parseInlineSegments("`code`")).toEqual([code("code")]);
    expect(parseInlineSegments("`**not bold**`")).toEqual([code("**not bold**")]);
  });

  it("renders links with recursive label", () => {
    expect(parseInlineSegments("[text](url)")).toEqual([
      { kind: "link", href: "url", children: [text("text")] },
    ]);
    expect(parseInlineSegments("[*x*](u)")).toEqual([
      { kind: "link", href: "u", children: [{ kind: "em", children: [text("x")] }] },
    ]);
  });

  it("empty-label link keeps an empty children list", () => {
    expect(parseInlineSegments("[](http://x)")).toEqual([{ kind: "link", href: "http://x", children: [] }]);
  });

  it("mixes literal text and markers", () => {
    expect(parseInlineSegments("a **b** c `d`")).toEqual([
      text("a "),
      { kind: "strong", children: [text("b")] },
      text(" c "),
      code("d"),
    ]);
  });

  it("nests inline code inside bold", () => {
    expect(parseInlineSegments("**a `c` b**")).toEqual([
      { kind: "strong", children: [text("a "), code("c"), text(" b")] },
    ]);
  });

  // Cell images (change: table-cell-images): the label is read by the one
  // reading (`readImageLabel`), so a cell's `\|120` is a size and the alt has none.
  // `at`: where the `!` sits in the cell's source (the label starts 2 later).
  const image = (url: string, alt: string, size: { width?: number; height?: number } = {}, at = 0): InlineSegment => {
    const label = `${alt}${size.width ? "\\" + "|" + size.width + (size.height ? "x" + size.height : "") : ""}`;
    return {
      kind: "image",
      url,
      label: { alt, ...size },
      source: `![${label}](${url})`,
      labelFrom: at + 2,
      labelTo: at + 2 + label.length,
    };
  };

  it("reads an image, its alt and its size through the one reading", () => {
    expect(parseInlineSegments("![alt](img.png)")).toEqual([image("img.png", "alt")]);
    expect(parseInlineSegments("![方块\\|120](a.png)")).toEqual([image("a.png", "方块", { width: 120 })]);
    expect(parseInlineSegments("![方块\\|120x60](a.png)")).toEqual([image("a.png", "方块", { width: 120, height: 60 })]);
  });

  it("a wrong size is not a size: the whole label is the alt", () => {
    // The cell's `\|` is GFM's escaped pipe: the alt reads `|`, as GitHub shows it;
    // `source` and the label offsets stay on the cell as written.
    expect(parseInlineSegments("![方块\\|120px](a.png)")).toEqual([
      { kind: "image", url: "a.png", label: { alt: "方块|120px" }, source: "![方块\\|120px](a.png)", labelFrom: 2, labelTo: 11 },
    ]);
  });

  // GFM: a cell's `\|` becomes `|` before the inline parse, inside code spans
  // too (change: editor-cell-fixes). A code span keeps backslashes literally, so
  // reading the cell as written showed `a\|b`.
  it("an escaped pipe shows as a pipe, inside inline code too", () => {
    expect(parseInlineSegments("`a\\|b`")).toEqual([code("a|b")]);
    expect(parseInlineSegments("pipe \\| escaped")).toEqual([text("pipe | escaped")]);
    expect(parseInlineSegments("**x `\\|` y**")).toEqual([
      { kind: "strong", children: [text("x "), code("|"), text(" y")] },
    ]);
    // An escaped backslash before an escaped pipe is a backslash and a pipe.
    // (An escape starts a new run: its `\\` is not in the text.)
    expect(parseInlineSegments("a\\\\\\|b")).toEqual([text("a"), text("\\|b")]);
  });

  it("label offsets still address the source after an escaped pipe earlier in the cell", () => {
    const src = "`\\|` ![a\\|120](p)";
    const seg = parseInlineSegments(src).find((s) => s.kind === "image");
    expect(seg && seg.kind === "image" && src.slice(seg.labelFrom, seg.labelTo)).toBe("a\\|120");
    expect(seg && seg.kind === "image" && seg.label).toEqual({ alt: "a", width: 120 });
  });

  it("an image sits among the cell's text", () => {
    expect(parseInlineSegments("x ![a](i) y")).toEqual([text("x "), image("i", "a", {}, 2), text(" y")]);
  });

  // Drag-to-resize writes back at these offsets (change: image-resize, design D4).
  it("an image's label offsets address the cell's source, nested or not", () => {
    const labels = (src: string) => {
      const out: string[] = [];
      const walk = (segs: InlineSegment[]) => {
        for (const s of segs) {
          if (s.kind === "image") out.push(src.slice(s.labelFrom, s.labelTo));
          else if ("children" in s) walk(s.children);
        }
      };
      walk(parseInlineSegments(src));
      return out;
    };
    expect(labels("![a\\|120](p) 和 ![b](q)")).toEqual(["a\\|120", "b"]);
    expect(labels("x **![粗](q)** _![斜](r)_")).toEqual(["粗", "斜"]);
    expect(labels("\\* `![码](c)` ![后](z)")).toEqual(["后"]);
  });

  it("an escaped bang or an unclosed image is text", () => {
    expect(parseInlineSegments("\\![a](i)")).toEqual([text("!"), { kind: "link", href: "i", children: [text("a")] }]);
    expect(parseInlineSegments("![a](")).toEqual([text("![a](")]);
  });

  it("keeps unclosed markers as literal text", () => {
    expect(parseInlineSegments("**unclosed")).toEqual([text("**unclosed")]);
    expect(parseInlineSegments("`unclosed")).toEqual([text("`unclosed")]);
    expect(parseInlineSegments("[label](unclosed")).toEqual([text("[label](unclosed")]);
  });

  it("honors backslash escapes", () => {
    expect(parseInlineSegments("\\*not italic\\*")).toEqual([text("*not italic"), text("*")]);
  });

  it("returns empty for empty input", () => {
    expect(parseInlineSegments("")).toEqual([]);
  });

  // change: cell-tree — the cell reads the editor grammar, so the body's rules hold here.
  it("strikes on exactly two tildes, like the body", () => {
    expect(parseInlineSegments("~~划掉~~")).toEqual([{ kind: "strike", children: [text("划掉")] }]);
    expect(parseInlineSegments("~划掉~")).toEqual([text("~划掉~")]);
    expect(parseInlineSegments("~~~not~~~")).toEqual([text("~~~not~~~")]);
    expect(parseInlineSegments("~~**粗**~~")).toEqual([
      { kind: "strike", children: [{ kind: "strong", children: [text("粗")] }] },
    ]);
  });

  it("an inline formula is a math segment carrying its source", () => {
    expect(parseInlineSegments("$x^2$")).toEqual([{ kind: "math", source: "$x^2$" }]);
    expect(parseInlineSegments("a $y$ b")).toEqual([text("a "), { kind: "math", source: "$y$" }, text(" b")]);
  });

  it("a cell the grammar reads as a block shows its source", () => {
    for (const src of ["# 标题", "- 列表", "> 引用", "1. 一"]) expect(parseInlineSegments(src)).toEqual([text(src)]);
  });

  it("nodes not drawn in cells show their source", () => {
    expect(parseInlineSegments("a <b>x</b>")).toEqual([text("a <b>x</b>")]);
    expect(parseInlineSegments("<https://x.y>")).toEqual([text("<https://x.y>")]);
  });
});

describe("a cell formula before the converter loads (change: render-placeholder-size)", () => {
  it("is pending — the placeholder — not its TeX (this file never loads the converter)", async () => {
    const { cellFormula } = await import("./inlineCell");
    expect(cellFormula("$ax^2 + bx + c = 0$")).toEqual({ kind: "pending" });
  });
});

/**
 * Painting Find matches and the landing in a cell (change: caret-landing-visible,
 * design D3): each run knows where it sits in the cell's source, and the pure
 * `splitRun` cuts a run by marks given in source offsets.
 */
describe("runs keep their source range, and marks split them", () => {
  const runs = (src: string) => {
    const out: { kind: string; text: string; src: string }[] = [];
    const walk = (segs: InlineSegment[]) => {
      for (const s of segs) {
        if (s.kind === "text" || s.kind === "code") out.push({ kind: s.kind, text: s.text, src: src.slice(s.from, s.to) });
        else if ("children" in s) walk(s.children);
      }
    };
    walk(parseInlineSegments(src));
    return out;
  };

  it("a run's range is its text in the source, through markup, code, links and escaped pipes", () => {
    expect(runs("in the cell")).toEqual([{ kind: "text", text: "in the cell", src: "in the cell" }]);
    expect(runs("a **the** b")).toEqual([
      { kind: "text", text: "a ", src: "a " },
      { kind: "text", text: "the", src: "the" },
      { kind: "text", text: " b", src: " b" },
    ]);
    expect(runs("run `the` now")[1]).toEqual({ kind: "code", text: "the", src: "the" });
    expect(runs("see [the docs](https://example.com)")[1]).toEqual({ kind: "text", text: "the docs", src: "the docs" });
    // `\|` is one character of the text and two of the source.
    expect(runs("a \\| the")).toEqual([{ kind: "text", text: "a | the", src: "a \\| the" }]);
  });

  const marked = (src: string, marks: CellMark[]) => {
    const display = displayOffsetOf(src);
    const out: string[] = [];
    const walk = (segs: InlineSegment[]) => {
      for (const s of segs) {
        if (s.kind === "text" || s.kind === "code") {
          for (const p of splitRun(s.text, display(s.from), marks, display)) out.push(p.kind ? `[${p.kind}:${p.text}]` : p.text);
        } else if ("children" in s) walk(s.children);
      }
    };
    walk(parseInlineSegments(src));
    return out.join("|");
  };
  const at = (src: string, word: string, kind: CellMark["kind"] = "match"): CellMark => {
    const from = src.indexOf(word);
    return { from, to: from + word.length, kind };
  };

  it("paints a match in plain text, bold, code and a link label", () => {
    expect(marked("in the cell", [at("in the cell", "the")])).toBe("in |[match:the]| cell");
    expect(marked("a **the** b", [at("a **the** b", "the", "current")])).toBe("a |[current:the]| b");
    expect(marked("run `the` now", [at("run `the` now", "the")])).toBe("run |[match:the]| now");
    const link = "see [the docs](https://example.com)";
    expect(marked(link, [at(link, "the", "selection")])).toBe("see |[selection:the]| docs");
  });

  it("a match spanning markup is painted on each run it covers", () => {
    // Find reads the source: `t**he` is no match, so the match is drawn on the
    // text `the` here as it would be found in `t**he**` by a source query `t**he`.
    const src = "t**he** split";
    expect(marked(src, [{ from: 0, to: 5, kind: "match" }])).toBe("[match:t]|[match:he]| split");
  });

  it("source offsets after an escaped pipe land on the right characters", () => {
    const src = "a \\| the";
    expect(marked(src, [at(src, "the")])).toBe("a | |[match:the]");
  });

  it("the current match wins over a plain match it overlaps", () => {
    const src = "the";
    expect(marked(src, [at(src, "the"), at(src, "the", "current")])).toBe("[current:the]");
  });
});

