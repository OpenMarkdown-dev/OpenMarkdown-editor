import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import { imageLabelOf, inImageTarget, readImageLabel, writeImageSize } from "./imageAlt";
import { treeUpTo, withCompleteTree } from "./syntax";

/** spec: markdown-dialect / 图片尺寸写法 — every scenario, plus the edges design D1–D2 name. */
describe("readImageLabel", () => {
  it("reads a width, or a width and a height", () => {
    expect(readImageLabel("截图|300")).toEqual({ alt: "截图", width: 300 });
    expect(readImageLabel("截图|300x200")).toEqual({ alt: "截图", width: 300, height: 200 });
  });

  it("allows an empty alt", () => {
    expect(readImageLabel("|300")).toEqual({ alt: "", width: 300 });
  });

  it("only the last separator counts", () => {
    expect(readImageLabel("a|b|300")).toEqual({ alt: "a|b", width: 300 });
  });

  it("an escaped \\| separates exactly like |", () => {
    expect(readImageLabel("截图\\|300")).toEqual({ alt: "截图", width: 300 });
    expect(readImageLabel("截图\\|300x200")).toEqual({ alt: "截图", width: 300, height: 200 });
  });

  it("anything else is not a size, and the whole label is the alt", () => {
    for (const label of [
      "截图|300px",
      "截图|0",
      "截图|300x0",
      "截图|x200",
      "截图|300x",
      "截图| 300",
      "截图|300 ",
      "截图|30.5",
      "截图|300X200",
      "截图|-300",
      "截图|",
      "截图",
      "",
    ]) {
      expect(readImageLabel(label), label).toEqual({ alt: label });
    }
  });

  it("a written-but-wrong last segment does not fall back to an earlier one", () => {
    expect(readImageLabel("a|300|big")).toEqual({ alt: "a|300|big" });
  });
});

function imageIn(doc: string): { state: EditorState; image: SyntaxNode } {
  const state = withCompleteTree(EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] }));
  let image: SyntaxNode | null = null;
  treeUpTo(state, state.doc.length).iterate({
    enter: (n) => {
      if (n.name === "Image" && !image) image = n.node;
    },
  });
  if (!image) throw new Error(`no Image in ${doc}`);
  return { state, image };
}

describe("imageLabelOf", () => {
  it("reads between the tree's own brackets, so an alt holding [b] reads whole", () => {
    const { state, image } = imageIn("![a [b] c|120](p.png)");
    expect(imageLabelOf(state, image)).toEqual({ alt: "a [b] c", width: 120 });
  });

  it("reads a plain image and an empty one", () => {
    const a = imageIn("x ![方块](attachments/square.png) y");
    expect(imageLabelOf(a.state, a.image)).toEqual({ alt: "方块" });
    const b = imageIn("![](p.png)");
    expect(imageLabelOf(b.state, b.image)).toEqual({ alt: "" });
  });

  it("reads a table cell's raw \\| as the separator", () => {
    const { state, image } = imageIn("![方块\\|120](attachments/square.png)");
    expect(imageLabelOf(state, image)).toEqual({ alt: "方块", width: 120 });
  });
});

describe("writeImageSize (change: image-resize, design D2)", () => {
  const apply = (label: string, e: { from: number; to: number; insert: string } | null) =>
    e ? label.slice(0, e.from) + e.insert + label.slice(e.to) : label;

  it("replaces only the digits of a written size, keeping its separator", () => {
    expect(apply("方块|120", writeImageSize("方块|120", { width: 200 }, false))).toBe("方块|200");
    expect(apply("方块\\|120", writeImageSize("方块\\|120", { width: 200 }, true))).toBe("方块\\|200");
    // A `\|` written outside a table stays `\|`: only the digits change.
    expect(apply("方块\\|120", writeImageSize("方块\\|120", { width: 90 }, false))).toBe("方块\\|90");
    expect(writeImageSize("方块|120", { width: 200 }, false)).toEqual({ from: 3, to: 6, insert: "200" });
  });

  it("appends a size where none is written, `\\|` in a table cell", () => {
    expect(apply("方块", writeImageSize("方块", { width: 40 }, false))).toBe("方块|40");
    expect(apply("方块", writeImageSize("方块", { width: 40 }, true))).toBe("方块\\|40");
    expect(apply("", writeImageSize("", { width: 40 }, false))).toBe("|40");
    // Not a size today → the whole label is the alt, and a size is appended after it.
    expect(apply("方块|120px", writeImageSize("方块|120px", { width: 40 }, false))).toBe("方块|120px|40");
    expect(apply("a|b", writeImageSize("a|b", { width: 40 }, false))).toBe("a|b|40");
  });

  it("writes width and height together for a label that writes both", () => {
    expect(apply("方块|120x60", writeImageSize("方块|120x60", { width: 200, height: 100 }, false))).toBe("方块|200x100");
    expect(apply("a|b|120", writeImageSize("a|b|120", { width: 7 }, false))).toBe("a|b|7");
  });

  it("is no edit when the size is unchanged", () => {
    expect(writeImageSize("方块|120", { width: 120 }, false)).toBeNull();
    expect(writeImageSize("方块|120x60", { width: 120, height: 60 }, false)).toBeNull();
    expect(writeImageSize("方块|120x60", { width: 120 }, false)).not.toBeNull();
  });

  it("round-trips through the one reading", () => {
    for (const [label, size, inTable] of [
      ["方块", { width: 33 }, true],
      ["方|块|120", { width: 5 }, false],
      ["x [y] z", { width: 64, height: 32 }, false],
    ] as const) {
      const out = apply(label, writeImageSize(label, size, inTable));
      const read = readImageLabel(out);
      expect({ width: read.width, height: read.height }).toEqual({ width: size.width, height: "height" in size ? size.height : undefined });
    }
  });
});

describe("inImageTarget (change image-viewer)", () => {
  it("is true only inside an image's unfinished target", () => {
    expect(inImageTarget("see ![chart](att")).toBe(true);
    expect(inImageTarget("see ![](")).toBe(true);
    expect(inImageTarget("see [chart](att")).toBe(false);
    expect(inImageTarget("see ![chart](a.png) and [x](")).toBe(false);
  });
});
