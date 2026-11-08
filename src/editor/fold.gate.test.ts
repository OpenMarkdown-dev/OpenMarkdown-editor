import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldable } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";
import { dialectBase, dialectExtensions } from "./dialectParser";
import { listFoldRange, listFoldService } from "./listFold";
import { withCompleteTree } from "./syntax";

/**
 * Fold gate (spec: live-preview-editor / 折叠范围只有两处来源; changes:
 * missing-gates design D6 / D7, callout-suffix design D2). Every fold range
 * comes from one of two registered sources — headings (`headingFold.ts`) and
 * list items (`listFold.ts`) — and the language's own block folds stay off
 * except the table's: no quote, callout, paragraph or code block folds. The
 * toggle, the fold shortcuts, fold-all and Enter / Tab on a folded item all
 * take the range of that one source. Named for folding as a whole (it was the
 * list-fold gate) since it now also pins what does NOT fold. This test fails,
 * with the file, on:
 *
 * - F1: `foldService` outside the heading and list folds — the two places a
 *   fold range may come from;
 * - F2: a syntax-level fold prop (`foldNodeProp` / `foldInside`) outside the
 *   dialect parser, plus a BEHAVIOURAL check that the parser keeps every
 *   library block fold but the table's switched off (a lexical check on that
 *   one line would miss a synonym or a deletion);
 * - F3: `foldEffect.of(` outside the shared fold toggle and the golden-case
 *   runner — folding by a range computed on the spot.
 *
 * Limits (stated, not hidden): textual for F1–F3; comments are stripped and
 * tests are not scanned; F3 skips the browser harness, which folds ranges it
 * got from `foldable()`. Hiding content without the fold machinery (CSS, a
 * multi-line inline replace — the block-level one is caught by the block gate)
 * is not seen, nor a second range scan written INSIDE an owner file. The fold
 * range and the structure keys' list tree both derive from the same ListItem
 * node; behaviour tests, not this gate, keep them agreeing.
 */

const SRC = join(__dirname, "..");
const HARNESS = "dev/harness/";

interface Rule {
  what: string;
  re: RegExp;
  owners: Record<string, string>;
  /** The harness is a test driver: skipped where it only drives the one range. */
  skipHarness: boolean;
}

// Assembled so this file's own source never matches its rules.
const SERVICE = "fold" + "Service";
const NODE_PROP = "fold" + "NodeProp";
const INSIDE = "fold" + "Inside";
const EFFECT = "fold" + "Effect";

const RULES: Rule[] = [
  {
    what: `${SERVICE} outside the heading and list folds`,
    re: new RegExp(`\\b${SERVICE}\\b`),
    owners: {
      "editor/listFold.ts": "the list item fold range",
      "editor/headingFold.ts": "the heading fold range (the one heading model)",
    },
    skipHarness: false,
  },
  {
    what: `a syntax fold prop (${NODE_PROP} / ${INSIDE}) outside the dialect parser`,
    re: new RegExp(`\\b(?:${NODE_PROP}|${INSIDE})\\b`),
    owners: { "editor/dialectParser.ts": "keeps the Table fold, switches every other library block fold off" },
    skipHarness: false,
  },
  {
    what: `${EFFECT}.of( outside the shared fold toggle and the golden runner`,
    re: new RegExp(`\\b${EFFECT}\\.of\\s*\\(`),
    owners: {
      "editor/headingFold.ts": "FoldToggleWidget, the one toggle for headings and list items",
      "editor/structure/golden.ts": "golden-case runner; folds the range listFoldRange gives",
    },
    skipHarness: true,
  },
];

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function sources(dir: string): string[] {
  return listFiles(dir, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ });
}

export function violations(files: { path: string; code: string }[]): string[] {
  const found: string[] = [];
  for (const { path, code } of files) {
    stripComments(code)
      .split("\n")
      .forEach((line, i) => {
        for (const rule of RULES) {
          if (rule.owners[path] || (rule.skipHarness && path.startsWith(HARNESS))) continue;
          if (rule.re.test(line)) found.push(`${path}:${i + 1}: ${rule.what}`);
        }
      });
  }
  return found;
}

/** A state in the editor's own markdown dialect, complete tree, plus `extra`. */
function dialectState(doc: string, extra: Extension = []): EditorState {
  return withCompleteTree(
    EditorState.create({
      doc,
      extensions: [markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }), extra],
    }),
  );
}

const DOC = "- a\n  - b\n\n| x | y |\n| - | - |\n| 1 | 2 |\n";
/** Multi-line blocks the language would fold by itself; first lines below. */
const BLOCKS = [
  "> a quote", "> more", "", // 1–3
  "> [!note]", "> body", "> more", "", // 4–7
  "> [!note]-", "> body", "", // 8–10
  "para one", "para two", "", // 11–13
  "```", "code", "x", "```", "", // 14–18
  "$$", "y", "$$", // 19–21
].join("\n");
const BLOCK_FIRST_LINES: [number, string][] = [
  [1, "plain quote"],
  [4, "unsuffixed callout"],
  [8, "suffixed callout"],
  [11, "paragraph"],
  [14, "fenced code"],
  [19, "math block"],
];
const lineRange = (state: EditorState, n: number) => [state.doc.line(n).from, state.doc.line(n).to] as const;

describe("fold gate", () => {
  it("fold ranges come from the heading and list folds only", () => {
    const files = sources(SRC).map((p) => ({ path: repoPath(SRC, p), code: readFileSync(p, "utf8") }));
    expect(files.some((f) => f.path === "editor/listFold.ts")).toBe(true);
    expect(violations(files)).toEqual([]);
  });

  it("the dialect keeps every library block fold off but the table's", () => {
    const state = dialectState(DOC);
    expect(foldable(state, ...lineRange(state, 1))).toBeNull();
    // Control: the fold machinery is wired — the table still folds by its prop.
    expect(foldable(state, ...lineRange(state, 4))).not.toBeNull();
    // Quotes, callouts (with or without a `-` / `+` suffix), paragraphs, code
    // and math blocks: no fold range at all (change: callout-suffix, design D2).
    const blocks = dialectState(BLOCKS);
    for (const [line, what] of BLOCK_FIRST_LINES) {
      expect(foldable(blocks, ...lineRange(blocks, line)), what).toBeNull();
    }
  });

  it("with the list fold service, foldable() answers exactly listFoldRange()", () => {
    const state = dialectState(DOC, listFoldService);
    const want = listFoldRange(state, state.doc.line(1).from);
    expect(want).not.toBeNull();
    expect(foldable(state, ...lineRange(state, 1))).toEqual(want);
  });

  it("catches each shape of a second fold range", () => {
    const cases: [string, string][] = [
      ["editor/outline.ts", `export const f = ${SERVICE}.of(myListRange);`],
      ["editor/listIndent.ts", `import { ${SERVICE} } from "@codemirror/language";`],
      ["dev/harness/cases.ts", `const s = ${SERVICE}.of(() => null);`],
      ["editor/index.ts", `${NODE_PROP}.add({ ListItem: ${INSIDE} })`],
      ["editor/listIndent.ts", `view.dispatch({ effects: ${EFFECT}.of({ from: a, to: b }) })`],
      ["editor/calloutRender.ts", `export const c = ${SERVICE}.of(myCalloutRange);`],
      ["editor/calloutRender.ts", `view.dispatch({ effects: ${EFFECT}.of(bodyRange(quote)) })`],
    ];
    for (const [path, code] of cases) expect(violations([{ path, code }]), code).toHaveLength(1);
  });

  it("leaves the owners, reads, unfolds, the harness's dispatch and comments alone", () => {
    const cases: [string, string][] = [
      ["editor/listFold.ts", `export const s = ${SERVICE}.of((st, l) => listFoldRange(st, l));`],
      ["editor/headingFold.ts", `export const h = Prec.high(${SERVICE}.of(headingFoldRange));`],
      ["editor/dialectParser.ts", `${NODE_PROP}.add({ ListItem: () => null })`],
      ["editor/headingFold.ts", `effects: this.folded ? unfoldEffect.of(r) : ${EFFECT}.of(r)`],
      ["editor/structure/golden.ts", `return ${EFFECT}.of(range);`],
      ["dev/harness/cases.ts", `if (range) view.dispatch({ effects: ${EFFECT}.of(range) });`],
      ["editor/listIndent.ts", "foldedRanges(state).between(0, 1, () => {});"],
      ["editor/listIndent.ts", "view.dispatch({ effects: unfoldEffect.of(r) });"],
      ["editor/x.ts", `// ${SERVICE}.of( is the list fold's\nconst x = 1;`],
    ];
    for (const [path, code] of cases) expect(violations([{ path, code }]), `${path}: ${code}`).toEqual([]);
  });
});
