import { describe, expect, it } from "vitest";
import { parseInlineSegments, type InlineSegment } from "./inlineCell";

/**
 * A table cell's inline segments, read off the editor grammar's tree (changes:
 * table-cell-render-and-overflow, cell-tree). Only the string→data parse is tested here; the DOM builder (`renderInlineCell`)
 * is a thin dumb mapper and needs a DOM (no jsdom in node — see CLAUDE.md), so it
 * is verified by the browser harness (`table-cell-images`) and manual test instead. Cases derive from the spec Scenarios.
 */

const text = (t: string): InlineSegment => ({ kind: "text", text: t });

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
    expect(parseInlineSegments("`code`")).toEqual([{ kind: "code", text: "code" }]);
    expect(parseInlineSegments("`**not bold**`")).toEqual([{ kind: "code", text: "**not bold**" }]);
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
      { kind: "code", text: "d" },
    ]);
  });

  it("nests inline code inside bold", () => {
    expect(parseInlineSegments("**a `c` b**")).toEqual([
      { kind: "strong", children: [text("a "), { kind: "code", text: "c" }, text(" b")] },
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
    expect(parseInlineSegments("`a\\|b`")).toEqual([{ kind: "code", text: "a|b" }]);
    expect(parseInlineSegments("pipe \\| escaped")).toEqual([text("pipe | escaped")]);
    expect(parseInlineSegments("**x `\\|` y**")).toEqual([
      { kind: "strong", children: [text("x "), { kind: "code", text: "|" }, text(" y")] },
    ]);
    // An escaped backslash before an escaped pipe is a backslash and a pipe.
    expect(parseInlineSegments("a\\\\\\|b")).toEqual([text("a\\|b")]);
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
    expect(parseInlineSegments("\\*not italic\\*")).toEqual([text("*not italic*")]);
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
