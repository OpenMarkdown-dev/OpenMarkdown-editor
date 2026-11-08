import { Prec, type EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  deleteCharBackward,
  indentLess,
  indentMore,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import { deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import { fenceCloseChange } from "../commands";
import { forceTreeUpTo, treeUpTo, withTreeUpTo } from "../syntax";
import { listEnterChange, listFoldedEnterChange, listIndentChange } from "../listIndent";
import { tableNavChange } from "../tableCommands";
import { STRUCTURE_KEYS, type StructureKey } from "./keys";
import { containerNewline, innermost, linePrefix, quoteExitChange } from "./prefix";
import { INLINE_NODES, inlineEnterChange } from "./inline";

export { STRUCTURE_KEYS, type StructureKey } from "./keys";

/**
 * The one entry for the six structure keys (spec: structure-input; design D1–D3).
 *
 * The syntax tree around the caret gives a stack of structures, innermost first
 * (a fence inside a list item is `["code", "list"]`). A key walks that stack and
 * asks each structure's handler in turn; the first that takes the key wins. When
 * none does, the "no structure" row runs the editor default. Every result of these
 * keys is therefore decided by the table below and nowhere else — the gate test
 * (`gate.test.ts`) fails any other binding for them.
 */

/** What every command here runs against: an `EditorView`, or a bare state in tests. */
export interface StructureTarget {
  state: EditorState;
  dispatch: (tr: Transaction) => void;
}

/**
 * A structure's answer to a key: `true` took it (and dispatched, if it changed
 * anything), `false` passes it to the next structure out, `"default"` skips the
 * rest of the stack and runs the default row (a fence's Tab is the code's, not
 * the enclosing list's).
 */
type Handler = (target: StructureTarget) => boolean | "default";

export type Structure = "inline" | "list" | "quote" | "code" | "table";

const NODE_STRUCTURE: Record<string, Structure> = {
  ListItem: "list",
  Blockquote: "quote",
  FencedCode: "code",
  CodeBlock: "code",
  Table: "table",
  // Image / Link / InlineMath: Enter inside one is "done editing" (./inline.ts).
  ...Object.fromEntries(INLINE_NODES.map((name) => [name, "inline" as const])),
};

function fromSpec(spec: TransactionSpec | null, target: StructureTarget): boolean {
  if (!spec) return false;
  target.dispatch(target.state.update(spec));
  return true;
}

type Planned = { kind: "change"; spec: TransactionSpec } | { kind: "noop" } | null;

/** A planner that can also say "nothing to do, but the key is mine" (`noop`). */
function planned(plan: (state: EditorState) => Planned): Handler {
  return (target) => {
    const r = plan(target.state);
    if (r === null) return false;
    if (r.kind === "change") fromSpec(r.spec, target);
    return true; // "noop" still takes the key: no fall-through to plain indent
  };
}

const HANDLERS: Record<Structure, Partial<Record<StructureKey, Handler>>> = {
  // Strictly inside an image, link or inline math, Enter leaves it for the next
  // line instead of splitting it; on its edge, or for any other key, the
  // structure around (or the default) decides.
  inline: {
    Enter: (t) => fromSpec(inlineEnterChange(t.state), t),
  },
  list: {
    // A folded item opens a sibling after its subtree; an empty item moves out a
    // level or leaves the list; otherwise continue it.
    // A line whose innermost container is a quote (an empty `> ` after the
    // list) belongs to the quote, not the list around or before it.
    Enter: (t) =>
      innermost(linePrefix(t.state, t.state.selection.main.head))?.kind !== "quote" &&
      (planned(listFoldedEnterChange)(t) || planned(listEnterChange)(t) || insertNewlineContinueMarkup(t)),
    Backspace: deleteMarkupBackward,
    // ⌘] / ⌘[ are Tab / Shift-Tab in a list (design D4).
    Tab: planned((s) => listIndentChange(s, "more")),
    "Shift-Tab": planned((s) => listIndentChange(s, "less")),
    "Mod-]": planned((s) => listIndentChange(s, "more")),
    "Mod-[": planned((s) => listIndentChange(s, "less")),
  },
  quote: {
    // An empty quote line leaves the (innermost) quote; any other line continues
    // every container around it (change: quote-keys). Several cursors keep the
    // library's continuation.
    Enter: (t) =>
      fromSpec(quoteExitChange(t.state), t) ||
      fromSpec(containerNewline(t.state, false), t) ||
      insertNewlineContinueMarkup(t),
    Backspace: deleteMarkupBackward,
  },
  code: {
    // Top-level fences auto-close; inside a quote or list the new line keeps the
    // container prefix and the code's own indentation, and never auto-closes.
    Enter: (t) => fromSpec(fenceCloseChange(t.state), t) || fromSpec(containerNewline(t.state, true), t),
    Tab: () => "default",
    "Shift-Tab": () => "default",
    "Mod-]": () => "default",
    "Mod-[": () => "default",
  },
  table: {
    Tab: planned((s) => tableNavChange(s, "next")),
    "Shift-Tab": planned((s) => tableNavChange(s, "prev")),
  },
};

const DEFAULTS: Record<StructureKey, (target: StructureTarget) => boolean> = {
  Enter: insertNewlineAndIndent,
  // Takes the view when there is one, so it still steps over atomic widgets.
  Backspace: deleteCharBackward as (target: StructureTarget) => boolean,
  Tab: indentMore,
  "Shift-Tab": indentLess,
  "Mod-]": indentMore,
  "Mod-[": indentLess,
};

/**
 * Where lang-markdown's Backspace looks for markup: the node before the caret,
 * stepping back into a list that ends just before it (its `contextNodeForDelete`).
 * Included so a caret the library treats as "after list markup" is seen as in
 * the list here too.
 */
function deleteContextNode(state: EditorState, pos: number): SyntaxNode {
  let node = treeUpTo(state, pos).resolveInner(pos, -1);
  let scan = pos;
  if (node.name === "QuoteMark" || node.name === "ListMark") {
    scan = node.from;
    node = node.parent ?? node;
  }
  for (let prev; (prev = node.childBefore(scan)); ) {
    if (prev.name === "QuoteMark" || prev.name === "ListMark") scan = prev.from;
    else if ((prev.name === "OrderedList" || prev.name === "BulletList") && prev.lastChild) {
      node = prev.lastChild;
      scan = node.to;
    } else break;
  }
  return node;
}

/**
 * The structures around the main caret, innermost first. Read from the caret's
 * line (its first non-blank character and where its content starts after the
 * container prefix), the character before the caret, and lang-markdown's
 * Backspace context — the places the handlers themselves look — so no handler
 * is skipped because the entry looked somewhere else.
 * Handlers re-check their own context, so a structure seen here that does not
 * apply just passes the key on.
 */
export function structuresAt(state: EditorState, key?: StructureKey): Structure[] {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const lead = /^\s*/.exec(line.text)![0].length;
  const tree = treeUpTo(state, head);
  const starts: SyntaxNode[] = [tree.resolveInner(head, -1)];
  if (lead < line.text.length) starts.push(tree.resolveInner(line.from + lead, 1));
  const content = linePrefix(state, head).end;
  if (content < line.to) starts.push(tree.resolveInner(content, 1));
  if (key === "Backspace") starts.push(deleteContextNode(state, head));

  const found = new Map<string, { node: SyntaxNode; kind: Structure }>();
  for (const start of starts) {
    for (let n: SyntaxNode | null = start; n; n = n.parent) {
      const kind = NODE_STRUCTURE[n.name];
      if (kind) found.set(`${n.from}:${n.to}:${n.name}`, { node: n, kind });
    }
  }
  // Nested nodes lie inside one another, so the shorter span is the inner one.
  return [...found.values()]
    .sort((a, b) => a.node.to - a.node.from - (b.node.to - b.node.from))
    .map((s) => s.kind);
}

/**
 * The key's target with a tree complete through the caret's top-level block in
 * its own language field (spec: live-preview-editor / 语法树只从一处取). The
 * handlers include library commands (`insertNewlineContinueMarkup`,
 * `deleteMarkupBackward`, `foldable` through the list fold service) that read
 * that field rather than asking for a tree, so settling it HERE — once, at the
 * entry — is what makes every key see the whole structure it acts on, however
 * far the background parse has got. A view is settled in place; a bare test
 * target gets a settled copy of its state.
 */
function settled(target: StructureTarget): StructureTarget {
  const head = target.state.selection.main.head;
  if (target instanceof EditorView) {
    forceTreeUpTo(target, head);
    return target;
  }
  return { state: withTreeUpTo(target.state, head), dispatch: target.dispatch };
}

/**
 * Run one structure key. Returns whether the key was taken. In reading mode
 * Enter is swallowed and the other keys are left to the browser (spec:
 * live-preview-editor / 阅读模式回车不改写).
 */
export function runStructureKey(given: StructureTarget, key: StructureKey): boolean {
  if (given.state.readOnly) return key === "Enter";
  const target = settled(given);
  for (const kind of structuresAt(target.state, key)) {
    const handler = HANDLERS[kind][key];
    if (!handler) continue;
    const r = handler(target);
    if (r === "default") break;
    if (r) return true;
  }
  return DEFAULTS[key](target);
}

/**
 * The body editor's binding for the six keys. `Prec.high` so it runs before the
 * base keymap (whose `defaultKeymap` copies of Enter / Backspace / Mod-[ / Mod-]
 * it thereby replaces). The completion popup's Enter / Tab sit at `Prec.highest`
 * and still go first while it is open.
 */
export const structureKeymap = Prec.high(
  keymap.of(STRUCTURE_KEYS.map((key) => ({ key, run: (view) => runStructureKey(view, key) }))),
);
