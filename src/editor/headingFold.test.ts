import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { codeFolding, foldEffect } from "@codemirror/language";
import { headingFoldService, headingFolds } from "./headingFold";
import { withCompleteTree } from "./syntax";

// codeFolding() installs the fold state field so foldEffect/foldedRanges work;
// markdown() registers the headerIndent foldService that foldable() consults.
function stateOf(doc: string) {
  return withCompleteTree(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), codeFolding(), headingFoldService],
    }),
  );
}

const DOC = "# A\n\nbody a\n\n## A.1\n\nbody a1\n\n# B\n\nbody b\n";

describe("headingFolds", () => {
  it("enumerates every foldable heading, all unfolded initially", () => {
    const folds = headingFolds(stateOf(DOC));
    expect(folds.map((f) => f.lineFrom)).toEqual([
      0,
      DOC.indexOf("## A.1"),
      DOC.indexOf("# B"),
    ]);
    expect(folds.map((f) => f.folded)).toEqual([false, false, false]);
  });

  it("bounds a heading's fold range at the next same/higher heading", () => {
    const a = headingFolds(stateOf(DOC))[0];
    // '# A' folds over its body and the whole '## A.1' subsection, stopping before '# B'.
    expect(a.range.from).toBeGreaterThanOrEqual(0);
    expect(a.range.to).toBeGreaterThan(DOC.indexOf("## A.1"));
    expect(a.range.to).toBeLessThanOrEqual(DOC.indexOf("# B"));
  });

  it("marks a heading folded after a foldEffect, leaving siblings untouched", () => {
    const s0 = stateOf(DOC);
    const a = headingFolds(s0)[0];
    const s1 = s0.update({ effects: foldEffect.of(a.range) }).state;
    const folds = headingFolds(s1);
    expect(folds[0].folded).toBe(true); // # A folded
    expect(folds[1].folded).toBe(false); // ## A.1 not folded
    expect(folds[2].folded).toBe(false); // # B unaffected
  });

  it("skips a trailing heading with no foldable body", () => {
    // '## last' sits at EOF with nothing under it → not foldable.
    const folds = headingFolds(stateOf("# A\n\nbody\n\n## last"));
    expect(folds.map((f) => f.lineFrom)).toEqual([0]);
  });

  it("returns nothing for a document without headings", () => {
    expect(headingFolds(stateOf("plain\n\ntext"))).toEqual([]);
  });

  it("ignores setext headings and fenced code (ATX only)", () => {
    const doc = "Title\n=====\n\nbody\n\n```\n# not a heading\n```\n\n## real\n\nbody\n";
    // Only '## real' is an ATX heading with a body; the setext title and the
    // fenced '# not a heading' must not appear.
    const folds = headingFolds(stateOf(doc));
    expect(folds.map((f) => f.lineFrom)).toEqual([doc.indexOf("## real")]);
  });

  it("folds a section to its real end however long the document (the heading model, no parse budget)", () => {
    const doc = "# A\n\n" + "段落\n\n".repeat(5000) + "# B\n";
    const a = headingFolds(stateOf(doc))[0];
    expect(a.range).toEqual({ from: 3, to: doc.indexOf("\n\n# B") });
  });

  it("a heading inside a quote or a list is not a section and has no toggle", () => {
    const doc = "> # 引用\n> body\n\n- # 列表\n  body\n";
    expect(headingFolds(stateOf(doc))).toEqual([]);
  });
});
