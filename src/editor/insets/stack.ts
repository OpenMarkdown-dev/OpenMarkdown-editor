import type { EditorState, Line } from "@codemirror/state";
import { treeUpTo } from "../syntax";
import type { SyntaxNode } from "@lezer/common";
import { linePrefix, type ContainerMark } from "../structure/prefix";
import { parseCallout, type CalloutSuffix, type CalloutType } from "../callout";
import { BULLET_CHARS, itemCheckbox, listBox, type Len } from "./metrics";
import type { Layer } from "./compose";

/**
 * A line's container stack, read from the syntax tree (change: editor-insets).
 *
 * The containers come from `linePrefix` (`structure/prefix.ts`) — the same
 * reading the structure keys use to write `> `, list markers and continuation
 * indentation. So "which containers is this line in, and where is each one's
 * markup written" has one answer for typing and for rendering: a line the
 * keys treat as inside a quote is a line the renderer draws a bar on.
 *
 * This module only ANNOTATES that reading with what rendering needs and the
 * structure keys do not: whether a quote is a callout (and its type), how many
 * the marker box of each list, whether an item is a
 * task, and whether the line is code. Geometry is not decided here — see
 * `compose.ts`.
 */

export interface LineContainers {
  /** Outermost first; the input to `composeInset`. */
  layers: Layer[];
  /** True when a list item owns the line. */
  list: boolean;
  /** True when the line carries a list marker. */
  markerLine: boolean;
  /**
   * List-container indentation written on this line — the leading spaces before
   * a marker, the continuation indent up to the item's content column — and the
   * spaces between a marker and its content. Rendered at zero width: the inset
   * comes from the composer, never from the width of source spaces.
   */
  lead: Array<[number, number]>;
  gap: Array<[number, number]>;
}

/** Per-pass memo: callout type per quote, marker box per list. */
export interface StackCache {
  callout: Map<number, CalloutType | null>;
  listBox: Map<number, Len>;
}

export const newStackCache = (): StackCache => ({ callout: new Map(), listBox: new Map() });

/**
 * A callout's type, its written suffix, where its `[!TYPE]` text starts (`from`) and
 * where the marker — suffix included — ends (`markerTo`), or null for a plain
 * quote. The one reading of a callout: rendering, insets and plain copy all
 * ask here. The suffix is part of the marker; nothing folds on it.
 */
export function calloutOf(
  state: EditorState,
  quote: SyntaxNode,
): { type: CalloutType; suffix: CalloutSuffix; from: number; markerTo: number } | null {
  const first = state.doc.lineAt(quote.from);
  const mark = linePrefix(state, first.from).marks.find((m) => m.kind === "quote" && m.node.from === quote.from);
  if (!mark || !mark.present) return null;
  const text = state.sliceDoc(mark.to, first.to);
  const parsed = parseCallout(text);
  if (!parsed) return null;
  const from = mark.to + text.indexOf("[!");
  const close = text.indexOf("]", from - mark.to);
  return { ...parsed, from, markerTo: mark.to + close + 1 + (parsed.suffix ? 1 : 0) };
}

function calloutType(state: EditorState, quote: SyntaxNode, cache: StackCache): CalloutType | null {
  let t = cache.callout.get(quote.from);
  if (t === undefined) {
    t = calloutOf(state, quote)?.type ?? null;
    cache.callout.set(quote.from, t);
  }
  return t;
}

/**
 * The marker box of the list `item` is in, read once per list. A bullet renders
 * as one glyph; an ordered list is sized for its WIDEST marker, so `9.` and `10.`
 * share a content column and `100.` never overflows its box; and a list with any
 * task item is sized for the checkbox (`listBox`, metrics.ts — the rule).
 */
function itemListBox(item: SyntaxNode, cache: StackCache): Len {
  const list = item.parent;
  if (!list) return listBox({ ordered: false, chars: BULLET_CHARS, task: isTask(item) });
  let box = cache.listBox.get(list.from);
  if (box === undefined) {
    const ordered = list.name === "OrderedList";
    let chars = ordered ? 1 : BULLET_CHARS;
    let task = false;
    for (let c = list.firstChild; c; c = c.nextSibling) {
      if (c.name !== "ListItem") continue;
      if (isTask(c)) task = true;
      const m = ordered ? c.getChild("ListMark") : null;
      if (m) chars = Math.max(chars, m.to - m.from);
    }
    box = listBox({ ordered, chars, task });
    cache.listBox.set(list.from, box);
  }
  return box;
}

const isTask = (item: SyntaxNode) => !!item.getChild("Task");

/** Whether the text at `pos` is code inside the innermost container (or at top level). */
function inFencedCode(state: EditorState, pos: number, inner: SyntaxNode | null): SyntaxNode | null {
  for (let n: SyntaxNode | null = treeUpTo(state, pos).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "FencedCode") return n;
    if (inner && n.from <= inner.from) return null;
    if (n.name === "Blockquote" || n.name === "ListItem") return null;
  }
  return null;
}

function layersOf(state: EditorState, marks: ContainerMark[], cache: StackCache, asMarker: boolean): Layer[] {
  return marks.map((m): Layer => {
    if (m.kind === "quote") {
      const type = calloutType(state, m.node, cache);
      return type ? { kind: "callout", type } : { kind: "quote" };
    }
    return {
      kind: "list",
      box: itemListBox(m.node, cache),
      markerLine: asMarker && m.markerLine,
      checkbox: itemCheckbox(isTask(m.node)),
    };
  });
}

/** The container stack of `line`, or null when the line is in no container. */
export function lineContainers(state: EditorState, line: Line, cache: StackCache): LineContainers | null {
  const p = linePrefix(state, line.from);
  if (!p.marks.length) {
    // A blank line has no prefix of its own (`linePrefix` reads none), but a
    // blank line INSIDE a fenced code block still belongs to every container
    // the block is in — its fill must not jump back to column 0. It takes the
    // block's stack, read from the fence line.
    const code = /\S/.test(line.text) ? inFencedCode(state, line.from, null) : blankInCode(state, line);
    if (!code) return null;
    const fence = linePrefix(state, code.from);
    return {
      layers: [...layersOf(state, fence.marks, cache, false), { kind: "code" }],
      list: fence.marks.some((m) => m.kind === "list"),
      markerLine: false,
      lead: [],
      gap: [],
    };
  }
  const lead: Array<[number, number]> = [];
  const gap: Array<[number, number]> = [];
  for (const m of p.marks) {
    if (m.kind !== "list" || !m.present) continue;
    const mark = m.markerLine ? m.node.getChild("ListMark") : null;
    if (mark) {
      if (mark.from > m.from) push(lead, m.from, mark.from);
      if (m.to > mark.to) gap.push([mark.to, m.to]);
    } else if (m.to > m.from) {
      push(lead, m.from, m.to);
    }
  }
  const layers = layersOf(state, p.marks, cache, true);
  const inner = p.marks[p.marks.length - 1].node;
  if (inFencedCode(state, p.end, inner)) layers.push({ kind: "code" });
  return {
    layers,
    list: p.marks.some((m) => m.kind === "list"),
    markerLine: p.marks.some((m) => m.kind === "list" && m.markerLine),
    lead,
    gap,
  };
}

/** Append a range, merging it into the previous one when they touch. */
function push(out: Array<[number, number]>, from: number, to: number): void {
  const prev = out[out.length - 1];
  if (prev && prev[1] === from) prev[1] = to;
  else out.push([from, to]);
}

function blankInCode(state: EditorState, line: Line): SyntaxNode | null {
  for (let n: SyntaxNode | null = treeUpTo(state, line.from).resolveInner(line.from, 1); n; n = n.parent) {
    if (n.name === "FencedCode") return state.doc.lineAt(n.from).number < line.number ? n : null;
  }
  return null;
}
