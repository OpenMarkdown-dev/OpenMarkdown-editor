import { EditorState, type Extension, type Line, type Text, type Transaction, type TransactionSpec } from "@codemirror/state";
import { treeUpTo } from "./syntax";

/**
 * N8 (spec: editor-fidelity / 编辑不改变未触及行的结构 + 规整登记表 N8): a line
 * the user did not edit keeps its structure. GFM continues a table through every
 * following non-blank line and a paragraph absorbs the lines after it, so typing
 * on the ONLY blank line between two top-level blocks would pull the block below
 * into the one above. When user input (typing, paste, drop, IME commit) turns
 * such a lone separator into text, the same transaction also inserts one line
 * break after the edited line: the block below stays separated, and the keystroke
 * and the break are one undo step. The edited line itself keeps its GFM meaning
 * (under a table it is the table's new row; caret-rules R2c then opens its cell).
 *
 * Only for a separator directly in the document node (start state's tree):
 * blank lines inside fenced code, front matter, HTML blocks, lists and quotes
 * are content or part of their container. Never for undo / redo, agent / remote
 * edits, `setDoc` or structure keys — none of them carries these user events.
 */

/** The user events this rule answers (`input.type` covers `input.type.compose`). */
const USER_INPUT = ["input.type", "input.paste", "input.drop"] as const;

const isBlank = (line: Line) => /^[ \t]*$/.test(line.text);

/** The lone top-level separator line of `state` at line number `n`, or null. */
function loneSeparator(state: EditorState, doc: Text, n: number): Line | null {
  if (n <= 1 || n >= doc.lines) return null;
  const line = doc.line(n);
  if (!isBlank(line) || isBlank(doc.line(n - 1)) || isBlank(doc.line(n + 1))) return null;
  // Complete through the block around the line (and so the block after it): no guessing.
  const tree = treeUpTo(state, line.from);
  for (const side of [-1, 1] as const) {
    const pos = side < 0 ? line.from : line.to;
    if (tree.resolveInner(pos, side).name !== "Document") return null;
  }
  return line;
}

/**
 * The line break N8 adds for `tr`, as a change in `tr`'s START document, or
 * null when the rule does not apply. Pure: reads the transaction only.
 */
export function separatorBreak(tr: Transaction): { from: number; insert: string } | null {
  if (!tr.docChanged || !USER_INPUT.some((e) => tr.isUserEvent(e))) return null;
  const ranges: { fromA: number; toA: number; toB: number }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, toB) => ranges.push({ fromA, toA, toB }));
  if (ranges.length !== 1) return null;
  const { fromA, toA, toB } = ranges[0];
  const start = tr.startState;
  const at = start.doc.lineAt(fromA);
  if (start.doc.lineAt(toA).number !== at.number) return null; // touches more than one line
  const sep = loneSeparator(start, start.doc, at.number);
  if (!sep) return null;
  // In the result: the edited line is text and the old "below" line follows it directly.
  const doc = tr.newDoc;
  const edited = doc.lineAt(toB);
  if (isBlank(edited)) return null;
  const below = doc.lineAt(tr.changes.mapPos(sep.to + 1, 1));
  if (below.number !== edited.number + 1) return null;
  // The buffer's own break; the file's style (LF / CRLF) is restored on save.
  return { from: sep.to, insert: start.lineBreak };
}

/** The N8 filter, installed once in the editor (`base.ts`). */
export const separatorKeepsBlocks: Extension = EditorState.transactionFilter.of((tr) => {
  const add = separatorBreak(tr);
  if (!add) return tr;
  const spec: TransactionSpec = { changes: add };
  return [tr, spec];
});
