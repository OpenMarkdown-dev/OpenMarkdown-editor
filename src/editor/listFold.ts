import { foldService, foldedRanges, foldState } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { FoldToggleWidget } from "./headingFold";
import { listItemAtLine } from "./structure/listTree";
import { linePrefix } from "./structure/prefix";
import { progressiveTree, treeChanged } from "./syntax";

/**
 * List folding (change: list-fold; spec: live-preview-editor / 列表折叠).
 *
 * A list item folds from the end of its first line to the end of its last
 * non-blank line — its whole subtree, whatever markers its children use. The
 * range comes from the ListItem syntax node, the same one the list tree
 * (`structure/listTree.ts`) is built from, so "what belongs to this item" has a
 * single answer for input and for folding. Registered as a `foldService`, so
 * `foldable()` and the fold shortcuts see it; the toggle is the heading one.
 */

export interface ListFold {
  /** Start of the item's first line, where the toggle sits. */
  lineFrom: number;
  range: { from: number; to: number };
  folded: boolean;
}

/** The fold range of a ListItem node, or null when there is nothing below its first line. */
export function itemFoldRange(state: EditorState, item: SyntaxNode): { from: number; to: number } | null {
  const first = state.doc.lineAt(item.from);
  let last = state.doc.lineAt(Math.max(item.from, item.to));
  // A ListItem can end on a trailing blank line, or at the next line's start.
  // "Blank" means nothing after the line's container prefix: inside a quote a
  // line holding only `>` is blank too (change: editor-insets — lists in quotes
  // and callouts fold like any other list).
  while (last.number > first.number && (isBlank(state, last.from) || item.to <= last.from)) {
    last = state.doc.line(last.number - 1);
  }
  return last.number > first.number ? { from: first.to, to: last.to } : null;
}

/** Whether a line holds nothing but its container prefix. */
function isBlank(state: EditorState, lineFrom: number): boolean {
  const p = linePrefix(state, lineFrom);
  return !/\S/.test(state.sliceDoc(p.end, p.line.to));
}

/** The fold range of the item whose first line starts at `lineFrom`, or null. */
export function listFoldRange(state: EditorState, lineFrom: number): { from: number; to: number } | null {
  const item = listItemAtLine(state, lineFrom);
  if (!item || state.doc.lineAt(item.from).from !== lineFrom) return null;
  return itemFoldRange(state, item);
}

export const listFoldService = foldService.of((state, lineStart) => listFoldRange(state, lineStart));

/** Whether a fold starts exactly at `from` (a fold of an ancestor doesn't count). */
export function foldedAt(state: EditorState, from: number): boolean {
  let hit = false;
  foldedRanges(state).between(from, from, (f) => {
    if (f === from) {
      hit = true;
      return false;
    }
  });
  return hit;
}

/**
 * Every foldable list item whose first line lies in `[from, to]`, as far as the
 * tree is parsed — a decoration's read (change: syntax-access): the toggle
 * rebuilds when the tree grows.
 */
export function listFolds(state: EditorState, from: number, to: number): ListFold[] {
  const out: ListFold[] = [];
  progressiveTree(state).iterate({
    from,
    to,
    enter: (n) => {
      if (n.name !== "ListItem") return;
      const lineFrom = state.doc.lineAt(n.from).from;
      if (lineFrom < from || lineFrom > to) return;
      const range = itemFoldRange(state, n.node);
      if (range) out.push({ lineFrom, range, folded: foldedAt(state, range.from) });
    },
  });
  return out;
}

function buildDecorations(view: EditorView): DecorationSet {
  const deco: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (const f of listFolds(view.state, from, to)) {
      deco.push(Decoration.line({ class: "om-fold-list" }).range(f.lineFrom));
      deco.push(Decoration.widget({ widget: new FoldToggleWidget(f.range, f.folded), side: -1 }).range(f.lineFrom));
    }
  }
  return Decoration.set(deco, true);
}

/**
 * The list fold toggles. Rides the base config next to `headingFoldToggle`, and
 * like it rebuilds when the parsed tree changes, not only on edits / scrolls.
 */
export const listFoldToggle = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        treeChanged(u) ||
        u.startState.field(foldState, false) !== u.state.field(foldState, false)
      ) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
