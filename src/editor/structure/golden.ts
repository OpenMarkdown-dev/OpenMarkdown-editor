import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { codeFolding, foldEffect, foldedRanges } from "@codemirror/language";
import { withCompleteTree } from "../syntax";
import { markdown } from "@codemirror/lang-markdown";
import { dialectBase, dialectExtensions } from "../dialectParser";
import { STRUCTURE_KEYS, type StructureKey } from "./keys";
import { listFoldRange, listFoldService } from "../listFold";

/**
 * Golden cases for the structure keys (spec: structure-input / 结构键行为以黄金用例锁定;
 * design D5). A fixture file is a list of cases:
 *
 *     ## 引用续行
 *     keys: Enter
 *
 *     ```md
 *     > 一句话‸
 *     ```
 *
 *     ```md
 *     > 一句话
 *     > ‸
 *     ```
 *
 * The first `md` block is the document before the keys, the second the document
 * after. `‸` marks the caret and `«…»` a selection (anchor at `«`, head at `»`) —
 * not `|`, which tables need. An optional `mode: reading` line runs the case on a
 * read-only document; `fold: 1 3` folds the list items starting on those lines
 * before the keys, and `fold-after: 4` lists the lines whose items must be
 * folded afterwards (change: list-fold). A block's opening fence may be longer than three backticks
 * so the document can hold a fence of its own.
 */

export const CARET = "‸";

export interface GoldenCase {
  title: string;
  keys: StructureKey[];
  readOnly: boolean;
  /** 1-based lines whose list items start folded. */
  fold: number[];
  /** When set, the 1-based lines whose items must be folded after the keys. */
  foldAfter: number[] | null;
  before: string;
  after: string;
  /** 1-based line of the `##` heading, for failure messages. */
  line: number;
}

/** `⌘]` / `⌘[` are accepted as spellings of `Mod-]` / `Mod-[`. */
function parseKey(word: string): StructureKey {
  const key = word.replace(/^⌘/, "Mod-");
  if (!(STRUCTURE_KEYS as readonly string[]).includes(key)) throw new Error(`unknown structure key "${word}"`);
  return key as StructureKey;
}

export function parseGolden(source: string): GoldenCase[] {
  const lines = source.split("\n");
  const cases: GoldenCase[] = [];
  let i = 0;
  while (i < lines.length) {
    const heading = /^## (.+)$/.exec(lines[i]);
    if (!heading) {
      i++;
      continue;
    }
    const at = i + 1;
    const c: GoldenCase = {
      title: heading[1].trim(),
      keys: [],
      readOnly: false,
      fold: [],
      foldAfter: null,
      before: "",
      after: "",
      line: at,
    };
    const blocks: string[] = [];
    i++;
    while (i < lines.length && !/^## /.test(lines[i])) {
      const text = lines[i];
      const keys = /^keys:\s*(.+)$/.exec(text);
      const mode = /^mode:\s*(\S+)\s*$/.exec(text);
      const fold = /^fold(-after)?:\s*([\d\s]*)$/.exec(text);
      const open = /^(`{3,})md\s*$/.exec(text);
      if (keys) c.keys = keys[1].trim().split(/\s+/).map(parseKey);
      else if (fold) {
        const lines = fold[2].trim() ? fold[2].trim().split(/\s+/).map(Number) : [];
        if (fold[1]) c.foldAfter = lines;
        else c.fold = lines;
      }
      else if (mode) {
        if (mode[1] !== "reading") throw new Error(`line ${i + 1}: unknown mode "${mode[1]}"`);
        c.readOnly = true;
      } else if (open) {
        const fence = open[1];
        const body: string[] = [];
        i++;
        while (i < lines.length && lines[i] !== fence) body.push(lines[i++]);
        if (i === lines.length) throw new Error(`line ${at}: unclosed ${fence}md block in "${c.title}"`);
        blocks.push(body.join("\n"));
      }
      i++;
    }
    if (c.keys.length === 0) throw new Error(`line ${at}: "${c.title}" has no keys: line`);
    if (blocks.length !== 2) throw new Error(`line ${at}: "${c.title}" needs exactly two md blocks, has ${blocks.length}`);
    [c.before, c.after] = blocks;
    cases.push(c);
  }
  return cases;
}

/** Split the caret / selection markers out of a marked document. */
export function unmark(marked: string): { doc: string; anchor: number; head: number } {
  const caret = marked.indexOf(CARET);
  if (caret >= 0) {
    if (marked.includes("«") || marked.indexOf(CARET, caret + 1) >= 0) throw new Error("use one caret or one «selection»");
    return { doc: marked.slice(0, caret) + marked.slice(caret + 1), anchor: caret, head: caret };
  }
  const open = marked.indexOf("«");
  const close = marked.indexOf("»");
  if (open < 0 || close < open) throw new Error("document needs a ‸ caret or a «selection»");
  const doc = marked.slice(0, open) + marked.slice(open + 1, close) + marked.slice(close + 1);
  return { doc, anchor: open, head: close - 1 };
}

/** The inverse of `unmark`, for comparing a result against its expected text. */
export function mark(state: EditorState): string {
  const { anchor, head } = state.selection.main;
  const doc = state.doc.toString();
  if (anchor === head) return doc.slice(0, head) + CARET + doc.slice(head);
  return doc.slice(0, anchor) + "«" + doc.slice(anchor, head) + "»" + doc.slice(head);
}

/** The body editor's grammar, without its keymap — what the entry runs on. */
export function goldenState(marked: string, readOnly = false, extra: Extension[] = []): EditorState {
  const { doc, anchor, head } = unmark(marked);
  return withCompleteTree(
    EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [
        markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }),
        codeFolding(),
        listFoldService,
        EditorState.readOnly.of(readOnly),
        ...extra,
      ],
    }),
  );
}

/**
 * Rewrite each case's expected block with `actuals[i]` (same order as
 * `parseGolden`). Used by `GOLDEN_UPDATE=1 npx vitest run golden` to record
 * results for review — the diff is then read by a human, never trusted blindly.
 */
export function blessGolden(source: string, actuals: string[]): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let caseIndex = -1;
  let blockInCase = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      caseIndex++;
      blockInCase = 0;
    }
    const open = /^(`{3,})md\s*$/.exec(lines[i]);
    if (!open || caseIndex < 0) {
      out.push(lines[i]);
      continue;
    }
    blockInCase++;
    out.push(lines[i]);
    let j = i + 1;
    while (j < lines.length && lines[j] !== open[1]) j++;
    out.push(...(blockInCase === 2 ? actuals[caseIndex].split("\n") : lines.slice(i + 1, j)));
    out.push(open[1]);
    i = j;
  }
  return out.join("\n");
}

/** Fold the list items that start on the given 1-based lines. */
export function foldLines(state: EditorState, lines: number[]): EditorState {
  const effects = lines.map((n) => {
    const range = listFoldRange(state, state.doc.line(n).from);
    if (!range) throw new Error(`line ${n} has no foldable list item`);
    return foldEffect.of(range);
  });
  return effects.length ? state.update({ effects }).state : state;
}

/** 1-based lines where a fold starts, in order. */
export function foldedLines(state: EditorState): number[] {
  const out: number[] = [];
  foldedRanges(state).between(0, state.doc.length, (from) => {
    out.push(state.doc.lineAt(from).number);
  });
  return out;
}
