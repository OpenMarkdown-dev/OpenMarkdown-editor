import { describe, expect, it } from "vitest";
import type { SyntaxNode } from "@lezer/common";
import { dialectMarkdownParser } from "./dialectParser";
import { isLink, labelKey, linkMarkConcealable, referenceDefinitions, referenceLabels } from "./linkRefs";

/** The first `Link` in `doc`, with the predicate's answer for it. */
function firstLink(doc: string): { link: SyntaxNode; linked: boolean } {
  const tree = dialectMarkdownParser.parse(doc);
  const read = (a: number, b: number) => doc.slice(a, b);
  let link: SyntaxNode | null = null;
  tree.iterate({
    enter: (n) => {
      if (!link && n.name === "Link") link = n.node;
    },
  });
  if (!link) throw new Error(`no Link in ${JSON.stringify(doc)}`);
  return { link, linked: isLink(link, read, referenceLabels(tree, read)) };
}

describe("labelKey", () => {
  it("folds case and whitespace the CommonMark way", () => {
    expect(labelKey("  Foo \t Bar ")).toBe("foo bar");
    expect(labelKey("FOO")).toBe(labelKey("foo"));
  });
});

describe("isLink — the one answer to 'is this a link?'", () => {
  const cases: [string, boolean][] = [
    ["> [!FOOBAR]\n> 未知类型", false],
    ["> [!note]- Folded", false],
    ["see [foo] here", false],
    ["see [foo] here\n\n[foo]: https://example.com", true],
    ["[a](u)", true],
    ["[](u)", true],
    // An empty destination is still a link (CommonMark: `<a href="">`).
    ["[a]()", true],
    ["[a]( )", true],
    ["[a](<>)", true],
    ["[a][r]", false],
    ["[a][r]\n\n[r]: u", true],
    ["[r][]\n\n[r]: u", true],
    ["see [ Foo  Bar ] here\n\n[foo bar]: u", true],
    ["see [FOO] here\n\n[foo]: u", true],
    ["- item\n\n  [q]: u\n\n[q]", true],
    ["> [q]: u\n\n[q]", true],
  ];
  for (const [doc, want] of cases) {
    it(`${JSON.stringify(doc)} → ${want ? "link" : "text"}`, () => {
      expect(firstLink(doc).linked).toBe(want);
    });
  }

  it("the first definition of a label wins", () => {
    const doc = "[r]\n\n[r]: first\n[R]: second";
    const tree = dialectMarkdownParser.parse(doc);
    const read = (a: number, b: number) => doc.slice(a, b);
    const def = referenceDefinitions(tree, read).get("r")!;
    expect(read(def.from, def.to)).toBe("[r]: first");
  });
});

describe("linkMarkConcealable", () => {
  const marks = (doc: string) => {
    const tree = dialectMarkdownParser.parse(doc);
    const read = (a: number, b: number) => doc.slice(a, b);
    const labels = referenceLabels(tree, read);
    const out: [string, boolean][] = [];
    tree.iterate({
      enter: (n) => {
        if (n.name === "LinkMark") out.push([`${n.node.parent!.name}:${read(n.from, n.to)}`, linkMarkConcealable(n.node, read, labels)]);
      },
    });
    return out;
  };

  it("hides a Link's marks only when it is a link", () => {
    expect(marks("see [foo] here")).toEqual([
      ["Link:[", false],
      ["Link:]", false],
    ]);
    expect(marks("[a](u)").every(([, c]) => c)).toBe(true);
  });

  it("leaves images, autolinks and definition lines as they were", () => {
    expect(marks("![alt](u)").every(([, c]) => c)).toBe(true);
    expect(marks("<https://x.y>").every(([, c]) => c)).toBe(true);
    expect(marks("[r]: u")).toEqual([["LinkReference::", true]]);
  });
});
