import { matchAgentTokens } from "./agentMention";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { EditorState, Range, RangeSet } from "@codemirror/state";
import { progressiveTree, treeChanged as treeGrew, treeUpTo } from "./syntax";
import type { SyntaxNodeRef, SyntaxNode } from "@lezer/common";
import {
  BulletWidget,
  CalloutHeaderWidget,
  CheckboxWidget,
  CopyButtonWidget,
  HrWidget,
  ImageWidget,
  InlineMathWidget,
  LinkLabelWidget,
} from "./widgets";
import { codeBlockBody } from "./codeblockCopy";
import { mathBody, mathReadyEffect, renderFormula } from "./math";
import { attemptRender, failedSourceMark } from "./blocks/render";
import { PendingWidget, reservedSize } from "./blocks/pending";
import {
  DEFAULT_CHIP_THRESHOLD,
  expandedRefField,
  isRefExpanded,
  shouldConcealUrl,
  chipLabel,
  UrlChipWidget,
} from "./refChip";
import { perfProbeEnabled, recordBuildMs } from "@/lib/perfProbe";
import { livePreviewConfig, type LivePreviewConfig } from "./previewConfig";
import { blockDecorationField } from "./blocks/field";
import { nestedPreview } from "./blocks/nested";
import { followLink } from "./linkNavigate";
import { clickFollowsLink } from "./linkGesture";
import { imageEpoch, imageEpochField } from "./imageRefresh";
import { FORMATTING_MARKS, linkTextIsEmpty, listMarkStandIn } from "./previewConceal";
import { isLink, linkMarkConcealable, referenceLabels, type ReferenceLabels, type SourceReader } from "./linkRefs";
import { decorateInsets } from "./insets/decorate";
import { coveredBySelection, withSelectedState } from "./selectionPaint";
import { imageLabelOf } from "./imageAlt";
import { calloutOf } from "./insets/stack";
import { landingHiders, landingInside, type LandingShown } from "./caret";

// The config facet now lives in `previewConfig.ts` so `widgets.ts` can read it
// without an import cycle (livePreview → widgets already exists). Re-exported
// here so existing importers keep working unchanged.
export { livePreviewConfig, type LivePreviewConfig } from "./previewConfig";

const hide = Decoration.replace({});

/**
 * The visible stand-in of hidden source that holds the landing, where the mode
 * does not reveal (Reading): the link text of a hidden URL, the widget standing
 * for its source (spec: caret-rules / 落点看得见, outcome 3). Styled once in
 * `theme.ts` with the selection fill.
 */
export const LANDING_CLASS = "om-landing";
const landingMark = Decoration.mark({ class: LANDING_CLASS });
/** A landing equal to a hidden range is in it too (`landingInside`, non-strict). */
const WITHIN = { strict: false };

/**
 * Provenance color for an `@agent` addressing token (change: agent-addressing).
 * A plain mark (color only, nothing concealed) — the disk text stays plain GFM
 * `@agent`; `.om-agent` is themed with `--agent` in theme.ts.
 */
const agentMark = Decoration.mark({ class: "om-agent" });


interface BuildResult {
  decorations: DecorationSet;
  hidden: DecorationSet; // atomic ranges (replaced content)
  /** A hide was skipped because the landing was inside it (live mode reveals). */
  revealed: boolean;
}

class LivePreviewPluginValue {
  decorations: DecorationSet;
  hidden: DecorationSet;

  /** No view: only `compute` is used (the landing verdict, `inlineLanding`). */
  constructor(view?: EditorView) {
    const { decorations, hidden } = view ? this.build(view) : { decorations: Decoration.none, hidden: Decoration.none };
    this.decorations = decorations;
    this.hidden = hidden;
  }

  update(update: ViewUpdate) {
    // 2.8: freeze decoration rebuilds during IME composition — only remap.
    if (update.view.composing) {
      this.decorations = this.decorations.map(update.changes);
      this.hidden = this.hidden.map(update.changes);
      return;
    }
    const treeChanged = treeGrew(update);
    const configChanged =
      update.startState.facet(livePreviewConfig) !== update.state.facet(livePreviewConfig);
    const refChanged =
      update.startState.field(expandedRefField, false) !==
      update.state.field(expandedRefField, false);
    // The Temml converter finished loading — rebuild so math swaps source→formula.
    const mathReady = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(mathReadyEffect)),
    );
    // The host asked for images to be resolved again (`refreshImages`).
    const imagesRefreshed = imageEpoch(update.startState) !== imageEpoch(update.state);
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      treeChanged ||
      configChanged ||
      refChanged ||
      mathReady ||
      imagesRefreshed
    ) {
      const { decorations, hidden } = this.build(update.view);
      this.decorations = decorations;
      this.hidden = hidden;
    }
  }

  build(view: EditorView): BuildResult {
    // B (compute) sample for the keystroke probe — a single constant branch
    // when the probe is off (spec: 探针默认零常驻开销).
    const t0 = perfProbeEnabled ? performance.now() : 0;
    const result = this.compute(view.state, view.visibleRanges);
    if (perfProbeEnabled) recordBuildMs(performance.now() - t0);
    return result;
  }

  /**
   * The decorations for `state` over `ranges` — pure (no view), so the landing
   * verdict reads the very decorations the plugin draws (`inlineLanding`).
   */
  compute(state: EditorState, ranges: readonly { from: number; to: number }[]): BuildResult {
    const config = state.facet(livePreviewConfig);
    const deco: Range<Decoration>[] = [];
    const hiddenRanges: Range<Decoration>[] = [];
    let revealed = false;

    const touches = (from: number, to: number) => {
      if (!config.revealOnSelection) return false;
      return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
    };

    // The one funnel every inline hide goes through. The landing is never
    // hidden (spec: caret-rules / 落点看得见): where the mode reveals, the hide
    // is skipped (outcome 1); where it does not (Reading), `standIn` — the
    // visible thing standing for the hidden range, by default the replacing
    // widget itself — is marked as the landing (outcome 3).
    const conceal = (from: number, to: number, decoration: Decoration = hide, standIn?: { from: number; to: number }) => {
      if (from >= to) return;
      if (landingInside(state, from, to, WITHIN)) {
        // Reveal only for a landing strictly inside: one that merely equals the
        // range (a drag edge-to-edge over a long URL) keeps the chip, marked.
        if (config.revealOnSelection && landingInside(state, from, to)) {
          revealed = true;
          return;
        }
        const s = standIn ?? { from, to };
        deco.push(landingMark.range(s.from, s.to));
      }
      deco.push(decoration.range(from, to));
      if (decoration === hide || decoration.spec.widget) {
        hiddenRanges.push(hide.range(from, to));
      }
    };

    // Which bracket pairs are links: the one predicate over the reference
    // definitions the tree has reached (`linkRefs.ts`; memoised per tree).
    const read: SourceReader = (a, b) => state.sliceDoc(a, b);
    const links = { read, labels: referenceLabels(progressiveTree(state), read) };
    for (const { from, to } of ranges) {
      progressiveTree(state).iterate({
        from,
        to,
        enter: (node) => this.enterNode(node, state, config, touches, conceal, deco, links),
      });
      this.decorateAgentTokens(state, from, to, deco);
      // Every container line's left inset — quote bars, list markers, code
      // fills — from one composer over the line's container stack (change:
      // editor-insets). A per-line pass: a line's geometry depends on ALL its
      // containers at once, which a per-node visit cannot see.
      decorateInsets(state, from, to, deco);
    }

    deco.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
    hiddenRanges.sort((a, b) => a.from - b.from);
    return {
      decorations: Decoration.set(deco, true),
      hidden: Decoration.set(hiddenRanges, true),
      revealed,
    };
  }

  enterNode(
    node: SyntaxNodeRef,
    state: EditorState,
    config: LivePreviewConfig,
    touches: (from: number, to: number) => boolean,
    conceal: (from: number, to: number, d?: Decoration, standIn?: { from: number; to: number }) => void,
    deco: Range<Decoration>[],
    links: { read: SourceReader; labels: ReferenceLabels },
  ): boolean | void {
    const name = node.name;

    // --- link brackets: hidden only when the pair IS a link (spec:
    // 方括号是否成链接只有一个判定) — `[!FOOBAR]` and an undefined `[foo]` keep theirs.
    if (name === "LinkMark") {
      const parent = node.node.parent;
      if (!parent || touches(parent.from, parent.to)) return;
      if (linkMarkConcealable(node.node, links.read, links.labels)) conceal(node.from, node.to);
      return;
    }

    // --- formatting marks: hide when the enclosing element is untouched ---
    if (FORMATTING_MARKS.has(name)) {
      const parent = node.node.parent;
      if (!parent) return;
      const revealed = touches(parent.from, parent.to);
      if (revealed) return;
      let to = node.to;
      // For `# heading` / `> quote` also hide the following space.
      if (
        (name === "HeaderMark" || name === "QuoteMark") &&
        state.sliceDoc(to, to + 1) === " "
      ) {
        to += 1;
      }
      conceal(node.from, to, hide, parent);
      return;
    }

    switch (name) {
      case "InlineCode": {
        deco.push(Decoration.mark({ class: "om-inline-code" }).range(node.from, node.to));
        return;
      }

      case "InlineMath": {
        // Reveal source when touched (same contract as every other mark).
        if (touches(node.from, node.to)) return;
        // Not loaded yet → the one placeholder, as wide as the source, one
        // line tall (change: render-placeholder-size; the block-math entry's
        // driver loads the converter). Load failed → source, unmarked. Invalid
        // TeX → source with the failure mark, through the one wrapper (change:
        // block-fallback, design D3).
        const source = state.sliceDoc(node.from, node.to);
        const out = attemptRender(() => renderFormula(mathBody(source), false));
        if (out.kind === "pending") {
          const widget = new PendingWidget("inline", node.from, reservedSize({}), undefined, source);
          conceal(node.from, node.to, Decoration.replace({ widget }));
          return;
        }
        if (out.kind === "failed") deco.push(failedSourceMark(node.from, node.to, out.reason));
        if (out.kind !== "rendered") return;
        conceal(
          node.from,
          node.to,
          Decoration.replace({ widget: new InlineMathWidget(out.value, node.from) }),
        );
        return;
      }

      case "Link": {
        const n = node.node;
        // Not a link (no URL, no defined reference): text, shown as written.
        if (!isLink(n, links.read, links.labels)) return;
        const url = childrenOf(n).find((c) => c.name === "URL");
        const revealed = touches(node.from, node.to);
        if (revealed) {
          // Touched: source is revealed. A long URL would blow up the line, so
          // collapse just the `(url "title")` span into a chip and leave the
          // link text as editable source (spec: 长链接触碰不炸开).
          if (url) this.maybeChipUrl(node, url, state, config, conceal);
          deco.push(Decoration.mark({ class: "om-link" }).range(node.from, node.to));
          return;
        }
        // Not revealed. An empty-text link `[](url)` would hide every part
        // (marks + url) and render blank, so replace the whole link with a
        // label derived from the URL (spec: 空文本链接不渲染为空白). Return
        // false so the LinkMark children aren't also concealed (no overlap).
        if (url && linkTextIsEmpty(node.from, url.from)) {
          conceal(
            node.from,
            node.to,
            Decoration.replace({
              widget: new LinkLabelWidget(chipLabel(state.sliceDoc(url.from, url.to))),
            }),
          );
          return false;
        }
        // Hide `(url "title")` — everything from closing ] onward is
        // LinkMark/URL/LinkTitle children; LinkMarks are handled above
        // (`linkMarkConcealable`), URL + title here — and the `[r]` / `[]` of a
        // reference link, so `[a][r]` reads `a` as the HTML render does.
        for (const child of childrenOf(n)) {
          if (child.name === "URL" || child.name === "LinkTitle" || child.name === "LinkLabel") {
            conceal(child.from, child.to, hide, node);
          }
        }
        deco.push(Decoration.mark({ class: "om-link" }).range(node.from, node.to));
        return;
      }

      case "Image": {
        const n = node.node;
        const url = childrenOf(n).find((c) => c.name === "URL");
        if (!url) return;
        if (touches(node.from, node.to)) {
          // Touched: reveal source, chipping a long URL like links do.
          this.maybeChipUrl(node, url, state, config, conceal);
          return;
        }
        const src = config.resolveImage(state.sliceDoc(url.from, url.to));
        // null = local path outside the asset whitelist / unresolvable → show
        // source rather than a broken image (spec: 白名单外路径降级).
        if (src == null) return;
        conceal(
          node.from,
          node.to,
          // Opaque and still rendered under a selection in reading mode, so it
          // shows its selected state the way blocks do (spec: 选区只有一种画法).
          Decoration.replace({
            widget: withSelectedState(
              new ImageWidget(src, imageLabelOf(state, n)),
              coveredBySelection(state, node.from, node.to),
              "inline",
            ),
          }),
        );
        return false;
      }

      case "Blockquote": {
        const firstLine = state.doc.lineAt(node.from);
        const first = firstLine.number;
        const last = state.doc.lineAt(node.to).number;
        // A blockquote whose first content line is exactly `[!TYPE]` renders as a
        // GitHub callout (change: callout-rendering). The text after THIS quote's
        // own `>` is read through the container prefix (`insets/stack.ts`), the
        // same reading the inset composer uses to draw its bar and tint — so a
        // callout nested in a list or another quote is recognised by both alike.
        const callout = calloutOf(state, node.node);
        if (callout) {
          const type = callout.type;
          for (let l = first; l <= last; l++) {
            const cls =
              "om-callout-line om-callout-" +
              type +
              (l === first ? " om-callout-first" : "") +
              (l === last ? " om-callout-last" : "");
            deco.push(Decoration.line({ class: cls }).range(state.doc.line(l).from));
          }
          // Replace the `[!TYPE]` marker with an icon+title header, unless the
          // FIRST line is touched — then it reveals as editable source (spec:
          // 光标进入 callout 首行范围时 marker 展开). Keyed on the first line, NOT
          // the whole callout: the header widget lives on line 1, so toggling it
          // from a cursor on a *body* line means CM6 must re-render a replace
          // widget on a non-cursor line — which it fails to do (the header renders
          // empty). Tying the toggle to line 1's own cursor matches the working
          // path (like a ListMark, whose marker shares its item's line). Body lines
          // stay line-decorated (not replaced), so they remain editable throughout.
          // The marker ends after its fold suffix (`[!note]-`), so the suffix is
          // replaced and revealed together with `[!TYPE]` (change: callout-suffix).
          if (!touches(firstLine.from, firstLine.to)) {
            conceal(callout.from, callout.markerTo, Decoration.replace({ widget: new CalloutHeaderWidget(type) }));
          }
          return;
        }
        for (let l = first; l <= last; l++) {
          deco.push(
            Decoration.line({ class: "om-blockquote-line" }).range(state.doc.line(l).from),
          );
        }
        return;
      }

      case "FencedCode": {
        const first = state.doc.lineAt(node.from).number;
        const last = state.doc.lineAt(node.to).number;
        for (let l = first; l <= last; l++) {
          const cls =
            "om-codeblock-line" +
            (l === first ? " om-codeblock-first" : "") +
            (l === last ? " om-codeblock-last" : "");
          deco.push(Decoration.line({ class: cls }).range(state.doc.line(l).from));
        }
        // Copy control, overlaid at the block's top-right (change: codeblock-polish).
        // A point widget at the block start renders inside the first line (which
        // `.om-codeblock-first` makes position:relative); it's absolute-positioned
        // so it never pushes code text. side:-1 keeps it left of the ``` text.
        deco.push(
          Decoration.widget({
            widget: new CopyButtonWidget(codeBlockBody(state.sliceDoc(node.from, node.to))),
            side: -1,
          }).range(node.from),
        );
        return;
      }

      case "HorizontalRule": {
        if (touches(node.from, node.to)) return;
        conceal(node.from, node.to, Decoration.replace({ widget: new HrWidget() }));
        return false;
      }

      case "ListMark": {
        const item = node.node.parent; // ListItem
        if (!item) return;
        const standIn = listMarkStandIn(item);
        if (standIn === null) {
          deco.push(Decoration.mark({ class: "om-list-mark" }).range(node.from, node.to));
          return;
        }
        // Revealed with its line, like every mark: the source `- ` / `- [ ] ` shows.
        const line = state.doc.lineAt(node.from);
        if (touches(line.from, line.to)) {
          deco.push(Decoration.mark({ class: "om-list-mark" }).range(node.from, node.to));
          return;
        }
        // A task item's checkbox is its marker: the `-` is concealed with no
        // widget, so the checkbox draws where the bullet was.
        conceal(node.from, node.to, standIn ? Decoration.replace({ widget: new BulletWidget() }) : Decoration.replace({}));
        return;
      }

      case "TaskMarker": {
        const line = state.doc.lineAt(node.from);
        if (touches(line.from, line.to)) return;
        const checked = /x/i.test(state.sliceDoc(node.from, node.to));
        conceal(
          node.from,
          // Also consume the space after the marker.
          state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to,
          Decoration.replace({ widget: new CheckboxWidget(checked, node.from, node.to) }),
        );
        // Strike through the completed task's text.
        if (checked) {
          const taskEnd = node.node.parent?.to ?? line.to;
          if (node.to + 1 < taskEnd) {
            deco.push(Decoration.mark({ class: "om-task-done" }).range(node.to + 1, taskEnd));
          }
        }
        return;
      }

    }
  }

  /**
   * Color `@agent` addressing tokens with the provenance color (spec:
   * live-preview-editor / `@agent` 出处色渲染). Plain text — no lezer node — so
   * this is a conservative text scan over the visible lines (`matchAgentTokens`).
   * Pure decoration: it only colors, never conceals, so these ranges are NOT
   * pushed to `hiddenRanges` and the disk text stays plain GFM `@agent`. Source
   * mode drops the whole livePreview plugin, so it never colors there.
   */
  decorateAgentTokens(
    state: EditorState,
    from: number,
    to: number,
    deco: Range<Decoration>[],
  ): void {
    const startLine = state.doc.lineAt(from).number;
    const endLine = state.doc.lineAt(to).number;
    for (let n = startLine; n <= endLine; n++) {
      const line = state.doc.line(n);
      for (const tok of matchAgentTokens(line.text)) {
        deco.push(agentMark.range(line.from + tok.from, line.from + tok.to));
      }
    }
  }

  /**
   * When a touched link/image has a long URL, conceal its `(url "title")` span
   * into an atomic chip instead of spilling the source. No-op for short URLs
   * (short links reveal normally — spec: 短链接照常展开) or while this reference
   * is force-expanded for editing (clicked chip).
   */
  maybeChipUrl(
    node: SyntaxNodeRef,
    url: SyntaxNode,
    state: EditorState,
    config: LivePreviewConfig,
    conceal: (from: number, to: number, d?: Decoration, standIn?: { from: number; to: number }) => void,
  ): void {
    const urlText = state.sliceDoc(url.from, url.to);
    const threshold = config.chipThreshold ?? DEFAULT_CHIP_THRESHOLD;
    if (!shouldConcealUrl(urlText, threshold)) return;
    if (isRefExpanded(state.field(expandedRefField, false), node.from)) return;
    // The `(` sits immediately before the URL; `)` immediately before node.to.
    const openParen = url.from - 1;
    if (openParen < node.from) return;
    conceal(
      openParen,
      node.to,
      Decoration.replace({
        widget: new UrlChipWidget(node.from, node.to, url.from, chipLabel(urlText)),
      }),
    );
  }
}

// `linkTextIsEmpty` and the FORMATTING_MARKS set now live in `previewConceal.ts`,
// shared with the reading-mode copy path so the two cannot disagree about what is
// hidden. Re-exported here so existing importers (and their tests) are unaffected.
export { linkTextIsEmpty } from "./previewConceal";


function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    result.push(child);
  }
  return result;
}

const inlinePreviewPlugin = ViewPlugin.fromClass(LivePreviewPluginValue, {
  decorations: (v) => v.decorations,
  provide: (plugin) =>
    EditorView.atomicRanges.of(
      (view) => view.plugin(plugin)?.hidden ?? RangeSet.empty,
    ),
  eventHandlers: {
    mousedown(event, view) {
      // Cmd/Ctrl+click follows a link; in reading mode a plain click does too
      // (`clickFollowsLink`). Otherwise a plain click keeps "drop the cursor to
      // edit" (design D1) — let CodeMirror handle it.
      if (!clickFollowsLink(event.metaKey || event.ctrlKey, view.state.readOnly)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      let node: SyntaxNode | null = treeUpTo(view.state, pos).resolveInner(pos, 0);
      while (node && node.name !== "Link" && node.name !== "URL" && node.name !== "Autolink") {
        node = node.parent;
      }
      if (!node) return false;
      const href =
        node.name === "Link"
          ? childrenOf(node)
              .filter((c) => c.name === "URL")
              .map((c) => view.state.sliceDoc(c.from, c.to))[0]
          : view.state.sliceDoc(node.from, node.to).replace(/^<|>$/g, "");
      if (!href) return false;
      followLink(view, href);
      // The click landed on a link — consume it so CodeMirror doesn't
      // also drop the cursor there, whichever branch handled it.
      return true;
    },
  },
});

/**
 * The inline preview's answer to "how is the landing shown" (spec: caret-rules /
 * 落点看得见; `landingShownBy` in `caret.ts`), read off the decorations the
 * plugin itself builds for the landing's lines — not off the funnel's decision,
 * so a hide that skipped the funnel is caught too (gate: landing.gate.test.ts
 * G2). A replacing decoration the landing is inside: `marked` when the landing
 * mark covers it, else `hidden`. None: `revealed` when the funnel skipped one.
 * Decorations flagged `landingExempt` (indent whitespace, `insets/decorate.ts`)
 * are not hiding paths.
 */
export function inlineLanding(state: EditorState): LandingShown | null {
  const sel = state.selection.main;
  const range = { from: state.doc.lineAt(sel.from).from, to: state.doc.lineAt(sel.to).to };
  const built = new LivePreviewPluginValue().compute(state, [range]);
  return landingIn(state, built.decorations, range, built.revealed);
}

/**
 * The verdict over a built decoration set (pure; `inlineLanding`): each hide
 * holding the landing must be covered by a landing mark (its stand-in), else
 * it is `hidden`.
 */
export function landingIn(
  state: EditorState,
  set: DecorationSet,
  range: { from: number; to: number },
  revealed: boolean,
): LandingShown | null {
  const marks: { from: number; to: number }[] = [];
  const hides: { from: number; to: number }[] = [];
  set.between(range.from, range.to, (from, to, d) => {
    if (d.spec.class === LANDING_CLASS) marks.push({ from, to });
    else if (d.point && from < to && !d.spec.landingExempt && landingInside(state, from, to, WITHIN)) hides.push({ from, to });
  });
  if (hides.length === 0) return revealed ? "revealed" : null;
  const covered = (h: { from: number; to: number }) => marks.some((m) => m.from <= h.from && h.to <= m.to);
  return hides.every(covered) ? "marked" : "hidden";
}

const previewCore = [
  inlinePreviewPlugin,
  blockDecorationField,
  expandedRefField,
  imageEpochField,
  landingHiders.of(inlineLanding),
];
// Part editors nested in blocks render with the same preview, handed down via a
// facet: they sit below this module (see `nestedPreview` in blocks/nested.ts).
export const livePreview = [...previewCore, nestedPreview.of(previewCore)];

// Moved to ./agentMention (change: render-export) so the HTML renderer reads the
// same matcher without loading this plugin; re-exported for existing callers.
export { matchAgentTokens };
