import { foldEffect, foldService, foldState, foldedRanges, unfoldEffect } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { editorString } from "./strings";
import { editorIconButton } from "./controls";
import { outlineOf } from "./outline";

/**
 * One foldable ATX heading and its current fold state (change:
 * heading-fold-inline-toggle). Pure data derived from `EditorState` so the
 * "which headings fold / is this one folded" logic is unit-testable without an
 * `EditorView` (which can't be constructed in node — repo convention).
 */
export interface HeadingFold {
  /** Start position of the heading line (where the toggle is anchored). */
  lineFrom: number;
  /** The foldable range (end-of-heading-line → section end), via `headingFoldRange`. */
  range: { from: number; to: number };
  /** Whether this heading's range is currently folded. */
  folded: boolean;
}

/**
 * The range a heading line folds: from the end of its line to the end of its
 * section's last non-blank line — the section of the one heading model
 * (`headingIndex.ts`; change: heading-model), the same span read_section
 * returns, so "what folds" and "what an agent reads" cannot disagree. A line
 * scan: total for any document length, no parse budget. Registered ahead of
 * lang-markdown's `headerIndent`, so it is the one `foldable` asks first.
 */
export function headingFoldRange(
  state: EditorState,
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  const heading = outlineOf(state).find((h) => h.from === lineStart);
  if (!heading) return null;
  let last = state.doc.lineAt(Math.max(heading.from, heading.to - 1));
  while (last.from > lineStart && !/\S/.test(last.text)) last = state.doc.line(last.number - 1);
  return last.to > lineEnd ? { from: lineEnd, to: last.to } : null;
}

/** The heading fold service; `Prec.high` so `foldable` consults it before `headerIndent`. */
export const headingFoldService = Prec.high(foldService.of(headingFoldRange));

/**
 * Every heading of the model whose section has something to fold, with its
 * fold range and whether it is currently folded (design D1).
 */
export function headingFolds(state: EditorState): HeadingFold[] {
  const folded = foldedRanges(state);
  const out: HeadingFold[] = [];
  for (const h of outlineOf(state)) {
    const line = state.doc.lineAt(h.from);
    const range = headingFoldRange(state, line.from, line.to);
    if (!range) continue;
    // Folded iff a folded range STARTS exactly at this heading's fold start
    // (each heading's fold begins at its unique line end). Matching on overlap
    // instead would mislabel a subsection as folded merely because an ancestor
    // heading's fold encloses it.
    let isFolded = false;
    folded.between(range.from, range.from, (from) => {
      if (from === range.from) {
        isFolded = true;
        return false;
      }
    });
    out.push({ lineFrom: line.from, range, folded: isFolded });
  }
  return out;
}

/**
 * Inline fold handle rendered at a heading line's start, hugging the heading
 * (change: heading-fold-inline-toggle) — replaces CodeMirror's left-edge
 * `foldGutter()`. Absolute-positioned inside the heading line (which the
 * `om-fold-heading` line decoration makes `position: relative`), so it never
 * pushes the heading text. Click dispatches a fold/unfold StateEffect — a view
 * op, not a doc edit, so it works in reading mode too. List items reuse it
 * (`listFold.ts`).
 */
/**
 * The fold placeholder `…` (codeFolding's `placeholderDOM`; spec: app-chrome /
 * 折叠占位是文字,不是盒子). Byte-for-byte CodeMirror's default node — the same
 * text, label, tooltip and unfold-on-click — plus the shared state rule, so its
 * hover fill and muted→foreground rise come from the editor's one state
 * primitive (`.ome-state` + `.ome-ink-muted`, ./primitives.ts) like every
 * other control, never from a hover rule in theme.ts.
 */
export function foldPlaceholderDOM(
  view: EditorView,
  onclick: (event: Event) => void,
): HTMLElement {
  const el = document.createElement("span");
  el.textContent = "…";
  el.setAttribute("aria-label", view.state.phrase("folded code"));
  el.dataset.tip = view.state.phrase("unfold");
  el.className = "cm-foldPlaceholder ome-state ome-ink-muted";
  el.onclick = onclick;
  return el;
}

export class FoldToggleWidget extends WidgetType {
  constructor(
    readonly range: { from: number; to: number },
    readonly folded: boolean,
  ) {
    super();
  }
  eq(other: FoldToggleWidget) {
    return (
      other.folded === this.folded &&
      other.range.from === this.range.from &&
      other.range.to === this.range.to
    );
  }
  toDOM(view: EditorView) {
    // An sm ghost icon button from the one factory (change: editor-controls,
    // D5): the ruler's 20px square, its inline-tier chevron, `.ome-state`'s
    // hover. The chevron points ▾ while expanded; theme.ts turns it ▸ when
    // folded, keyed on `aria-expanded` — the state is declared, not drawn.
    // Out of the tab order: the keyboard folds through the fold commands.
    const el = editorIconButton({
      glyph: "chevronDown",
      size: "sm",
      title: editorString(this.folded ? "widget.unfold" : "widget.fold"),
      className: "om-fold-toggle",
      tabIndex: -1,
    });
    el.setAttribute("aria-expanded", String(!this.folded));
    // Keep the click off the document: no cursor drop / selection change.
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        effects: this.folded ? unfoldEffect.of(this.range) : foldEffect.of(this.range),
      });
    });
    return el;
  }
  ignoreEvent(event: Event) {
    return event.type === "click" || event.type === "mousedown";
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const deco: Range<Decoration>[] = [];
  for (const f of headingFolds(view.state)) {
    // Only decorate headings in the rendered viewport (headings are sparse; the
    // per-line filter is cheap).
    if (!view.visibleRanges.some((r) => f.lineFrom >= r.from && f.lineFrom <= r.to)) continue;
    // Line decoration first (lowest sort side), then the point widget — both at
    // the line start; Decoration.set(…, true) sorts them into the required order.
    deco.push(Decoration.line({ class: "om-fold-heading" }).range(f.lineFrom));
    deco.push(
      Decoration.widget({ widget: new FoldToggleWidget(f.range, f.folded), side: -1 }).range(
        f.lineFrom,
      ),
    );
  }
  return Decoration.set(deco, true);
}

/**
 * Editor extension: the inline heading fold handles. Rebuilds when the
 * document, the viewport or the fold state changes (design D4); headings come
 * from the line-scan model, which is never partial. Rides the base config
 * alongside `codeFolding()` so all three modes share one set of handles.
 */
export const headingFoldToggle = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.startState.field(foldState, false) !== u.state.field(foldState, false)
      ) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
