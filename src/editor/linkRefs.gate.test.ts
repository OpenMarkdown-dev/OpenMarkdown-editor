import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";
import { dialectBase, dialectExtensions, dialectMarkdownParser } from "./dialectParser";
import { withCompleteTree } from "./syntax";
import { renderedTextForRange } from "./plainCopy";
import { renderHTML } from "./render/renderHtml";
import { parseInlineSegments, type InlineSegment } from "./inlineCell";
import { FORMATTING_MARKS } from "./previewConceal";
import { isLink, referenceLabels } from "./linkRefs";

/**
 * Gate (spec: live-preview-editor / 方括号是否成链接只有一个判定; change:
 * write-back-valid, design D7). Whether a bracket pair is a link has ONE answer,
 * `isLink` in `linkRefs.ts`; a view that hides a `LinkMark` asks it first
 * (`linkMarkConcealable`). This test fails, with file:line, on:
 *
 * - L1: a `"LinkMark"` in a source file that is not listed below with the
 *   reason it may name one; a listed file that HIDES marks must call the
 *   predicate, and the shared conceal set must not carry `LinkMark`.
 * - L2: the sample set (the spec's scenario list) disagreeing across the
 *   predicate, plain copy (reading mode's text, and the stand-in for live
 *   preview: both hide marks through `linkMarkConcealable`) and the HTML
 *   renderer — or the table cell's "no URL → source" claiming a link the
 *   predicate does not see (it must be a subset).
 *
 * Limits (stated, not hidden): L1 is textual — comments are stripped, tests
 * and the browser harness are not scanned, and a mark named through a variable
 * built at runtime is not seen. Live preview's hide ranges need an
 * `EditorView`, which node cannot build; plain copy stands in for them.
 */

const SRC = join(__dirname, "..");
const MARK = '"Link' + 'Mark"';

/** Files that may name the mark, and why. `hides`: it conceals marks, so it must ask the predicate. */
const OWNERS: Record<string, { why: string; hides?: true }> = {
  "editor/linkRefs.ts": { why: "the one predicate" },
  "editor/livePreview.ts": { why: "live preview hides a link's brackets", hides: true },
  "editor/plainCopy.ts": { why: "plain copy drops a link's brackets", hides: true },
  "editor/render/renderHtml.ts": {
    why: "the renderer resolves every Link / Image through referenceDefinitions + referenceLabelOf; its MARKS set only drops marks of nodes link() already resolved",
  },
  "editor/inlineCell.ts": { why: "reads a link's bracket offsets in a table cell; no URL → source (checked as a subset below)" },
  "editor/imageAlt.ts": { why: "reads an image's label offsets; never hides" },
};

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function violations(files: { path: string; code: string }[]): string[] {
  const found: string[] = [];
  for (const { path, code } of files) {
    if (path.startsWith("dev/harness/")) continue;
    const stripped = stripComments(code);
    const owner = OWNERS[path];
    stripped.split("\n").forEach((line, i) => {
      if (line.includes(MARK) && !owner) found.push(`${path}:${i + 1}: names LinkMark outside the link predicate's owners`);
    });
    if (owner?.hides && stripped.includes(MARK) && !stripped.includes("linkMarkConcealable(")) {
      const at = stripped.split("\n").findIndex((l) => l.includes(MARK));
      found.push(`${path}:${at + 1}: hides LinkMark without asking linkMarkConcealable`);
    }
  }
  return found;
}

describe("link predicate gate · L1 (lexical)", () => {
  it("LinkMark is named only by the predicate's owners, and every hider asks it", () => {
    const files = listFiles(SRC, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ }).map((p: string) => ({
      path: repoPath(SRC, p),
      code: readFileSync(p, "utf8"),
    }));
    for (const owner of Object.keys(OWNERS)) expect(files.some((f) => f.path === owner), owner).toBe(true);
    expect(violations(files)).toEqual([]);
  });

  it("the shared conceal set does not hide LinkMark unconditionally", () => {
    expect(FORMATTING_MARKS.has("LinkMark")).toBe(false);
  });

  it("catches a second hider and a hider that skips the predicate", () => {
    expect(violations([{ path: "editor/widgets.ts", code: `if (node.name === ${MARK}) conceal(node.from, node.to);` }])).toEqual([
      "editor/widgets.ts:1: names LinkMark outside the link predicate's owners",
    ]);
    expect(violations([{ path: "editor/plainCopy.ts", code: `if (name === ${MARK}) push(node.from, node.to);` }])).toEqual([
      "editor/plainCopy.ts:1: hides LinkMark without asking linkMarkConcealable",
    ]);
    expect(violations([{ path: "editor/x.ts", code: `// a ${MARK} in a comment` }])).toEqual([]);
  });
});

/** The sample set: the document, the bracket pair's source, and whether it is a link. */
const SAMPLES: { doc: string; pair: string; link: boolean }[] = [
  { doc: "> [!FOOBAR]\n> 未知类型", pair: "[!FOOBAR]", link: false },
  { doc: "> [!note]- Folded", pair: "[!note]", link: false },
  { doc: "see [foo] here", pair: "[foo]", link: false },
  { doc: "see [foo] here\n\n[foo]: https://example.com", pair: "[foo]", link: true },
  { doc: "see [a](https://u.example) here", pair: "[a](https://u.example)", link: true },
  { doc: "see [a]() here", pair: "[a]()", link: true },
  { doc: "see [a][r] here", pair: "[a][r]", link: false },
  { doc: "see [a][r] here\n\n[r]: https://example.com", pair: "[a][r]", link: true },
];

function liveState(doc: string): EditorState {
  return withCompleteTree(
    EditorState.create({ doc, extensions: [markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false })] }),
  );
}

function predicate(doc: string): boolean {
  const tree = dialectMarkdownParser.parse(doc);
  const read = (a: number, b: number) => doc.slice(a, b);
  let link: SyntaxNode | null = null;
  tree.iterate({
    enter: (n) => {
      if (!link && n.name === "Link") link = n.node;
    },
  });
  return !!link && isLink(link, read, referenceLabels(tree, read));
}

const hasLink = (segs: InlineSegment[]): boolean =>
  segs.some((s) => s.kind === "link" || ("children" in s && Array.isArray(s.children) && hasLink(s.children as InlineSegment[])));

describe("link predicate gate · L2 (one answer across the views)", () => {
  for (const { doc, pair, link } of SAMPLES) {
    it(`${JSON.stringify(doc)}: ${pair} is ${link ? "a link" : "text"} everywhere`, () => {
      expect(predicate(doc), "isLink").toBe(link);

      // Plain copy (reading mode; live preview's stand-in): the first line.
      const state = liveState(doc);
      const firstLine = state.doc.line(1);
      const copied = renderedTextForRange(state, firstLine.from, firstLine.to).text;
      expect(copied.includes("["), `plain copy ${JSON.stringify(copied)}`).toBe(!link);

      // The HTML renderer.
      const html = renderHTML(doc);
      expect(/<a\s/.test(html), `renderHTML ${html}`).toBe(link);
      if (!link) expect(html, "renderHTML keeps the brackets").toContain(pair.replace(/\]\(.*$/, "]"));

      // A table cell resolves no references: it may say "not a link" more
      // often, never "link" where the predicate says text.
      const line = doc.split("\n")[0].replace(/^> /, "");
      if (hasLink(parseInlineSegments(line))) expect(link, "inlineCell ⊆ isLink").toBe(true);
    });
  }
});

/**
 * L3: the link colour has one source. The parser tags EVERY bracket pair
 * `t.link` (`Link/...` in `@lezer/markdown`), so a live/reading highlight rule
 * on that tag paints `[foo]` as a link even when `isLink` says it is text.
 * The colour comes only from the `.om-link` mark, which the live preview adds
 * after asking the predicate. (Source mode is raw text and may colour the tag.)
 */
describe("link predicate gate · L3 (link colour)", () => {
  it("the live/reading highlight style does not colour the parser's link tag", () => {
    const theme = readFileSync(join(SRC, "editor", "theme.ts"), "utf8");
    const start = theme.indexOf("export const markdownHighlighting");
    const end = theme.indexOf("export const sourceHighlighting");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(theme.slice(start, end)).not.toMatch(/tag:\s*t\.link\b/);
  });
});
