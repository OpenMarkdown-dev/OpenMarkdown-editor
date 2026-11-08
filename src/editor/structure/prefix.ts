import { EditorSelection, type EditorState, type Line, type TransactionSpec } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { treeUpTo } from "../syntax";
import { columnOf, contentColumn } from "./columns";

/**
 * The container prefix of a line (change: quote-keys; design D1): which quotes
 * and list items the line sits in, outermost first, and where each one's
 * markup is written on it — `> `, a list marker with its space, or the
 * indentation that keeps a continuation line inside an item. Read once from
 * the syntax tree; every structure key that writes a new line (or measures a
 * list's indentation) goes through here, so `> - ` and `- > ` and `> > ` are
 * all the same rule.
 */

export interface ContainerMark {
  kind: "quote" | "list";
  /** The Blockquote or ListItem node. */
  node: SyntaxNode;
  /** Doc range of this container's markup on the line (empty when not written). */
  from: number;
  to: number;
  /** False on a lazy line, where the container continues without its markup. */
  present: boolean;
  /** True on a list item's own first line (its marker is here). */
  markerLine: boolean;
}

export interface LinePrefix {
  line: Line;
  /** Outermost first. Empty on a blank line or outside every container. */
  marks: ContainerMark[];
  /** Doc offset where the line's content starts, after every written mark. */
  end: number;
}

const QUOTE_MARK = /^ {0,3}>( ?)/;
const isSpace = (c: string | undefined) => c === " " || c === "\t";

/** Column where a ListItem's content starts, read from its marker line. */
export function itemContentCol(state: EditorState, item: SyntaxNode): number {
  const mark = item.getChild("ListMark");
  if (!mark) return 0;
  const line = state.doc.lineAt(mark.from);
  return contentColumn(line.text, mark.to - line.from);
}

/** The Blockquote / ListItem nodes the line lies in, outermost first. */
function containersOf(state: EditorState, line: Line): SyntaxNode[] {
  const trimmed = line.text.replace(/\s+$/, "").length;
  if (trimmed === 0) return [];
  const lead = /^\s*/.exec(line.text)![0].length;
  const tree = treeUpTo(state, line.to);
  const found = new Map<string, SyntaxNode>();
  // The line's last character sits in its innermost block; the first non-blank
  // one catches a container that only the line start is in.
  for (const start of [tree.resolveInner(line.from + trimmed, -1), tree.resolveInner(line.from + lead, 1)]) {
    for (let n: SyntaxNode | null = start; n; n = n.parent) {
      if (n.name !== "Blockquote" && n.name !== "ListItem") continue;
      // It must hold this line: start on or before it and reach its content.
      if (n.from <= line.to && n.to >= line.from + trimmed) found.set(`${n.from}:${n.name}`, n);
    }
  }
  return [...found.values()].sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
}

/** The container prefix of the line at `pos`. */
export function linePrefix(state: EditorState, pos: number): LinePrefix {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  const marks: ContainerMark[] = [];
  let at = 0;
  let lazy = false;
  for (const node of containersOf(state, line)) {
    const kind = node.name === "Blockquote" ? "quote" : "list";
    const listMark = kind === "list" ? node.getChild("ListMark") : null;
    const markerLine = !!listMark && listMark.from >= line.from && listMark.to <= line.to;
    // An item can end on a following line's quote mark (`> - a` then `> `):
    // ending before this line's content means it doesn't hold the line.
    if (kind === "list" && !markerLine && node.to <= line.from + at) continue;
    const start = at;
    if (!lazy && kind === "quote") {
      const m = QUOTE_MARK.exec(text.slice(at));
      if (m) at += m[0].length;
      else lazy = true;
    } else if (!lazy && kind === "list") {
      const content = itemContentCol(state, node);
      let i = at;
      if (markerLine) {
        const before = text.slice(at, listMark!.from - line.from);
        if (/\S/.test(before)) lazy = true;
        else i = listMark!.to - line.from;
      }
      if (!lazy) {
        while (i < text.length && isSpace(text[i]) && columnOf(text.slice(0, i)) < content) i++;
        // A continuation line indented short of the content column is lazy.
        if (!markerLine && columnOf(text.slice(0, i)) < content && i < text.length) lazy = true;
        else at = i;
      }
    }
    marks.push({
      kind,
      node,
      from: line.from + start,
      to: line.from + (lazy ? start : at),
      present: !lazy,
      markerLine,
    });
  }
  return { line, marks, end: line.from + at };
}

/**
 * The text that starts a new line inside the first `depth` containers of
 * `prefix` (all of them by default): quote marks are copied, list markers
 * become spaces, so the new line continues each container without opening a
 * new item. A container whose markup this line leaves out is written fresh.
 */
export function continuation(state: EditorState, prefix: LinePrefix, depth = prefix.marks.length): string {
  let out = "";
  for (const mark of prefix.marks.slice(0, depth)) {
    if (mark.present) {
      const seg = state.sliceDoc(mark.from, mark.to);
      if (mark.kind === "quote") out += /[ \t]$/.test(seg) ? seg : seg + " ";
      else out += mark.markerLine ? seg.replace(/\S/g, " ") : seg;
    } else if (mark.kind === "quote") {
      out += "> ";
    } else {
      const content = itemContentCol(state, mark.node);
      while (columnOf(out) < content) out += " ";
    }
  }
  return out;
}

/** The innermost container of the line, or null. */
export function innermost(prefix: LinePrefix): ContainerMark | null {
  return prefix.marks.length ? prefix.marks[prefix.marks.length - 1] : null;
}

function cursorSpec(changes: { from: number; to?: number; insert?: string }, caret: number): TransactionSpec {
  return { changes, selection: EditorSelection.cursor(caret), scrollIntoView: true, userEvent: "input" };
}

/**
 * Enter that opens a new line inside every container of the caret's line:
 * `> ` stays `> `, a list item's marker becomes its indentation (design D2).
 * With `keepIndent`, the content's own leading whitespace is carried over too
 * (code inside a container). Null outside containers, with several ranges, or
 * with the caret inside the prefix itself.
 */
export function containerNewline(state: EditorState, keepIndent: boolean): TransactionSpec | null {
  if (state.selection.ranges.length !== 1) return null;
  const { from, to } = state.selection.main;
  const p = linePrefix(state, from);
  if (!p.marks.length || from < p.end || to > p.line.to) return null;
  let insert = state.lineBreak + continuation(state, p);
  if (keepIndent) insert += /^[ \t]*/.exec(state.sliceDoc(p.end, from))![0];
  return cursorSpec({ from, to, insert }, from + insert.length);
}

/**
 * Enter on an empty quote line (only quote marks, caret after them): drop the
 * innermost `>` — one Enter leaves a quote, or steps out of one level of a
 * nested quote, keeping whatever containers are outside it (design D3).
 */
export function quoteExitChange(state: EditorState): TransactionSpec | null {
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
  const head = state.selection.main.head;
  const p = linePrefix(state, head);
  const inner = innermost(p);
  if (!inner || inner.kind !== "quote" || !inner.present) return null;
  if (/\S/.test(state.sliceDoc(p.end, p.line.to))) return null;
  const gt = inner.from + state.sliceDoc(inner.from, inner.to).indexOf(">");
  if (head <= gt) return null;
  return cursorSpec({ from: inner.from, to: p.line.to }, inner.from);
}
