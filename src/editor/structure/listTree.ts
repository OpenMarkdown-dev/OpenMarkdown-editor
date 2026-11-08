import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { columnOf, contentColumn } from "./columns";
import { continuation as continuationOf, linePrefix } from "./prefix";
import { treeUpTo } from "../syntax";

/**
 * The list tree (design D8): one read of the syntax tree that every list
 * operation shares — which item is whose parent, how deep it is, where its
 * content starts, and how the list writes its indentation. Built fresh from the
 * syntax tree on each call (never cached, so it can't drift from the document).
 *
 * A "layer" is the items directly under one parent (or the top level). Adjacent
 * lists of different marker types — `- a` followed directly by `1. b` — are two
 * lists to CommonMark but one layer here: Obsidian treats them as siblings, and
 * so do Tab and folding (user's decision, 2026-10-21).
 *
 * A list inside a quote (or a quote inside an item) is a tree of its own: its
 * scope stops at the nearest enclosing quote, and every line carries that
 * quote's container prefix (`structure/prefix.ts`) in front of its lead.
 * Columns are always absolute — measured with the prefix in front — because
 * CommonMark's tab stops are (change: quote-keys).
 */

export interface ListItemNode {
  /** The ListItem node's range. */
  from: number;
  to: number;
  /** The item's first line (where its marker is). */
  lineFrom: number;
  lineNumber: number;
  /** Where `lead` starts: after the container prefix (the line start outside containers). */
  leadFrom: number;
  /** The whitespace between the container prefix and the marker, as written. */
  lead: string;
  markFrom: number;
  markTo: number;
  /** `-` / `*` / `+` / `1.` / `10)` … */
  markText: string;
  ordered: boolean;
  /** Parsed number of an ordered marker, else null. */
  number: number | null;
  task: boolean;
  /** Column where the item's content starts (CommonMark, tab stop 4). */
  contentCol: number;
  /** True when the marker line has nothing after the marker (task box excluded). */
  emptyLine: boolean;
  depth: number;
  /** Columns this item's lead is past its parent's, as written (0 at the top). */
  step: number;
  parent: ListItemNode | null;
  children: ListItemNode[];
}

export type IndentStyle = "tab" | "space";

export interface ListTree {
  /** Range covered by the layer's lists, first marker to last item end. */
  from: number;
  to: number;
  /** Top-level items, in document order. */
  roots: ListItemNode[];
  /** Every item, in document order. */
  items: ListItemNode[];
  /** How nested lines are indented: by the first nested line; `tab` if none. */
  style: IndentStyle;
  /** The container prefix in front of every line, as a new line would write it (`""`, `> `, `  > ` …). */
  prefix: string;
  /** How many containers that prefix is (they enclose the whole list). */
  outerDepth: number;
  /** Absolute column of a lead written after the prefix. */
  col: (lead: string) => number;
}

const LIST = new Set(["BulletList", "OrderedList"]);

/** Lists that sit next to `list` with no blank line between them, in order. */
function adjacentLists(state: EditorState, list: SyntaxNode): SyntaxNode[] {
  const touching = (a: SyntaxNode, b: SyntaxNode) => !/\n[ \t]*\n/.test(state.sliceDoc(a.to, b.from));
  let first = list;
  for (let p = first.prevSibling; p && LIST.has(p.name) && touching(p, first); p = p.prevSibling) first = p;
  const out = [first];
  for (let n = first.nextSibling; n && LIST.has(n.name) && touching(out[out.length - 1], n); n = n.nextSibling) out.push(n);
  return out;
}

function itemNode(
  state: EditorState,
  item: SyntaxNode,
  parent: ListItemNode | null,
  depth: number,
  scope: Scope,
): ListItemNode | null {
  const mark = item.getChild("ListMark");
  if (!mark) return null;
  const line = state.doc.lineAt(mark.from);
  const leadFrom = prefixEnd(state, line.from, scope.outerDepth);
  if (leadFrom === null || leadFrom > mark.from) return null;
  const lead = state.sliceDoc(leadFrom, mark.from);
  if (/[^ \t]/.test(lead)) return null; // markup we can't place: leave the list alone
  const markText = state.sliceDoc(mark.from, mark.to);
  const ordered = item.parent?.name === "OrderedList";
  const task = item.getChild("Task");
  const rest = state.sliceDoc(mark.to, line.to).replace(/^[ \t]*/, "");
  const contentCol = contentColumn(line.text, mark.to - line.from);
  return {
    from: item.from,
    to: item.to,
    lineFrom: line.from,
    lineNumber: line.number,
    leadFrom,
    lead,
    markFrom: mark.from,
    markTo: mark.to,
    markText,
    ordered,
    number: ordered ? parseInt(markText, 10) : null,
    task: !!task,
    contentCol,
    emptyLine: rest.length === 0 || (!!task && /^\[.\]\s*$/.test(rest)),
    depth,
    step: parent ? scope.col(lead) - scope.col(parent.lead) : 0,
    parent,
    children: [],
  };
}

/** What every line of one list tree shares: the containers around it. */
interface Scope {
  prefix: string;
  outerDepth: number;
  col: (lead: string) => number;
}

/**
 * Where the lead starts on the line at `lineFrom`: after its first
 * `outerDepth` container marks. Null when one of them is not written there
 * (a lazy line), so its indentation can't be read or rewritten.
 */
export function prefixEnd(state: EditorState, lineFrom: number, outerDepth: number): number | null {
  if (outerDepth === 0) return lineFrom;
  const p = linePrefix(state, lineFrom);
  const outer = p.marks.slice(0, outerDepth);
  if (outer.length < outerDepth || outer.some((m) => !m.present)) return null;
  return outer[outer.length - 1].to;
}

function collect(
  state: EditorState,
  lists: SyntaxNode[],
  parent: ListItemNode | null,
  depth: number,
  all: ListItemNode[],
  scope: Scope,
): ListItemNode[] | null {
  const layer: ListItemNode[] = [];
  for (const list of lists) {
    for (let item = list.firstChild; item; item = item.nextSibling) {
      if (item.name !== "ListItem") continue;
      const node = itemNode(state, item, parent, depth, scope);
      if (!node) return null;
      layer.push(node);
      all.push(node);
      const childLists: SyntaxNode[] = [];
      for (let c = item.firstChild; c; c = c.nextSibling) if (LIST.has(c.name)) childLists.push(c);
      const children = collect(state, childLists, node, depth + 1, all, scope);
      if (!children) return null;
      node.children = children;
    }
  }
  return layer;
}

/** The outermost list containing `node` inside its nearest quote, or null. */
function outermostList(node: SyntaxNode): SyntaxNode | null {
  let outer: SyntaxNode | null = null;
  for (let p: SyntaxNode | null = node; p && p.name !== "Blockquote"; p = p.parent) if (LIST.has(p.name)) outer = p;
  return outer;
}

/**
 * The tree of the top-level layer that `item` (a ListItem node) belongs to —
 * within the nearest enclosing quote — or null when a line's prefix can't be
 * read.
 */
export function listTreeOf(state: EditorState, item: SyntaxNode): ListTree | null {
  const outer = outermostList(item);
  if (!outer) return null;
  const lists = adjacentLists(state, outer);
  // The containers around the list are the ones its first line has before the list's own.
  const first = linePrefix(state, lists[0].from);
  const outerDepth = first.marks.findIndex((m) => m.node.from >= lists[0].from);
  const depthOut = outerDepth < 0 ? first.marks.length : outerDepth;
  const prefix = continuationOf(state, first, depthOut);
  const col = (lead: string) => columnOf(prefix + lead);
  const scope: Scope = { prefix, outerDepth: depthOut, col };
  const items: ListItemNode[] = [];
  const roots = collect(state, lists, null, 0, items, scope);
  if (!roots || roots.length === 0) return null;
  const nested = items.find((i) => i.depth > 0);
  return {
    from: lists[0].from,
    to: lists[lists.length - 1].to,
    roots,
    items,
    style: nested && !nested.lead.includes("\t") ? "space" : "tab",
    prefix,
    outerDepth: depthOut,
    col,
  };
}

/**
 * The innermost ListItem owning the line at `pos`, read from the line's
 * container prefix (so every column of a line, line start included, gives the
 * same item, and a `>` in front doesn't hide it). Null on a blank line,
 * outside a list, or inside a code block that sits in an item — there the key
 * belongs to the code.
 */
export function listItemAtLine(state: EditorState, pos: number): SyntaxNode | null {
  const p = linePrefix(state, pos);
  const lists = p.marks.filter((m) => m.kind === "list");
  if (!lists.length) return null;
  const item = lists[lists.length - 1].node;
  const content = p.end + /^[ \t]*/.exec(state.sliceDoc(p.end, p.line.to))![0].length;
  for (let n: SyntaxNode | null = treeUpTo(state, content).resolveInner(content, 1); n && n.from >= item.from; n = n.parent) {
    if (n.name === "FencedCode" || n.name === "CodeBlock") return null;
    if (n.name === "ListItem") break;
  }
  return item;
}

/** The list tree around the line at `pos`, or null when that line is not in a list. */
export function listTreeAt(state: EditorState, pos: number): ListTree | null {
  const item = listItemAtLine(state, pos);
  return item ? listTreeOf(state, item) : null;
}
