import type { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

// A leaf: the blocks that exit through here (the table widget, the Properties
// block) are registry entries, and entries sit BELOW the block framework —
// `field.ts` / `arrows.ts` import the registry, which imports them. So the exit
// lives with the entries' helpers, not in `arrows.ts` (spec: module-graph /
// 运行时 import 不成环; gate `src/moduleGraph.gate.test.ts`).

/**
 * Leave a B block from its top (`up`) or bottom (`down`) edge: end the part's
 * edit (the caller's `effects`) and put the caret on the line just outside.
 * Returns false — and changes nothing — when the block sits at the document
 * edge with no line beyond it: the caret then stays inside rather than vanish.
 * (spec: block-editing / 方向键进出块; caret-rules R8c / R9.)
 */
export function exitBlock(
  view: EditorView,
  block: { from: number; to: number },
  dir: "up" | "down",
  effects: StateEffect<unknown>[] = [],
): boolean {
  const doc = view.state.doc;
  const n = dir === "up" ? doc.lineAt(block.from).number - 1 : doc.lineAt(block.to).number + 1;
  if (n < 1 || n > doc.lines) return false;
  view.dispatch({ effects, selection: { anchor: doc.line(n).from }, scrollIntoView: true, userEvent: "select" });
  view.focus();
  return true;
}
