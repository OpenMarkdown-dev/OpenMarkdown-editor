import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { treeUpTo } from "../syntax";
import { linePrefix } from "./prefix";

/**
 * Enter inside an inline construct means "done editing it" (spec:
 * structure-input / 行内结构里按 Enter 是「改完了」; change: inline-enter-commit).
 *
 * In live mode an image `![alt|300](a.png)`, a link `[text](url)` and inline
 * math `$…$` show their source while the caret is inside them. Splitting one
 * with a newline is never what the writer meant — it breaks the construct — so
 * Enter strictly inside one does not edit the text: it sends the caret to where
 * the next line's content starts, and makes a new empty line when there is
 * none. The construct, left by the caret, renders again. The same holds in
 * source mode, where nothing is concealed: a construct is still never split
 * by Enter (design D2).
 *
 * "Strictly inside" — the caret on either edge (before `!` / `[` / `$`, after
 * `)` / `$`) is outside, and Enter there is the ordinary newline. Only Enter
 * belongs here; every other structure key passes on to the structure around.
 */

/** The syntax nodes this row covers. One list, read by the entry's NODE_STRUCTURE too. */
export const INLINE_NODES = ["Image", "Link", "InlineMath"] as const;

const COVERED = new Set<string>(INLINE_NODES);

/** The innermost covered construct strictly holding `pos`, or null. */
export function inlineConstructAt(state: EditorState, pos: number): SyntaxNode | null {
  for (let n: SyntaxNode | null = treeUpTo(state, pos).resolveInner(pos, -1); n; n = n.parent) {
    if (COVERED.has(n.name) && n.from < pos && pos < n.to) return n;
  }
  return null;
}

/** Enter's plan inside an inline construct, or null when the caret is not strictly in one. */
export function inlineEnterChange(state: EditorState): TransactionSpec | null {
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return null;
  if (!inlineConstructAt(state, sel.head)) return null;
  const line = state.doc.lineAt(sel.head);
  if (line.number < state.doc.lines) {
    const next = state.doc.line(line.number + 1);
    return {
      selection: EditorSelection.cursor(linePrefix(state, next.from).end),
      scrollIntoView: true,
      userEvent: "select",
    };
  }
  return {
    changes: { from: line.to, insert: state.lineBreak },
    selection: EditorSelection.cursor(line.to + state.lineBreak.length),
    scrollIntoView: true,
    userEvent: "input",
  };
}
