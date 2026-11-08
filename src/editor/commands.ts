import { EditorSelection, EditorState, type ChangeSpec, type TransactionSpec } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { treeUpTo } from "./syntax";
import type { SyntaxNode } from "@lezer/common";

/**
 * The four inline formats the toggle commands know, each with the marker it
 * WRITES and the syntax nodes by which an existing one is RECOGNISED — in any
 * spelling (`__` / `**`, `_` / `*`, any backtick run).
 */
const INLINE_KINDS = {
  bold: { marker: "**", node: "StrongEmphasis", mark: "EmphasisMark" },
  italic: { marker: "*", node: "Emphasis", mark: "EmphasisMark" },
  strike: { marker: "~~", node: "Strikethrough", mark: "StrikethroughMark" },
  code: { marker: "`", node: "InlineCode", mark: "CodeMark" },
} as const;

export type InlineKind = keyof typeof INLINE_KINDS;

/**
 * The innermost `kind` node holding the range: a cursor must sit strictly
 * inside it (right after the closing marks is outside), a selection may cover
 * it marks and all.
 */
function enclosing(state: EditorState, from: number, to: number, name: string): SyntaxNode | null {
  const tree = treeUpTo(state, to);
  for (let n: SyntaxNode | null = tree.resolveInner(from, 1); n; n = n.parent) {
    if (n.name !== name) continue;
    if (from === to ? n.from < from && from < n.to : n.from <= from && to <= n.to) return n;
  }
  return null;
}

/**
 * The one answer to "is this already bold / italic / struck / code?" for the
 * four toggle commands (spec: live-preview-editor / 行内标记切换按语法树去掉原有标记;
 * change: strike-marks). Per range:
 *
 * 1. inside an existing node of the kind → remove THAT node's own two marks,
 *    whatever their spelling, and map the selection with the text;
 * 2. else an empty selection squeezed between an empty pair of exactly this
 *    marker (`**‸**`, the state one press leaves) → remove the pair. The tree
 *    has no node for an empty emphasis, so this is the one case it cannot answer;
 * 3. else wrap the range in the canonical marker (empty: insert a pair, cursor
 *    inside).
 *
 * Pure (state in, transaction spec out) so it is testable in node; the
 * commands below only dispatch it.
 */
export function inlineToggle(state: EditorState, kind: InlineKind): TransactionSpec {
  const { marker, node, mark } = INLINE_KINDS[kind];
  const len = marker.length;
  const ch = marker[0];
  const spec = state.changeByRange((range) => {
    const { from, to } = range;

    const hit = enclosing(state, from, to, node);
    const open = hit?.firstChild;
    const close = hit?.lastChild;
    if (hit && open && close && open !== close && open.name === mark && close.name === mark) {
      const changes = state.changes([
        { from: open.from, to: open.to },
        { from: close.from, to: close.to },
      ]);
      return { changes, range: range.map(changes) };
    }

    if (
      from === to &&
      state.sliceDoc(from - len, from) === marker &&
      state.sliceDoc(to, to + len) === marker &&
      state.sliceDoc(from - len - 1, from - len) !== ch &&
      state.sliceDoc(to + len, to + len + 1) !== ch
    ) {
      return {
        changes: [
          { from: from - len, to: from },
          { from: to, to: to + len },
        ],
        range: EditorSelection.cursor(from - len),
      };
    }

    const changes: ChangeSpec[] = [
      { from, insert: marker },
      { from: to, insert: marker },
    ];
    return { changes, range: EditorSelection.range(from + len, to + len) };
  });
  return { ...spec, scrollIntoView: true, userEvent: "input" };
}

function toggleInline(kind: InlineKind): Command {
  return (view) => {
    if (view.state.readOnly) return false;
    view.dispatch(inlineToggle(view.state, kind));
    return true;
  };
}

export const toggleBold = toggleInline("bold");
export const toggleItalic = toggleInline("italic");
export const toggleStrikethrough = toggleInline("strike");
export const toggleInlineCode = toggleInline("code");

// Bound as the registry commands `edit.bold` / `edit.italic` /
// `edit.strikethrough` / `edit.inlineCode` (src/lib/appCommands.ts), whose
// `keys` the editor keymap dispatches (spec: command-registry / 一张快捷键表).

/** Fence opener: up to 3 leading spaces + a run of ≥3 backticks or tildes. */
const FENCE_OPENER = /^( {0,3})(`{3,}|~{3,})/;

/** Container nodes whose prefix (`> `, list indent) a closing fence would need
 * to reproduce — out of scope for v1, so we fall through inside them (design D3). */
const FENCE_CONTAINERS = new Set(["Blockquote", "ListItem", "BulletList", "OrderedList"]);

/**
 * Compute the transaction that auto-closes an unclosed code fence when Enter is
 * pressed at the end of its opener line (design D1–D5). Returns `null` (→ fall
 * through to the default Enter behavior) in every case that must NOT trigger:
 * multi/non-empty selection, cursor not at line end, line not a fence opener,
 * fence already closed, opener line inside a blockquote/list container, or the
 * syntax tree not confirming a same-line unclosed `FencedCode` opener.
 *
 * Kept pure (state → spec) so it is unit-testable without a DOM-backed
 * `EditorView`; the structure entry (`structure/index.ts`) runs it on Enter.
 */
export function fenceCloseChange(state: EditorState): TransactionSpec | null {
  if (state.readOnly) return null;

  // Single collapsed selection only (spec: 非单选区 MUST NOT 触发).
  if (state.selection.ranges.length !== 1) return null;
  const range = state.selection.main;
  if (!range.empty) return null;

  const pos = range.head;
  const line = state.doc.lineAt(pos);
  // Cursor must be at end of line (spec: 行中回车不触发).
  if (pos !== line.to) return null;

  // Cheap pre-filter: is this line shaped like a fence opener?
  const m = FENCE_OPENER.exec(line.text);
  if (!m) return null;
  const indent = m[1];
  const fence = m[2];

  // Authoritative confirmation via the lezer markdown tree (design D2), complete
  // through the fence's block: an unclosed fence runs to the end of the
  // document, so "is it closed" is always answered, never guessed from a
  // partial parse (change: syntax-access).
  const tree = treeUpTo(state, pos);
  let fenced: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (fenced && fenced.name !== "FencedCode") fenced = fenced.parent;
  if (!fenced) return null;

  // Inside a container prefix → fall through (design D3).
  for (let a = fenced.parent; a; a = a.parent) {
    if (FENCE_CONTAINERS.has(a.name)) return null;
  }

  // Exactly one CodeMark = an unclosed fence (a closed one has opener + closer).
  const marks = fenced.getChildren("CodeMark");
  if (marks.length !== 1) return null;

  // The opener must live on the cursor's line; otherwise this line is just fence
  // content of an enclosing unclosed block (spec: 未闭合块内的新 fence 行不误触发).
  const opener = marks[0];
  if (state.doc.lineAt(opener.from).number !== line.number) return null;

  // Insert a blank line + a matching closing fence, cursor on the blank line
  // (design D4). One transaction ⇒ one undo (design D5).
  const nl = state.lineBreak;
  const insert = nl + nl + indent + fence;
  return {
    changes: { from: pos, insert },
    selection: EditorSelection.cursor(pos + nl.length),
    scrollIntoView: true,
    userEvent: "input",
  };
}
