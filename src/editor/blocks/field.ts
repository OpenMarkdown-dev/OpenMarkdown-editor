import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { progressiveTree, treeChanged as treeGrew } from "../syntax";
import { livePreviewConfig } from "../previewConfig";
import { mathReadyEffect } from "../math";
import { imageEpoch } from "../imageRefresh";
import { coveredBySelection, withSelectedState } from "../selectionPaint";
import { setActiveEdit } from "../tableInlineEdit";
import { setActiveProp, setPropsSource } from "./properties";
import { blockCaret, landingHiders, landingInside, type LandingShown } from "../caret";
import { isRevealed } from "./reveal";
import { BLOCKS, BLOCKS_BY_NODE, blockEntry } from "./registry";
import { asyncRenderDone, attemptRender, failedSourceMark } from "./render";
import { type Carried, PendingWidget, blockSizeKey, carriedAt, mapCarried, rememberSize, rememberedSize, reservedSize } from "./pending";
import type { BlockCandidate, BlockEntry, BlockRange } from "./types";

/**
 * The ONE place block-level replacements are made (spec: block-editing / 块级渲染
 * 只经注册表产生). CM6 requires block decorations to come from a StateField, not
 * a ViewPlugin, so every A / B entry is collected here and the reveal rule for A
 * (`isRevealed`, `./reveal.ts`) is applied once, not per block. Every entry's
 * `widget` runs through `attemptRender` (change: block-fallback, design D1): a widget that throws
 * leaves its source in place with the failure mark.
 *
 * The failure marks are a SECOND set (design D6): the replacements are also the
 * editor's atomic ranges, and a mark in that set would make the source under it
 * uneditable.
 *
 * A `pending` answer ("mine, not yet") becomes the one placeholder
 * (`./pending.ts`) through the same `push`, so it is selected, entered and read
 * back by `blockRanges()` like the rendered block (change:
 * render-placeholder-size, design D2). Its size comes from the one order
 * (`reservedSize`): the height last drawn for this source (recorded below, by
 * `recordDrawnSizes`), else — for an A block the caret revealed and edited —
 * the height it had before (`carried`, kept in this field), else the entry's
 * minimum.
 */
interface BlockDecorations {
  blocks: DecorationSet;
  failed: DecorationSet;
  /** Revealed / pending A blocks' last drawn heights, by start (design D3, carried). */
  carried: Carried[];
}

function buildBlockDecorations(state: EditorState, prevCarried: readonly Carried[] = []): BlockDecorations {
  const config = state.facet(livePreviewConfig);
  const deco: Range<Decoration>[] = [];
  const failed: Range<Decoration>[] = [];
  const carried: Carried[] = [];
  const scheme = state.facet(EditorView.darkTheme) ? "dark" : "light";

  const push = (entry: BlockEntry, c: BlockCandidate, sizeKey?: string) => {
    if (entry.mode === "A" && isRevealed(state, c)) return;
    // The landing inside a block that does not paint it is marked on the whole
    // widget (spec: caret-rules / 落点看得见, outcome 3) — here, the one exit,
    // so a new entry gets it without asking. A block that paints finer (the
    // table) declares `paintsLanding` and the marking is its own — for the
    // landings it does paint; one it cannot (a Find match on a table's pipe or
    // delimiter row, which no cell draws) falls back to the whole widget.
    const landing =
      landingInside(state, c.from, c.to) &&
      !entry.paintsLanding?.(state, { id: entry.id, mode: entry.mode, from: c.from, to: c.to });
    deco.push(
      Decoration.replace({
        // Every block carries its selected state from here, the one exit, so no
        // entry can miss it (spec: block-editing / 块的选中态只经框架产生). The
        // field already rebuilds on `tr.selection`.
        widget: withSelectedState(c.widget, coveredBySelection(state, c.from, c.to), "block", landing),
        block: true,
        // Read back by blockRanges(): which block, and how it is edited.
        blockId: entry.id,
        blockMode: entry.mode,
        // A drawn A block's size-memory key (`recordDrawnSizes` reads it).
        sizeKey,
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
      const key = entry.mode === "A" ? blockSizeKey(entry.id, scheme, state.sliceDoc(range.from, range.to)) : undefined;
      const prior = carriedAt(prevCarried, range.from);
      // A: check the reveal BEFORE building the widget — rendering (math) costs.
      if (entry.mode === "A" && isRevealed(state, range)) {
        // Carry the height it was drawn at while its source is being edited.
        const height = prior?.height ?? rememberedSize(key!)?.height;
        if (height) carried.push({ from: range.from, height });
        return false;
      }
      const widget = entry.widget;
      const out = attemptRender(() => widget(state, node, range));
      if (out.kind === "rendered") push(entry, { ...range, widget: out.value }, key);
      else if (out.kind === "pending") {
        if (prior) carried.push({ from: range.from, height: prior.height });
        const reserved = reservedSize({ key, carried: prior, minHeight: entry.pendingMinHeight });
        push(entry, { ...range, widget: new PendingWidget("block", range.from, reserved, out.content) });
      } else if (out.kind === "failed") failed.push(failedSourceMark(range.from, range.to, out.reason));
      return false;
    },
  });

  deco.sort((a, b) => a.from - b.from);
  return { blocks: Decoration.set(deco, true), failed: Decoration.set(failed, true), carried };
}

/**
 * Record each drawn A block's measured height under its size key (design D3,
 * "remembered"), from CodeMirror's own height map — read in a measure cycle, so
 * only real measurements, never estimates. Blocks in the viewport only: those
 * are the drawn, measured ones. One recorder for every entry, so a new async
 * block gets its remembered size for free.
 */
const recordDrawnSizes = ViewPlugin.fromClass(
  class {
    private readonly measure = {
      key: this,
      read: (view: EditorView) => {
        const { from, to } = view.viewport;
        view.state.field(blockDecorationField).blocks.between(from, to, (f, _t, deco) => {
          const key = (deco.spec as { sizeKey?: string }).sizeKey;
          if (key) rememberSize(key, { height: view.lineBlockAt(f).height });
        });
      },
    };
    constructor(view: EditorView) {
      view.requestMeasure(this.measure);
    }
    update(u: ViewUpdate) {
      if (u.heightChanged || u.viewportChanged || u.geometryChanged) u.view.requestMeasure(this.measure);
    }
  },
);

export const blockDecorationField = StateField.define<BlockDecorations>({
  create: (state) => buildBlockDecorations(state),
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
    // An entry's own inputs (the table paints Find matches).
    const entryInputs = BLOCKS.some((b) => b.redrawOn?.(tr));
    if (tr.docChanged || tr.selection || treeChanged || configChanged || mathReady || editChanged || asyncDone || schemeChanged || imagesRefreshed || entryInputs) {
      return buildBlockDecorations(tr.state, tr.docChanged ? mapCarried(value.carried, tr.changes) : value.carried);
    }
    return value;
  },
  provide: (field) => [
    // Each entry's own companions (an async renderer's driver).
    BLOCKS.flatMap((b) => (b.extension ? [b.extension] : [])),
    recordDrawnSizes,
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
      enterAt: (view, block, pos, head) => blockEntry(block.id)?.enterAt?.(view, block, pos, head),
      partAt: (state, block, pos) => blockEntry(block.id)?.partAt?.(state, block, pos) ?? null,
      leave: (state) => BLOCKS.flatMap((b) => b.leave?.(state) ?? []),
    }),
    landingHiders.of(blockLanding),
  ],
});

/**
 * The block field's answer to "how is the landing shown" (spec: caret-rules /
 * 落点看得见; `landingShownBy`), read off the blocks it built: for a rendered
 * block the landing is inside, `painted` when its entry paints it, else
 * `marked` when the built widget carries the landing mark, else `hidden`.
 */
function blockLanding(state: EditorState): LandingShown | null {
  const set = state.field(blockDecorationField, false);
  if (!set) return null;
  let out: LandingShown | null = null;
  set.blocks.between(0, state.doc.length, (from, to, deco) => {
    if (!landingInside(state, from, to)) return;
    const spec = deco.spec as { blockId?: string; blockMode?: BlockRange["mode"]; widget?: { landing?: boolean } };
    const entry = spec.blockId ? blockEntry(spec.blockId) : undefined;
    const block = { id: spec.blockId ?? "", mode: spec.blockMode ?? "B", from, to };
    const shown: LandingShown = entry?.paintsLanding?.(state, block)
      ? "painted"
      : spec.widget?.landing ? "marked" : "hidden";
    if (out !== "hidden") out = shown;
  });
  return out;
}

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
