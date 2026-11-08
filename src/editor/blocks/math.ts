import { BlockMathWidget } from "../widgets";
import { isMathReady, mathBody, renderMath } from "../math";
import type { BlockEntry } from "./types";

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
    // Not loaded → null: source, unmarked (the inline ViewPlugin triggers the
    // lazy load). Invalid TeX → renderMath throws and the framework shows the
    // source with the failure mark (change: block-fallback).
    if (!isMathReady()) return null;
    const mathml = renderMath(mathBody(state.sliceDoc(node.from, node.to)), true);
    return mathml == null ? null : new BlockMathWidget(mathml, node.from);
  },
};
