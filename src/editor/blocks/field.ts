import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { progressiveTree, treeChanged as treeGrew } from "../syntax";
import { livePreviewConfig } from "../previewConfig";
import { mathReadyEffect } from "../math";
import { imageEpoch } from "../imageRefresh";
import { coveredBySelection, withSelectedState } from "../selectionPaint";
import { setActiveEdit } from "../tableInlineEdit";
import { setActiveProp, setPropsSource } from "./properties";
import { blockCaret } from "../caret";
import { BLOCKS, BLOCKS_BY_NODE, blockEntry } from "./registry";
import { asyncRenderDone, attemptRender, failedSourceMark } from "./render";
import type { BlockCandidate, BlockEntry, BlockRange } from "./types";

/**
 * The ONE place block-level replacements are made (spec: block-editing / 块级渲染
 * 只经注册表产生). CM6 requires block decorations to come from a StateField, not
 * a ViewPlugin, so every A / B entry is collected here and the reveal rule for A
 * is decided once, not per block. Every entry's `widget` runs through
 * `attemptRender` (change: block-fallback, design D1): a widget that throws
 * leaves its source in place with the failure mark.
 *
 * The failure marks are a SECOND set (design D6): the replacements are also the
 * editor's atomic ranges, and a mark in that set would make the source under it
 * uneditable.
 */
interface BlockDecorations {
  blocks: DecorationSet;
  failed: DecorationSet;
}

function buildBlockDecorations(state: EditorState): BlockDecorations {
  const config = state.facet(livePreviewConfig);
  const deco: Range<Decoration>[] = [];
  const failed: Range<Decoration>[] = [];

  const revealed = (c: BlockCandidate) =>
    config.revealOnSelection &&
    state.selection.ranges.some((r) => r.from <= c.to && r.to >= (c.revealFrom ?? c.from));

  const push = (entry: BlockEntry, c: BlockCandidate) => {
    if (entry.mode === "A" && revealed(c)) return;
    deco.push(
      Decoration.replace({
        // Every block carries its selected state from here, the one exit, so no
        // entry can miss it (spec: block-editing / 块的选中态只经框架产生). The
        // field already rebuilds on `tr.selection`.
        widget: withSelectedState(c.widget, coveredBySelection(state, c.from, c.to), "block"),
        block: true,
        // Read back by blockRanges(): which block, and how it is edited.
        blockId: entry.id,
        blockMode: entry.mode,
      }).range(c.from, c.to),
    );
  };

  for (const entry of BLOCKS) {
    if (!entry.scan) continue;
    const c = entry.scan(state, config);
    if (c) push(entry, c);
  }

  progressiveTree(state).iterate({
    enter: (node) => {
      const entry = BLOCKS_BY_NODE.get(node.name);
      if (!entry || !entry.range || !entry.widget) return;
      const range = entry.range(state, node);
      if (!range) return false;
      // A: check the reveal BEFORE building the widget — rendering (math) costs.
      if (entry.mode === "A" && revealed({ ...range, widget: null as never })) return false;
      const widget = entry.widget;
      const out = attemptRender(() => widget(state, node, range));
      if (out.kind === "rendered") push(entry, { ...range, widget: out.value });
      else if (out.kind === "failed") failed.push(failedSourceMark(range.from, range.to, out.reason));
      return false;
    },
  });

  deco.sort((a, b) => a.from - b.from);
  return { blocks: Decoration.set(deco, true), failed: Decoration.set(failed, true) };
}

export const blockDecorationField = StateField.define<BlockDecorations>({
  create: buildBlockDecorations,
  update(value, tr) {
    const treeChanged = treeGrew(tr);
    const configChanged =
      tr.startState.facet(livePreviewConfig) !== tr.state.facet(livePreviewConfig);
    // Converter finished loading — rebuild so BlockMath swaps source→formula.
    const mathReady = tr.effects.some((e) => e.is(mathReadyEffect));
    // Entering / switching / leaving an in-place cell edit reshapes a table widget.
    const editChanged = tr.effects.some((e) => e.is(setActiveEdit) || e.is(setActiveProp) || e.is(setPropsSource));
    // An async renderer (mermaid) finished one; or the editor switched light /
    // dark, which blocks drawn per scheme (mermaid) follow.
    const asyncDone = tr.effects.some((e) => e.is(asyncRenderDone));
    const schemeChanged = tr.startState.facet(EditorView.darkTheme) !== tr.state.facet(EditorView.darkTheme);
    // The host asked for images to be resolved again (`refreshImages`).
    const imagesRefreshed = imageEpoch(tr.startState) !== imageEpoch(tr.state);
    if (tr.docChanged || tr.selection || treeChanged || configChanged || mathReady || editChanged || asyncDone || schemeChanged || imagesRefreshed) {
      return buildBlockDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => [
    // Each entry's own companions (an async renderer's driver).
    BLOCKS.flatMap((b) => (b.extension ? [b.extension] : [])),
    EditorView.decorations.from(field, (v) => v.blocks),
    EditorView.decorations.from(field, (v) => v.failed),
    EditorView.atomicRanges.of((view) => view.state.field(field).blocks),
    // What the caret rules need to know about blocks (spec: caret-rules R2a /
    // R2b / R3), answered from this registry.
    blockCaret.of({
      revealRange: (state, node) => {
        const entry = BLOCKS_BY_NODE.get(node.name);
        return entry?.mode === "A" && entry.range ? entry.range(state, node) : null;
      },
      editable: (state) => blockRanges(state).filter((b) => b.mode === "B"),
      enterAt: (view, block, pos) => blockEntry(block.id)?.enterAt?.(view, block, pos),
      leave: (state) => BLOCKS.flatMap((b) => b.leave?.(state) ?? []),
    }),
  ],
});

/** The A / B blocks currently rendered, in document order. */
export function blockRanges(state: EditorState): BlockRange[] {
  const out: BlockRange[] = [];
  const set = state.field(blockDecorationField, false);
  if (!set) return out;
  set.blocks.between(0, state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { blockId?: string; blockMode?: BlockRange["mode"] };
    if (spec.blockId && spec.blockMode) out.push({ id: spec.blockId, mode: spec.blockMode, from, to });
  });
  return out;
}
