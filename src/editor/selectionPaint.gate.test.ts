import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState, type Extension } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";
import { BLOCKS } from "./blocks/registry";
import { blockDecorationField } from "./blocks/field";
import { dialectBase, dialectExtensions } from "./dialectParser";
import { ensureMath } from "./math";
import { mermaidMarkup } from "./markup";
import { rememberMermaid } from "./mermaid";
import { livePreviewConfig } from "./previewConfig";
import { coveredBySelection, SelectableWidget, withSelectedState } from "./selectionPaint";
import { withCompleteTree } from "./syntax";

/**
 * Gate (spec: live-preview-editor / 选区只有一种画法, block-editing / 块的选中态只
 * 经框架产生; change: selection-paint, design D4). Fails, with the place, on:
 *
 * - S1: a native-selection style (`::selection`) anywhere in the app's source
 *   but the one rule in `editor/theme.ts` (`NATIVE_SELECTION_SELECTORS`);
 * - S2: the shared selected-state marks (the attribute and the host class)
 *   written anywhere but `editor/selectionPaint.ts` — a block drawing its own
 *   "selected";
 * - S3: a registry A / B block without a sample here, or whose sample, rendered
 *   by the real block field, does not carry the shared selected state when the
 *   whole document is selected (or carries it under a caret);
 * - S4: the image widget built other than as `withSelectedState(new ImageWidget(…`.
 *
 * Limits (stated, not hidden): S1, S2, S4 are textual (comments stripped, tests
 * and the browser harness not scanned — the harness reads the marks to measure
 * them). S3 covers the blocks the block field renders, which is every block
 * replacement there is (block gate in `blocks/registry.test.ts`). Whether it
 * LOOKS right is the harness case `selection-paint` and the manual tests.
 */

const SRC = join(__dirname, "..");
const HARNESS = "dev/harness/";
const THEME = "editor/theme.ts";
const PAINT = "editor/selectionPaint.ts";

// Assembled so this file's own source never matches its rules.
const NATIVE = "::" + "selection";
const MARKS = ["data-om-" + "covered", "om-select-" + "host"];
const IMAGE = "new " + "ImageWidget(";

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

interface Source {
  path: string;
  code: string;
}

const lineOf = (code: string, index: number) => code.slice(0, index).split("\n").length;

/** S1: `::selection` outside the one rule in theme.ts. */
export function strayNativeSelection(files: Source[]): string[] {
  const out: string[] = [];
  for (const { path, code } of files) {
    if (path.startsWith(HARNESS)) continue;
    const text = stripComments(code);
    // The one allowed span: the NATIVE_SELECTION_SELECTORS array in theme.ts.
    let allowed: [number, number] | null = null;
    if (path === THEME) {
      const at = text.indexOf("export const NATIVE_SELECTION_SELECTORS = [");
      if (at >= 0) allowed = [at, text.indexOf("] as const;", at)];
    }
    let i = text.indexOf(NATIVE);
    while (i >= 0) {
      if (!allowed || i < allowed[0] || i > allowed[1]) {
        out.push(`${path}:${lineOf(text, i)}: a native-selection style outside the one rule in ${THEME}`);
      }
      i = text.indexOf(NATIVE, i + 1);
    }
  }
  return out;
}

/** S2: the selected-state marks outside selectionPaint.ts. */
export function strayMarks(files: Source[]): string[] {
  const out: string[] = [];
  for (const { path, code } of files) {
    if (path === PAINT || path.startsWith(HARNESS)) continue;
    const text = stripComments(code);
    for (const mark of MARKS) {
      let i = text.indexOf(mark);
      while (i >= 0) {
        out.push(`${path}:${lineOf(text, i)}: "${mark}" is the shared selected state's, set only by ${PAINT}`);
        i = text.indexOf(mark, i + 1);
      }
    }
  }
  return out;
}

/** S4: an image widget not built as the first argument of withSelectedState. */
export function bareImageWidgets(files: Source[]): string[] {
  const out: string[] = [];
  for (const { path, code } of files) {
    const text = stripComments(code);
    let i = text.indexOf(IMAGE);
    while (i >= 0) {
      if (!/withSelectedState\(\s*$/.test(text.slice(0, i))) {
        out.push(`${path}:${lineOf(text, i)}: the image widget must be built inside withSelectedState(`);
      }
      i = text.indexOf(IMAGE, i + 1);
    }
  }
  return out;
}

function sources(): Source[] {
  return listFiles(SRC, { include: /\.(tsx?|css)$/, exclude: /\.test\.tsx?$/ }).map((p) => ({
    path: repoPath(SRC, p),
    code: readFileSync(p, "utf8"),
  }));
}

/**
 * One sample per registry A / B block. A new block MUST add its own here — the
 * gate names the missing id — and then it is checked like the others.
 */
const SAMPLES: Record<string, string> = {
  frontmatter: "---\ntitle: a\nstatus: draft\n---\n",
  "block-math": "$$\nx^2 + y^2\n$$\n",
  table: "| a | b |\n| - | - |\n| 1 | 2 |\n",
  mermaid: "```mermaid\nflowchart LR\n  A --> B\n```\n",
};

/**
 * Async renderers have no result in node (mermaid needs a DOM to measure text):
 * seed their cache with a stand-in, as a finished render would.
 */
function seedAsyncRenders(): void {
  rememberMermaid("flowchart LR\n  A --> B", "light", { kind: "rendered", value: mermaidMarkup('<svg id="om-mermaid-0"></svg>') });
}

/** The editor's dialect, complete tree, A blocks kept rendered (reading mode). */
function readingState(doc: string, extra: Extension = []): EditorState {
  return withCompleteTree(
    EditorState.create({
      doc,
      extensions: [
        markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }),
        livePreviewConfig.of({ revealOnSelection: false, resolveImage: (s: string) => s }),
        blockDecorationField,
        extra,
      ],
    }),
  );
}

/** Each rendered block's id and the widget the field gave it. */
function renderedBlocks(state: EditorState): { id: string; widget: WidgetType }[] {
  const out: { id: string; widget: WidgetType }[] = [];
  state.field(blockDecorationField).blocks.between(0, state.doc.length, (_f, _t, deco) => {
    const spec = deco.spec as { blockId?: string; widget?: WidgetType };
    if (spec.blockId && spec.widget) out.push({ id: spec.blockId, widget: spec.widget });
  });
  return out;
}

/** S3 for one block: the problems, or none. */
export async function blockProblems(id: string): Promise<string[]> {
  const sample = SAMPLES[id];
  if (sample === undefined) return [`\`${id}\`: no sample in selectionPaint.gate.test.ts — add one`];
  // Frontmatter only exists at the very top; every other block sits mid-document.
  const doc = id === "frontmatter" ? `${sample}\npara\n` : `para\n\n${sample}\npara\n`;
  const all = readingState(doc).update({ selection: { anchor: 0, head: doc.length } }).state;
  const caret = readingState(doc).update({ selection: { anchor: doc.length } }).state;
  const problems: string[] = [];
  const covered = renderedBlocks(all).filter((b) => b.id === id);
  if (covered.length !== 1) return [`\`${id}\`: its sample rendered ${covered.length} blocks, expected 1`];
  const w = covered[0].widget;
  if (!(w instanceof SelectableWidget)) problems.push(`\`${id}\`: rendered without the shared selected state`);
  else if (!w.covered) problems.push(`\`${id}\`: not selected under a whole-document selection`);
  const atCaret = renderedBlocks(caret).find((b) => b.id === id)?.widget;
  if (atCaret instanceof SelectableWidget && atCaret.covered) problems.push(`\`${id}\`: selected under a caret`);
  return problems;
}

class Probe extends WidgetType {
  toDOM(): HTMLElement {
    throw new Error("not built in node");
  }
}

describe("selection-paint gate", () => {
  it("S1: no native-selection style outside the one rule", () => {
    const files = sources();
    expect(files.some((f) => f.path === THEME)).toBe(true);
    expect(strayNativeSelection(files)).toEqual([]);
    // Control: the one rule is there and is seen.
    const theme = files.find((f) => f.path === THEME)!;
    expect(theme.code).toContain("export const NATIVE_SELECTION_SELECTORS = [");
  });

  it("S1 catches a second rule, in TS or CSS, with file:line", () => {
    const css = `.om-props *${NATIVE} { background: transparent; }`;
    const ts = `const t = EditorView.theme({ ".om-table ${NATIVE}": { background: "x" } });`;
    expect(strayNativeSelection([{ path: "index.css", code: `a\n${css}` }])).toEqual([
      `index.css:2: a native-selection style outside the one rule in ${THEME}`,
    ]);
    expect(strayNativeSelection([{ path: "editor/blocks/table.ts", code: ts }])).toHaveLength(1);
    // A second rule in theme.ts but outside the array is caught too.
    const theme = `export const NATIVE_SELECTION_SELECTORS = [\n  "& .cm-content${NATIVE}",\n] as const;\nconst x = { "& td${NATIVE}": {} };`;
    expect(strayNativeSelection([{ path: THEME, code: theme }])).toEqual([
      `${THEME}:4: a native-selection style outside the one rule in ${THEME}`,
    ]);
  });

  it("S2: the selected-state marks live in selectionPaint.ts only", () => {
    expect(strayMarks(sources())).toEqual([]);
  });

  it("S2 catches a block marking itself selected", () => {
    const code = `wrap.setAttribute("${MARKS[0]}", "");\nwrap.className = "${MARKS[1]}";`;
    expect(strayMarks([{ path: "editor/blocks/properties.ts", code }])).toHaveLength(2);
    expect(strayMarks([{ path: PAINT, code }])).toEqual([]);
  });

  it("S3: every registry A / B block carries the shared selected state", async () => {
    await new Promise<void>((resolve) => ensureMath(resolve));
    seedAsyncRenders();
    const problems: string[] = [];
    for (const b of BLOCKS.filter((b) => b.mode !== "C")) problems.push(...(await blockProblems(b.id)));
    expect(problems).toEqual([]);
  });

  it("S3 names a block that has no sample", async () => {
    expect(await blockProblems("flowchart")).toEqual(["`flowchart`: no sample in selectionPaint.gate.test.ts — add one"]);
  });

  it("S4: the image widget is built only inside withSelectedState", () => {
    expect(bareImageWidgets(sources())).toEqual([]);
    expect(bareImageWidgets([{ path: "editor/livePreview.ts", code: `Decoration.replace({ widget: ${IMAGE}src, alt) })` }])).toHaveLength(1);
    expect(bareImageWidgets([{ path: "editor/livePreview.ts", code: `withSelectedState(\n  ${IMAGE}src, alt), c, "inline")` }])).toEqual([]);
  });

  it("covered = a non-empty range containing the whole block; a caret or one edge is not", () => {
    const s = (anchor: number, head?: number) => EditorState.create({ doc: "0123456789", selection: { anchor, head } });
    expect(coveredBySelection(s(0, 10), 2, 5)).toBe(true);
    expect(coveredBySelection(s(2, 5), 2, 5)).toBe(true);
    expect(coveredBySelection(s(5, 2), 2, 5)).toBe(true);
    expect(coveredBySelection(s(3, 10), 2, 5)).toBe(false);
    expect(coveredBySelection(s(0, 4), 2, 5)).toBe(false);
    expect(coveredBySelection(s(5, 9), 2, 5)).toBe(false);
    expect(coveredBySelection(s(3), 2, 5)).toBe(false);
  });

  it("a change of selected state alone is applied in place, never by rebuilding the inner DOM", () => {
    const inner = new Probe();
    let innerUpdates = 0;
    inner.updateDOM = () => {
      innerUpdates++;
      return false;
    };
    const off = withSelectedState(inner, false, "block");
    const on = withSelectedState(inner, true, "block");
    expect(on.eq(off)).toBe(false);
    const host = {
      firstElementChild: {},
      attrs: new Set<string>(),
      setAttribute(n: string) {
        this.attrs.add(n);
      },
      removeAttribute(n: string) {
        this.attrs.delete(n);
      },
    };
    expect(on.updateDOM(host as unknown as HTMLElement, null as never, off)).toBe(true);
    expect(innerUpdates).toBe(0);
    expect(host.attrs.has(MARKS[0])).toBe(true);
    expect(off.updateDOM(host as unknown as HTMLElement, null as never, on)).toBe(true);
    expect(host.attrs.has(MARKS[0])).toBe(false);
    // Same state, same inner: equal (CM keeps the DOM without asking).
    expect(withSelectedState(inner, true, "block").eq(on)).toBe(true);
  });
});
