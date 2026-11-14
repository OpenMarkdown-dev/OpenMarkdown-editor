import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { BlockMathWidget } from "../widgets";
import { isMathReady, mathBody, mathLoadFailed, renderFormula } from "../math";
import { loadMathThenRedraw } from "../mathLoad";
import { progressiveTree, treeChanged } from "../syntax";
import { isPending } from "./render";
import type { BlockEntry } from "./types";

/** Does the document (as parsed so far) hold any formula — inline or block? */
export function documentHasMath(state: EditorState): boolean {
  let found = false;
  progressiveTree(state).iterate({
    enter: (node) => {
      if (found) return false;
      if (node.name === "InlineMath" || node.name === "BlockMath") {
        found = true;
        return false;
      }
    },
  });
  return found;
}

/**
 * The formula converter's load trigger (change: render-placeholder-size, design
 * D4): when the DOCUMENT has math, not when a formula is SEEN, so a formula
 * below the fold is already drawn when the user scrolls to it. While the
 * converter is neither loaded nor failed, each check walks the whole tree once;
 * the first formula found asks for the load, once per driver. Loaded or failed:
 * nothing. `load` is injected so the rule is testable without a view.
 */
export class MathLoadDriver {
  private asked = false;
  constructor(private readonly load: () => void) {}

  check(state: EditorState): void {
    if (this.asked || isMathReady() || mathLoadFailed()) return;
    if (!documentHasMath(state)) return;
    this.asked = true;
    this.load();
  }
}

/** Block math `$$…$$` — A (change: code-highlight-and-math). */
export const blockMathEntry: BlockEntry = {
  id: "block-math",
  mode: "A",
  node: "BlockMath",
  // Line-align the replaced range so the block decoration spans whole lines.
  range: (state, node) => ({
    from: state.doc.lineAt(node.from).from,
    to: state.doc.lineAt(node.to).to,
  }),
  widget: (state, node) => {
    // Not loaded → pending: the placeholder (the driver below loads it).
    // Load failed → null: source, unmarked. Invalid TeX → renderFormula throws
    // and the framework shows the source with the failure mark (change:
    // block-fallback).
    const mathml = renderFormula(mathBody(state.sliceDoc(node.from, node.to)), true);
    if (isPending(mathml)) return mathml;
    return mathml == null ? null : new BlockMathWidget(mathml, node.from);
  },
  extension: ViewPlugin.fromClass(
    class {
      private readonly driver: MathLoadDriver;
      constructor(view: EditorView) {
        this.driver = new MathLoadDriver(() => loadMathThenRedraw(view));
        this.driver.check(view.state);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || treeChanged(u)) this.driver.check(u.state);
      }
    },
  ),
};
