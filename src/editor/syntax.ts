import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { Prec, type EditorState } from "@codemirror/state";
import { keymap, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";

/**
 * The ONE place the markdown syntax tree is read (spec: live-preview-editor /
 * 语法树只从一处取; change: syntax-access). Every caller names what it needs,
 * and each need has exactly one accessor:
 *
 * | need                                   | accessor                          | cost / guarantee                         |
 * | -------------------------------------- | --------------------------------- | ---------------------------------------- |
 * | a key or command at a position         | `treeUpTo(state, pos)`            | unbounded but local; always complete     |
 * | the same, for library code that reads  | `withTreeUpTo` / `forceTreeUpTo`  | as above, and the state's field holds it |
 * |   the state's own language field       |                                   |                                          |
 * | a whole-document listing               | `boundedTree(state, upto?)`       | bounded budget; says `complete` or not   |
 * | a decoration                           | `progressiveTree(state)` +        | whatever is parsed; MUST rebuild when    |
 * |                                        |   `treeChanged(update)`           |   `treeChanged` says the tree grew       |
 * | a test / fixture state                 | `withCompleteTree(state)`         | unbounded; whole document                |
 *
 * Why it matters (docs/dev-notes.md 「语法树「半截」」): `@codemirror/language`
 * parses for only 20ms when a state is created and on every transaction, then
 * freezes a partial tree in the state's language field. `ensureSyntaxTree`
 * advances the shared parse and returns a fuller tree but does NOT update that
 * field, which is what `syntaxTree(state)` — and library code such as
 * `foldable`, lang-markdown's `headerIndent` and its Enter / Backspace commands
 * — read. So a tree is either asked for with a named guarantee here, or not at
 * all; the gate `syntaxGate.test.ts` fails any other call to the library's
 * tree functions.
 */

/**
 * Milliseconds a whole-document consumer may spend parsing in one call. One
 * cold pass covers roughly 1.5MB of markdown (≈10× `fixtures/perf/long-document.md`,
 * measured ~3MB/s in node); the work is kept in the shared parse, so the next
 * call continues where this one stopped and a larger document converges.
 */
export const WHOLE_DOC_BUDGET_MS = 500;

/** A tree with an explicit answer to "does it reach where I asked?". */
export interface BoundedTree {
  tree: Tree;
  /** True when `tree` is the full parse through the requested position. */
  complete: boolean;
}

/**
 * One whole-document answer per state: a state never changes, so neither does
 * its bounded tree, and a caller that asks repeatedly for the same state must
 * not spend the budget again each time.
 */
const wholeDoc = new WeakMap<EditorState, BoundedTree>();

/** End of the line holding `pos` (clamped into the document). */
function lineEndAt(state: EditorState, pos: number): number {
  return state.doc.lineAt(Math.max(0, Math.min(pos, state.doc.length))).to;
}

/**
 * Whether every top-level block that starts on or before `lineEnd` is closed in
 * `tree`: some top-level block starts after it. A markdown block only ends when
 * the parser has seen the line that does not continue it, so the next sibling
 * is the proof (blank lines alone are not — a list resumes after them).
 */
function closedThrough(tree: Tree, lineEnd: number): boolean {
  const last = tree.topNode.lastChild;
  return !!last && last.from > lineEnd;
}

/**
 * The tree, complete through the end of the top-level block that holds `pos`
 * (or the document end). What a key or a command at `pos` reads: the block
 * around the caret, its list siblings and everything before it are final.
 * Unbounded, but local — it parses no further than that block (an unclosed
 * fence is the one block that runs to the end of the document, and its end is
 * exactly what the fence key needs to know).
 */
export function treeUpTo(state: EditorState, pos: number): Tree {
  const len = state.doc.length;
  const lineEnd = lineEndAt(state, pos);
  let upto = lineEnd;
  for (let step = 1024; ; step *= 2) {
    const tree = ensureSyntaxTree(state, upto, Infinity);
    if (!tree) return syntaxTree(state); // no language: the empty tree
    if (upto >= len || closedThrough(tree, lineEnd)) return tree;
    upto = Math.min(len, upto + step);
  }
}

/**
 * `state`, or a copy whose language field holds `tree`. An empty transaction
 * is how the field catches up with the shared parse (its `apply` takes the
 * context's tree when nothing else changed).
 */
function adopt(state: EditorState, tree: Tree): EditorState {
  return syntaxTree(state) === tree ? state : state.update({}).state;
}

/** `treeUpTo`, with the state's own field holding it — for library calls on a bare state. */
export function withTreeUpTo(state: EditorState, pos: number): EditorState {
  return adopt(state, treeUpTo(state, pos));
}

/**
 * `treeUpTo` for a view: after this, `view.state`'s field holds the tree
 * complete through `pos`'s block, so library commands read it too. Dispatches
 * an empty transaction when the field is behind — call it from a key handler
 * or a command, never from inside an update.
 */
export function forceTreeUpTo(view: EditorView, pos: number): void {
  if (syntaxTree(view.state) !== treeUpTo(view.state, pos)) view.dispatch({});
}

/**
 * The body editor's key choke point: before ANY binding sees a key — the
 * structure entry, the registry's editor-scope commands, and CodeMirror's own
 * defaults that read the tree at the caret (syntax selection, bracket
 * matching, indentation) — the view's field holds the tree complete through
 * the caret's block. Never takes the key. Skipped while an IME composition is
 * open (the composition owns the input; nothing is dispatched under it).
 */
export const settleTreeOnKey = Prec.highest(
  keymap.of([
    {
      any: (view) => {
        if (!view.composing) forceTreeUpTo(view, view.state.selection.main.head);
        return false;
      },
    },
  ]),
);

/**
 * A whole-document (or "everything before `upto`") consumer's tree: parse for
 * at most `budgetMs`, then report honestly. On a miss the tree is what the
 * parse reached — the caller MUST surface `complete: false`, never present the
 * prefix as the whole.
 */
export function boundedTree(
  state: EditorState,
  upto: number = state.doc.length,
  budgetMs: number = WHOLE_DOC_BUDGET_MS,
): BoundedTree {
  const to = Math.max(0, Math.min(upto, state.doc.length));
  const whole = to === state.doc.length && budgetMs === WHOLE_DOC_BUDGET_MS;
  const known = whole ? wholeDoc.get(state) : undefined;
  if (known) return known;
  const tree = ensureSyntaxTree(state, to, budgetMs);
  let result: BoundedTree;
  if (tree) result = { tree, complete: true };
  else {
    // Out of budget: let the field take what the parse reached so far (a
    // detached state — nothing is dispatched), so the caller gets the longest
    // prefix.
    const caught = state.update({}).state;
    result = { tree: syntaxTree(caught), complete: syntaxTreeAvailable(caught, to) };
  }
  if (whole) wholeDoc.set(state, result);
  return result;
}

/**
 * The tree as parsed so far — for decorations only. Contract: a decoration
 * built from it MUST rebuild when `treeChanged(update)` is true, so what the
 * background parse adds later shows up.
 */
export function progressiveTree(state: EditorState): Tree {
  return syntaxTree(state);
}

/** Whether the parsed tree differs between an update's start and end state. */
export function treeChanged(update: Pick<ViewUpdate, "state" | "startState">): boolean {
  return syntaxTree(update.state) !== syntaxTree(update.startState);
}

/**
 * A state whose field holds the complete tree of the whole document —
 * unbounded. For test and fixture factories, which must never see a partial
 * tree whatever the machine's load.
 */
export function withCompleteTree(state: EditorState): EditorState {
  const tree = ensureSyntaxTree(state, state.doc.length, Infinity);
  return tree ? adopt(state, tree) : state;
}
