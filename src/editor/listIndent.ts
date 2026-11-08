import { EditorSelection, EditorState, type ChangeSpec, type TransactionSpec } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  listItemAtLine,
  listTreeOf,
  prefixEnd,
  type ListItemNode,
  type ListTree,
} from "./structure/listTree";
import { foldedAt, itemFoldRange } from "./listFold";

/**
 * List structure operations: indent, outdent, renumber (spec: live-preview-editor
 * / 列表结构操作:缩进、反缩进与有序序号重排; design D4, D7, D8).
 *
 * Tab / ⌘] nest an item (with its subtree) under its previous sibling,
 * Shift-Tab / ⌘[ move it out one level, and Enter on an empty item does one of
 * those or leaves the list. All of them work on the shared list tree
 * (`structure/listTree.ts`) and follow three rules:
 *
 * - Indentation follows the list's own writing: a tab character per level for a
 *   tab-indented (or not yet nested) list; for a space-indented one, the spaces
 *   its siblings already use, or the parent's own step. Never a fixed width,
 *   never a tab↔space conversion.
 * - Only moved lines change: the moved items and their subtrees, plus the
 *   numbers of the ordered layers they left and joined. Every other byte stays.
 * - Markers keep their type; dash and number may share a layer.
 *
 * A list inside a quote works the same way: leads are the whitespace after the
 * container prefix (`> `), columns are measured with that prefix in front, and
 * the prefix itself is never rewritten (change: quote-keys).
 *
 * Pure (`state → spec`) so it runs in node tests; the structure entry
 * (`structure/index.ts`) binds the keys.
 */

export type ListIndentDir = "more" | "less";

export type ListIndentResult =
  | { kind: "change"; spec: TransactionSpec }
  /** In a list, but structurally nothing to do (first item Tab / top-level Shift-Tab):
   *  take the key without falling through to plain indent. */
  | { kind: "noop" }
  /** Not applicable (not in a list, read-only): fall through. */
  | null;

/**
 * Every ListItem the current selection touches, in document order, deduped.
 *
 * Line-based (see `listItemAtLine`): each selected LINE contributes the item
 * that owns it. A non-empty range whose end sits exactly at a line start does
 * NOT claim that line — matching `indentSelection` and every mainstream editor,
 * so "select down to the next line" does not silently move one item too many.
 */
export function selectionTargets(state: EditorState): SyntaxNode[] {
  const seen = new Set<number>();
  const out: SyntaxNode[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const lastLine = state.doc.lineAt(range.to).number;
    const last =
      !range.empty && range.to === state.doc.line(lastLine).from && lastLine > first ? lastLine - 1 : lastLine;
    for (let ln = first; ln <= last; ln++) {
      const item = listItemAtLine(state, state.doc.line(ln).from);
      if (item && !seen.has(item.from)) {
        seen.add(item.from);
        out.push(item);
      }
    }
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}

/** A tree being rearranged: moves first, then leads and numbers are derived. */
interface Plan {
  tree: ListTree;
  /** Items placed afresh (moved targets, and children that no longer fit). */
  moved: Set<ListItemNode>;
  /** Items that became children of an outdented item without moving. */
  adopted: Set<ListItemNode>;
  /** Layers whose ordered numbers are rewritten; `null` is the top level. */
  renumber: Set<ListItemNode | null>;
  newLead: Map<ListItemNode, string>;
  newMark: Map<ListItemNode, string>;
  /** How each item's own lines (and inherited by its subtree) are re-indented. */
  shift: Map<ListItemNode, (lead: string) => string>;
}

function layerOf(plan: Plan, node: ListItemNode): ListItemNode[] {
  return node.parent ? node.parent.children : plan.tree.roots;
}

/** Nest `node` under its previous sibling. False when it has none (a first item). */
function nest(plan: Plan, node: ListItemNode): boolean {
  const layer = layerOf(plan, node);
  const i = layer.indexOf(node);
  if (i <= 0) return false;
  const prev = layer[i - 1];
  layer.splice(i, 1);
  prev.children.push(node);
  plan.renumber.add(node.parent);
  node.parent = prev;
  plan.renumber.add(prev);
  plan.moved.add(node);
  return true;
}

/**
 * Move `node` out to its parent's layer, right after the parent. Its later
 * siblings follow it in the text, so they become its children (their own text
 * is kept when it still nests). False for a top-level item.
 */
function unnest(plan: Plan, node: ListItemNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  const layer = parent.children;
  const later = layer.splice(layer.indexOf(node)).slice(1);
  for (const sib of later) {
    sib.parent = node;
    node.children.push(sib);
    plan.adopted.add(sib);
  }
  if (later.length) plan.renumber.add(node);
  const outer = layerOf(plan, parent);
  outer.splice(outer.indexOf(parent) + 1, 0, node);
  node.parent = parent.parent;
  plan.renumber.add(parent);
  plan.renumber.add(node.parent);
  plan.moved.add(node);
  return true;
}

/** Rewrite ordered numbers in a layer: each run of same-delimiter ordered items counts up. */
function renumberLayer(plan: Plan, layer: ListItemNode[], top: boolean): void {
  let next: number | null = null;
  let delim = "";
  for (const node of layer) {
    if (!node.ordered) {
      next = null;
      continue;
    }
    const d = node.markText.slice(-1);
    // The top level keeps its first item's start number; nested runs count from 1.
    if (next === null || d !== delim) next = top ? (node.number ?? 1) : 1;
    delim = d;
    plan.newMark.set(node, `${next}${d}`);
    next++;
  }
}

/** Replace a lead's prefix `from` with `to`; by columns when the prefix doesn't match. */
function prefixShift(c: (lead: string) => number, from: string, to: string): (lead: string) => string {
  if (from === to) return (lead) => lead;
  return (lead) => {
    if (lead.startsWith(from)) return to + lead.slice(from.length);
    const delta = c(to) - c(from);
    if (delta >= 0) return " ".repeat(delta) + lead;
    let cut = 0;
    while (cut < lead.length && c(lead.slice(0, cut + 1)) - c("") <= -delta) cut++;
    return lead.slice(cut);
  };
}

/** Where a node's content starts once its lead and marker are rewritten. */
function contentColAfter(plan: Plan, node: ListItemNode): number {
  const { col } = plan.tree;
  const offset = node.contentCol - col(node.lead + node.markText);
  return col((plan.newLead.get(node) ?? node.lead) + (plan.newMark.get(node) ?? node.markText)) + offset;
}

/** A child's lead nests under its parent: ≥ its content column, < 4 past it. */
function nestsUnder(plan: Plan, lead: string, parent: ListItemNode): boolean {
  const col = plan.tree.col(lead);
  const content = contentColAfter(plan, parent);
  return col >= content && col < content + 4;
}

/** Spaces one layer below the top adds, as the list wrote it before this move; else 4. */
function topStep(plan: Plan): number {
  for (const item of plan.tree.items) if (item.depth === 1 && item.step > 0) return item.step;
  return 4;
}

/**
 * The lead for a node placed afresh in its layer: a sibling's (when one stays
 * put and still nests), else one level past the parent in the list's style.
 */
function placeLead(plan: Plan, node: ListItemNode, inherited: (lead: string) => string): string {
  const parent = node.parent;
  for (const peer of layerOf(plan, node)) {
    if (peer === node || plan.moved.has(peer)) continue;
    const lead = plan.newLead.get(peer) ?? (plan.adopted.has(peer) ? peer.lead : inherited(peer.lead));
    if (!parent || nestsUnder(plan, lead, parent)) return lead;
  }
  if (!parent) return "";
  const { col: colOf } = plan.tree;
  const base = plan.newLead.get(parent) ?? parent.lead;
  const content = contentColAfter(plan, parent);
  if (plan.tree.style === "tab") {
    let lead = base + "\t";
    while (colOf(lead) < content) lead += "\t";
    return lead;
  }
  const grand = parent.parent;
  const step = grand ? colOf(base) - colOf(plan.newLead.get(grand) ?? grand.lead) : topStep(plan);
  const col = Math.min(Math.max(colOf(base) + Math.max(step, 1), content), content + 3);
  return base + " ".repeat(col - colOf(base));
}

/** Top-down over the rearranged tree: settle each node's lead, then its children's. */
function settle(plan: Plan, layer: ListItemNode[], inherited: (lead: string) => string): void {
  for (const node of layer) {
    const own = plan.adopted.has(node) ? (lead: string) => lead : inherited;
    const before = own(node.lead);
    if (!plan.moved.has(node) && node.parent && !nestsUnder(plan, before, node.parent)) plan.moved.add(node);
    const lead = plan.moved.has(node) ? placeLead(plan, node, own) : before;
    if (lead !== node.lead) plan.newLead.set(node, lead);
    const shift = before === lead ? own : (l: string) => prefixShift(plan.tree.col, before, lead)(own(l));
    plan.shift.set(node, shift);
    settle(plan, node.children, shift);
  }
}

/** Text edits for the plan: marker-line prefixes, then shifted continuation lines. */
function emit(state: EditorState, plan: Plan): ChangeSpec[] {
  const { tree } = plan;
  const changes: ChangeSpec[] = [];
  const markerLines = new Set<number>();
  for (const node of tree.items) {
    markerLines.add(node.lineNumber);
    const next = (plan.newLead.get(node) ?? node.lead) + (plan.newMark.get(node) ?? node.markText);
    if (next !== node.lead + node.markText) changes.push({ from: node.leadFrom, to: node.markTo, insert: next });
  }
  const first = state.doc.lineAt(tree.from).number;
  const last = state.doc.lineAt(Math.max(tree.from, tree.to - 1)).number;
  for (let ln = first; ln <= last; ln++) {
    if (markerLines.has(ln)) continue;
    const line = state.doc.line(ln);
    if (!/\S/.test(line.text)) continue; // blank lines stay as they are
    let owner: ListItemNode | null = null;
    for (const node of tree.items) {
      if (node.from <= line.from && line.from < node.to && (!owner || node.from > owner.from)) owner = node;
    }
    const shift = owner && plan.shift.get(owner);
    if (!shift) continue;
    // The lead sits after the list's container prefix; a lazy line has none to shift.
    const leadFrom = prefixEnd(state, line.from, tree.outerDepth);
    if (leadFrom === null) continue;
    const lead = /^[ \t]*/.exec(state.sliceDoc(leadFrom, line.to))![0];
    const next = shift(lead);
    if (next !== lead) changes.push({ from: leadFrom, to: leadFrom + lead.length, insert: next });
  }
  return changes;
}

function newPlan(tree: ListTree): Plan {
  return {
    tree,
    moved: new Set(),
    adopted: new Set(),
    renumber: new Set(),
    newLead: new Map(),
    newMark: new Map(),
    shift: new Map(),
  };
}

function finish(state: EditorState, plan: Plan): ChangeSpec[] {
  for (const layer of plan.renumber) renumberLayer(plan, layer ? layer.children : plan.tree.roots, !layer);
  settle(plan, plan.tree.roots, (lead) => lead);
  return emit(state, plan);
}

/** Group targets by the list tree they belong to (a selection may span two lists). */
function treesFor(state: EditorState, targets: SyntaxNode[]): { tree: ListTree; nodes: ListItemNode[] }[] | null {
  const groups: { tree: ListTree; nodes: ListItemNode[] }[] = [];
  for (const item of targets) {
    let group = groups.find((g) => g.tree.from <= item.from && item.to <= g.tree.to);
    if (!group) {
      const tree = listTreeOf(state, item);
      if (!tree) return null;
      group = { tree, nodes: [] };
      groups.push(group);
    }
    const node = group.tree.items.find((n) => n.from === item.from);
    if (node) group.nodes.push(node);
  }
  return groups;
}

function isAncestor(a: ListItemNode, b: ListItemNode): boolean {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

function toSpec(state: EditorState, changes: ChangeSpec[]): TransactionSpec {
  changes.sort((a, b) => (a as { from: number }).from - (b as { from: number }).from);
  if (import.meta.env.DEV) assertDisjoint(changes);
  const changeSet = state.changes(changes);
  return {
    changes: changeSet,
    // Map EVERY range so a multi-line selection keeps covering the same text.
    selection: EditorSelection.create(
      state.selection.ranges.map((r) =>
        EditorSelection.range(changeSet.mapPos(r.anchor, 1), changeSet.mapPos(r.head, 1)),
      ),
      state.selection.mainIndex,
    ),
    scrollIntoView: true,
    userEvent: "input",
  };
}

/**
 * Tab / ⌘] (`more`) and Shift-Tab / ⌘[ (`less`) on the selected items. Items
 * that can't move (a first item on Tab, a top-level item on Shift-Tab) stay put
 * while the rest move; when none can, the key is taken with no change.
 */
export function listIndentChange(state: EditorState, dir: ListIndentDir): ListIndentResult {
  if (state.readOnly) return null;
  const targets = selectionTargets(state);
  if (targets.length === 0) return null;
  const groups = treesFor(state, targets);
  if (!groups) return null; // a line whose prefix can't be read: plain indent

  const changes: ChangeSpec[] = [];
  let movedAny = false;
  for (const { tree, nodes } of groups) {
    const plan = newPlan(tree);
    // An item whose ancestor is also selected rides along with that ancestor.
    const tops = nodes.filter((n) => !nodes.some((o) => o !== n && isAncestor(o, n)));
    let moved = false;
    for (const node of tops) if (dir === "more" ? nest(plan, node) : unnest(plan, node)) moved = true;
    if (!moved) continue;
    movedAny = true;
    changes.push(...finish(state, plan));
  }
  if (!movedAny || changes.length === 0) return { kind: "noop" };
  return { kind: "change", spec: toSpec(state, changes) };
}

/**
 * Enter on an empty item (only a marker, caret after it): a nested one moves out
 * a level — exactly Shift-Tab — and a top-level one loses its marker, leaving the
 * list with the caret on the now-empty line (still inside any quote around the
 * list: its prefix stays). Null otherwise (the ordinary continuation runs).
 */
export function listEnterChange(state: EditorState): ListIndentResult {
  if (state.readOnly || state.selection.ranges.length !== 1) return null;
  const { head, empty } = state.selection.main;
  if (!empty) return null;
  const item = listItemAtLine(state, head);
  if (!item) return null;
  const groups = treesFor(state, [item]);
  const node = groups?.[0]?.nodes[0];
  if (!groups || !node) return null;
  const line = state.doc.lineAt(head);
  if (!node.emptyLine || node.children.length || head < node.markTo || node.lineNumber !== line.number) return null;
  if (state.doc.lineAt(Math.max(node.from, node.to - 1)).number !== line.number) return null;

  const plan = newPlan(groups[0].tree);
  if (node.parent) {
    unnest(plan, node);
    return { kind: "change", spec: toSpec(state, finish(state, plan)) };
  }
  // Top level: drop the marker; the ordered run it was in closes up behind it.
  const layer = plan.tree.roots;
  layer.splice(layer.indexOf(node), 1);
  plan.renumber.add(null);
  const changes = finish(state, plan);
  changes.push({ from: node.leadFrom, to: line.to });
  changes.sort((a, b) => (a as { from: number }).from - (b as { from: number }).from);
  return {
    kind: "change",
    spec: { changes, selection: EditorSelection.cursor(node.leadFrom), scrollIntoView: true, userEvent: "input" },
  };
}

/**
 * Enter at the end of a FOLDED item's first line (change: list-fold): the new
 * sibling goes after the item's whole subtree, not between the item and its
 * hidden children (which would hand them to the new item). Later ordered
 * siblings in the same run count on by one. Null otherwise.
 */
export function listFoldedEnterChange(state: EditorState): ListIndentResult {
  if (state.readOnly || state.selection.ranges.length !== 1) return null;
  const { head, empty } = state.selection.main;
  if (!empty) return null;
  const item = listItemAtLine(state, head);
  const line = state.doc.lineAt(head);
  if (!item || head !== line.to || state.doc.lineAt(item.from).number !== line.number) return null;
  const range = itemFoldRange(state, item);
  if (!range || !foldedAt(state, range.from)) return null;
  const group = treesFor(state, [item])?.[0];
  const node = group?.nodes[0];
  if (!group || !node) return null;

  const delim = node.markText.slice(-1);
  const next = (n: number) => `${n}${delim}`;
  let marker = node.ordered ? next((node.number ?? 1) + 1) : node.markText;
  if (node.task) marker += " [ ]";
  const insert = state.lineBreak + group.tree.prefix + node.lead + marker + " ";
  const changes: ChangeSpec[] = [{ from: range.to, insert }];
  if (node.ordered) {
    const layer = node.parent ? node.parent.children : group.tree.roots;
    let n = (node.number ?? 1) + 2;
    for (const sib of layer.slice(layer.indexOf(node) + 1)) {
      if (!sib.ordered || sib.markText.slice(-1) !== delim) break;
      if (sib.markText !== next(n)) changes.push({ from: sib.markFrom, to: sib.markTo, insert: next(n) });
      n++;
    }
  }
  return {
    kind: "change",
    spec: {
      changes,
      selection: EditorSelection.cursor(range.to + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    },
  };
}

/**
 * Dev guard: the per-group plans must not produce overlapping edits. Groups only
 * rewrite lines inside their own list, so an overlap means a plan reached outside.
 */
function assertDisjoint(changes: ChangeSpec[]): void {
  let prevTo = -1;
  for (const c of changes as Array<{ from: number; to?: number }>) {
    if (c.from < prevTo) throw new Error(`listIndent: overlapping change at ${c.from} (prev ends ${prevTo})`);
    prevTo = c.to ?? c.from;
  }
}
