import { EditorView, WidgetType } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import {
  CELL_SYNC_USER_EVENT,
  cellEditChange,
  parseTable,
  tableArrowNav,
  tableGridNav,
  tableCellInsert,
  type Align,
} from "./tableEdit";
import { activeEditField, cellSync, setActiveEdit } from "./tableInlineEdit";
import { historyKeyOf } from "./historyKey";
import { tableRangeAt } from "./tableCommands";
import { renderInlineCell } from "./inlineCell";
import { loadMathThenRedraw } from "./mathLoad";
import { tableClickAction } from "./tableClick";
import { followLink } from "./linkNavigate";
import { exitBlock } from "./blocks/exit";
import { lineAfterBlock } from "./blocks/geometry";
import { buildPartEditor, partEditorIn, reseedPart } from "./blocks/partEditor";
import { BULLET_GLYPH } from "./previewConceal";
import { editorString } from "./strings";
import type { ImageLabel } from "./imageAlt";
import { imageElement } from "./imageElement";
import { setMarkup, type SafeMarkup } from "./markup";
import { livePreviewConfig } from "./previewConfig";
import { editorEnvironment } from "./environment";
import { CalloutType, calloutTitle } from "./callout";
import { contentMarkSvg, editorIconButton, type EditorGlyph } from "./controls";

/** Replaces the `- ` bullet of an unordered list item. */
export class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "om-list-mark";
    span.textContent = BULLET_GLYPH;
    return span;
  }
}

/**
 * The edit a checkbox click makes: only the three bytes of the `[ ]` / `[x]`
 * marker (the TaskMarker node) change, nothing around it (spec: editor-fidelity;
 * pinned in `fidelity.gate.test.ts`). Pure.
 */
export function taskToggleChange(checked: boolean, from: number, to: number): { from: number; to: number; insert: string } {
  return { from, to, insert: checked ? "[ ]" : "[x]" };
}

/** Interactive checkbox replacing a `[x]` / `[ ]` task marker. */
export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly markerFrom: number,
    readonly markerTo: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.markerFrom === this.markerFrom;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "om-checkbox";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      // Intentionally no readOnly check: in reading mode the checkbox is the
      // one interactive control (markdown-as-form) — the programmatic dispatch
      // below is not blocked by the readOnly facet, which only gates commands
      // and input handlers.
      view.dispatch({
        changes: taskToggleChange(this.checked, this.markerFrom, this.markerTo),
        userEvent: "input",
      });
    });
    return box;
  }
  ignoreEvent(event: Event) {
    return event.type === "click" || event.type === "mousedown";
  }
}

/** Rendered horizontal rule replacing `---`. */
export class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "om-hr-widget";
    span.appendChild(document.createElement("hr"));
    return span;
  }
}

/**
 * Rendered math (change: code-highlight-and-math). Both widgets receive a MathML
 * string already produced by the (loaded) Temml converter — a math node whose
 * converter hasn't loaded is never replaced, and one whose TeX is invalid makes
 * the converter throw, which `attemptRender` (`blocks/render.ts`) turns into the
 * source with the failure mark; so `mathml` here is always real MathML, already
 * through the one sanitising sink (`markup.ts` — change: editor-untrusted-content).
 */
export class BlockMathWidget extends WidgetType {
  constructor(
    readonly mathml: SafeMarkup,
    readonly from: number,
  ) {
    super();
  }
  eq(other: BlockMathWidget) {
    return other.mathml === this.mathml && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "om-math-block";
    setMarkup(wrap, this.mathml, view);
    return clickRevealsSource(wrap, view, this.from);
  }
  ignoreEvent(event: Event) {
    return event.type === "mousedown";
  }
}

/**
 * An A block's rendered body (block math, a mermaid diagram): own the mousedown
 * so a click drops the caret at the block's start, which the A reveal then
 * expands into source — the replaced range is atomic, so CM's default click
 * cannot place the caret (mirrors TableWidget). Pair with an `ignoreEvent` that
 * claims "mousedown".
 */
function clickRevealsSource(wrap: HTMLElement, view: EditorView, from: number): HTMLElement {
  wrap.addEventListener("mousedown", (e) => {
    e.preventDefault();
    view.dispatch({ selection: { anchor: from } });
    view.focus();
  });
  return wrap;
}

/**
 * A rendered mermaid diagram — A (change: editor-mermaid). `svg` already went
 * through the editor's one HTML sink (`mermaidMarkup` in `./markup.ts`: no
 * links, handlers, foreign islands or remote `url()`, scoped CSS only); a click
 * reveals the fence's source.
 */
export class MermaidWidget extends WidgetType {
  constructor(
    readonly svg: SafeMarkup,
    readonly from: number,
  ) {
    super();
  }
  eq(other: MermaidWidget) {
    return other.svg === this.svg && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "om-mermaid";
    setMarkup(wrap, this.svg, view);
    return clickRevealsSource(wrap, view, this.from);
  }
  ignoreEvent(event: Event) {
    return event.type === "mousedown";
  }
  /** The SVG's own height (its viewBox), for CM's estimate while off-screen. */
  get estimatedHeight(): number {
    const m = /viewBox="[-\d.e]+ [-\d.e]+ [-\d.e]+ ([\d.e]+)"/.exec(this.svg);
    return m ? Math.ceil(Number(m[1])) : -1;
  }
}

export class InlineMathWidget extends WidgetType {
  constructor(
    readonly mathml: SafeMarkup,
    readonly from: number,
  ) {
    super();
  }
  eq(other: InlineMathWidget) {
    return other.mathml === this.mathml && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = "om-math-inline";
    setMarkup(span, this.mathml, view);
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return span;
  }
  ignoreEvent(event: Event) {
    return event.type === "mousedown";
  }
}

/**
 * Display-only label shown in place of an empty-text link `[](url)` so it never
 * renders blank (spec: 空文本链接不渲染为空白). Muted, to read as "no name here,
 * showing the target". Purely visual — `ignoreEvent` false lets clicks fall
 * through to CodeMirror, so a plain click reveals the source and Cmd/Ctrl+click
 * still routes via the link's URL.
 */
export class LinkLabelWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: LinkLabelWidget) {
    return other.label === this.label;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "om-link-fallback";
    span.textContent = this.label;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

/**
 * Inline image replacing `![alt](src)`; alt and size come from the one reading
 * (`imageAlt.ts`), the element from the one factory (`imageElement.ts`).
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly label: ImageLabel,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    // The size is part of what is drawn: without it an agent's `|120` → `|200`
    // would keep the old DOM (design, Context 5).
    return (
      other.src === this.src &&
      other.label.alt === this.label.alt &&
      other.label.width === this.label.width &&
      other.label.height === this.label.height
    );
  }
  toDOM() {
    return imageElement(this.src, this.label);
  }
}

/**
 * Rendered table replacing the whole markdown table block (change:
 * table-inline-cell-editing). Built from the shared `parseTable` model: header vs
 * data rows distinguished, per-column alignment from the delimiter row, cell
 * content rendered as styled inline markdown (`renderInlineCell`).
 *
 * Interaction: clicking a cell edits THAT cell in place — it becomes a single-line
 * part editor (`blocks/partEditor.ts`) seeded with the cell's raw markdown, while the rest of the grid stays
 * rendered (spec: 单元格原位编辑); the whole table no longer reverts to pipe
 * source. `editing` names the cell in edit; `eq` keys on it so per-keystroke sync
 * transactions preserve this DOM (focus + IME survive — design D3). Nav / exit go
 * through `activeEditField` effects; column reflow is deferred to session end.
 */
/** Plain arrow keys only — a modifier means a selection or word move, not a cell switch. */
function arrowDir(e: KeyboardEvent): "up" | "down" | "left" | "right" | null {
  if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return null;
  return e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : null;
}

/**
 * Is the caret already at the edge of its cell in this direction? ↑ / ↓: on the
 * first / last VISUAL line (a wrapped cell has several), i.e. on the same visual
 * line as the cell's start / end. Read straight off the DOM rects rather than via
 * `moveVertically`, which leans on CodeMirror's measured line height — stale or
 * unmeasured in a just-built nested editor, and never measured at all in a
 * backgrounded tab (it reported "already at the edge" from the last line).
 * ← / →: at the source start / end.
 */
function atCellEdge(part: EditorView, dir: "up" | "down" | "left" | "right"): boolean {
  const sel = part.state.selection.main;
  if (!sel.empty) return false;
  const end = part.state.doc.length;
  if (dir === "left") return sel.head === 0;
  if (dir === "right") return sel.head === end;
  const here = part.coordsAtPos(sel.head);
  const edge = part.coordsAtPos(dir === "up" ? 0 : end);
  if (!here || !edge) return true;
  return Math.abs(here.top - edge.top) < 2;
}

export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    /**
     * Cell being edited in place within THIS table, or null. `epoch` counts doc
     * changes the cell's own editor did NOT make — it is what makes this widget
     * unequal (and so re-seeds the cell editor) after an undo / agent edit / external
     * sync, while leaving per-keystroke typing equal. See `activeEditField`.
     */
    readonly editing: { row: number; col: number; epoch: number } | null = null,
    /**
     * Was the formula converter loaded when this was built? A cell formula shows
     * its source until it is; the load's rebuild then differs here, so the table
     * redraws with the formula (change: cell-tree, design D5).
     */
    readonly mathReady = false,
    /** The image epoch it was built at (`imageRefresh.ts`): a refresh redraws the table's images. */
    readonly imageEpoch = 0,
  ) {
    super();
  }
  eq(other: TableWidget) {
    if (this.editing || other.editing) {
      // In an edit session: keep the SAME DOM across same-cell per-keystroke sync
      // so the cell editor (and its focus / IME composition) survives — source churn
      // during typing is ignored on purpose. Only a cell switch or session end
      // (the `editing` shape changes) rebuilds. Keyed on the table start + cell.
      return (
        this.from === other.from &&
        this.editing?.row === other.editing?.row &&
        this.editing?.col === other.editing?.col &&
        this.editing?.epoch === other.editing?.epoch
      );
    }
    return (
      other.source === this.source &&
      other.from === this.from &&
      other.mathReady === this.mathReady &&
      other.imageEpoch === this.imageEpoch
    );
  }
  toDOM(view: EditorView) {
    // Wrapper carries the block's vertical spacing as PADDING — inside the
    // border-box CodeMirror measures — instead of `margin` on the table. A block
    // widget's margin sits OUTSIDE the measured box, so CM under-measures the
    // block's height and every coordinate click below it drifts down, cumulatively
    // (change: live-preview-widget-click-offset; CM6 known trap).
    const wrap = document.createElement("div");
    wrap.className = "om-table-wrap";
    const table = document.createElement("table");
    table.className = "om-table";
    wrap.appendChild(table);
    const model = parseTable(this.source, this.from);
    // buildBlockDecorations only builds this widget for parseable tables, but
    // degrade defensively: put a single cell with the raw source rather than
    // throw (spec: 畸形表降级为源码 — never swallow content).
    if (!model) {
      const tr = table.insertRow();
      tr.insertCell().textContent = this.source;
      return wrap;
    }
    const editable = !view.state.readOnly;
    // Cell images resolve like body images: same whitelist, same config.
    const { resolveImage } = view.state.facet(livePreviewConfig);
    // A cell formula met the converter not loaded: load it, then redraw.
    const requestMath = () => loadMathThenRedraw(view);

    model.rows.forEach((row, ri) => {
      const isHeader = ri === 0;
      const tr = document.createElement("tr");
      row.cells.forEach((cell, ci) => {
        const el = document.createElement(isHeader ? "th" : "td");
        const align = model.aligns[ci];
        if (align && align !== "none") el.style.textAlign = align;
        el.dataset.omRow = String(ri);
        el.dataset.omCol = String(ci);
        if (editable && this.editing && this.editing.row === ri && this.editing.col === ci) {
          // The cell being edited is the CURRENT item: declared, and drawn by
          // `.ome-state` as the neutral selected fill (no --primary tint — the
          // caret already says "a person is typing here").
          el.classList.add("om-table-cell-editing", "ome-state");
          el.dataset.selected = "true";
          el.appendChild(this.buildCellEditor(view, cell.text, ri, ci, align));
        } else {
          // Inline markdown rendered as styled DOM (detached — CM6 decorations
          // can't reach here, hence the standalone renderer).
          el.appendChild(renderInlineCell(cell.text, resolveImage, requestMath));
        }
        tr.appendChild(el);
      });
      table.appendChild(tr);
    });

    // What a click inside the table means is decided by `tableClickAction` — a
    // pure function so the branch ORDER is unit-tested (this listener is only its
    // adapter: read the inputs off the event, perform the verdict). Order matters:
    // Cmd/Ctrl+click on a cell link navigates FIRST, above the read-only gate, so
    // table links work in reading mode too (change: table-cell-link-navigation).
    // Clicks on the scrollbar / borders / padding gap are left alone (NO
    // preventDefault) so a wide table's horizontal scrollbar stays grabbable
    // (spec: 宽表横向滚动); a click inside the active input positions its own caret.
    wrap.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      const linkEl = target.closest("[data-om-href]") as HTMLElement | null;
      const cellEl = target.closest("th,td") as HTMLElement | null;
      const action = tableClickAction({
        modifier: e.metaKey || e.ctrlKey,
        linkHref: linkEl?.dataset.omHref ?? null,
        inActiveInput: !!target.closest(".om-table-cell-input"),
        cell: cellEl
          ? { row: Number(cellEl.dataset.omRow), col: Number(cellEl.dataset.omCol) }
          : null,
        readOnly: view.state.readOnly,
      });
      if (action.kind === "none") return;
      e.preventDefault();
      if (action.kind === "navigate") {
        followLink(view, action.href);
        return;
      }
      view.dispatch({
        effects: setActiveEdit.of({
          tableFrom: this.from,
          row: action.row,
          col: action.col,
        }),
      });
    });
    return wrap;
  }

  /**
   * Re-seed the open cell editor from the document instead of rebuilding the DOM
   * (change: table-cell-edit-undo / design D4).
   *
   * Reached only when `eq` said no — during a session that means the epoch moved,
   * i.e. something other than this cell rewrote the document. Rebuilding here
   * would destroy the cell editor mid-session and take focus + IME composition
   * with it (the very thing `eq` exists to prevent), so it is re-seeded in place
   * and `true` returned to keep the DOM.
   *
   * The old widget instance isn't handed to us, so "is this still the same cell?"
   * is read off the DOM. Anything else — session ended, different cell, cell gone —
   * returns false and lets CodeMirror rebuild normally.
   *
   * The table's OTHER cells are deliberately not re-rendered: they are equally
   * stale during ordinary typing (that is design D3), and session end re-renders
   * the whole table anyway. Touching them here would mean re-parenting the live
   * editor, which is exactly how focus gets lost.
   */
  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const cell = this.editing;
    if (!cell) return false;
    const part = partEditorIn(dom);
    const host = part?.dom.closest("th,td") as HTMLElement | null;
    if (!part || !host) return false;
    if (Number(host.dataset.omRow) !== cell.row || Number(host.dataset.omCol) !== cell.col) {
      return false;
    }
    const text = parseTable(this.source, this.from)?.rows[cell.row]?.cells[cell.col]?.text;
    if (text === undefined) return false; // the cell no longer exists
    reseedPart(part, text);
    return true;
  }

  destroy(dom: HTMLElement) {
    partEditorIn(dom)?.destroy();
  }

  /**
   * The editor for one cell (change: table-cell-editor; spec: 单元格原位编辑): a
   * part editor (`blocks/partEditor.ts`) seeded with the cell's markdown and
   * rendered with the document's own live preview, so the cell looks the same
   * while you edit it and wraps inside the cell's width. Each keystroke replaces
   * just that cell's content span in the doc (no reflow — deferred to session
   * end). The cell's source range is re-derived from the document on EVERY sync
   * rather than cached: a cached offset goes stale the moment anything else edits
   * the doc, and the next write then runs past the cell's pipes and swallows its
   * neighbour (change: table-cell-edit-undo / design D3).
   */
  private buildCellEditor(view: EditorView, text: string, row: number, col: number, align: Align) {
    const caret = view.state.field(activeEditField, false)?.caret;
    const host = buildPartEditor(
      view,
      text,
      {
        sync: (value) => {
          // Locate the cell fresh: `activeEditField` tracks the table through edits
          // that landed above it. Nothing about this cell's position is cached.
          const edit = view.state.field(activeEditField, false);
          const range = tableRangeAt(view.state, edit?.tableFrom ?? this.from);
          const parsed = range ? parseTable(view.state.sliceDoc(range.from, range.to), range.from) : null;
          const change = parsed ? cellEditChange(parsed, row, col, value) : null;
          if (!change) {
            // The table or the cell is gone underneath us — end the session rather
            // than write at a guessed offset.
            view.dispatch({ effects: setActiveEdit.of(null) });
            return;
          }
          view.dispatch({
            changes: change,
            // MUST stay joinable or every keystroke becomes its own undo step; and
            // `cellSync` tells `activeEditField` this change is ours, so it does not
            // bump the epoch and re-seed the editor we are typing into.
            userEvent: CELL_SYNC_USER_EVENT,
            annotations: cellSync.of(true),
          });
        },
        onKey: (e, part) => this.onCellKey(e, view, part, row, col),
      },
      { accept: tableCellInsert, caret },
    );
    if (align && align !== "none") host.style.textAlign = align;
    return host;
  }

  /**
   * Keys the table owns while a cell is being edited: undo / redo (to the
   * document), Esc, Tab / Shift-Tab / Enter navigation, and arrows at a cell's
   * edge (spec: 格内方向键换格). Returns true when handled.
   */
  private onCellKey(e: KeyboardEvent, view: EditorView, part: EditorView, row: number, col: number): boolean {
    // Undo / redo belong to the DOCUMENT, not to this cell (change:
    // table-cell-edit-undo / design D1): the part editor has no history of its
    // own, and `ignoreEvent` keeps CodeMirror's keymap from seeing keys pressed
    // in here, so the commands are invoked directly.
    const history = historyKeyOf(e);
    if (history) {
      e.preventDefault();
      (history === "undo" ? undo : redo)(view);
      return true;
    }
    if (e.key === "Escape") {
      // Esc lands on the line after the table, in view (spec: caret-rules R8a).
      e.preventDefault();
      const range = tableRangeAt(view.state, this.from);
      const anchor = range ? lineAfterBlock(view.state.doc, range.to) : this.from;
      view.dispatch({ effects: setActiveEdit.of(null), selection: { anchor }, scrollIntoView: true });
      view.focus();
      return true;
    }
    // Re-read the CURRENT table from the doc — this.source is the snapshot from
    // cell entry and is stale after live edits.
    const current = () => {
      const range = tableRangeAt(view.state, this.from);
      const p = range ? parseTable(view.state.sliceDoc(range.from, range.to), range.from) : null;
      return range && p ? { range, p } : null;
    };

    const arrow = arrowDir(e);
    if (arrow) {
      if (!atCellEdge(part, arrow)) return false; // ordinary caret move inside the cell
      const t = current();
      if (!t) return false;
      e.preventDefault();
      const nav = tableArrowNav(t.p, row, col, arrow);
      if (nav.kind === "exit") {
        exitBlock(view, t.range, nav.dir, [setActiveEdit.of(null)]);
      } else if (nav.kind === "move") {
        const caret = arrow === "right" ? "start" : "end";
        view.dispatch({ effects: setActiveEdit.of({ tableFrom: this.from, row: nav.row, col: nav.col, caret }) });
      }
      return true; // noop at the table's first / last cell still consumes the key
    }

    const dir = e.key === "Tab" ? (e.shiftKey ? "prev" : "next") : e.key === "Enter" ? "down" : null;
    if (!dir) return false;
    e.preventDefault();
    const t = current();
    if (!t) {
      view.dispatch({ effects: setActiveEdit.of(null) });
      return true;
    }
    const nav = tableGridNav(t.p, row, col, dir);
    if (nav.kind === "noop") return true; // consume (Shift-Tab at the very first cell)
    if (nav.kind === "move") {
      view.dispatch({ effects: setActiveEdit.of({ tableFrom: this.from, row: nav.row, col: nav.col }) });
      return true;
    }
    // expand: append a row and land in it — the change + the cell switch ride one
    // transaction (single undo unit).
    view.dispatch({
      changes: nav.change,
      effects: setActiveEdit.of({ tableFrom: this.from, row: nav.row, col: nav.col }),
      userEvent: "input",
    });
    return true;
  }

  // Own every event inside the widget so CM never fights the cell input (design
  // D3): the widget's own mousedown enters/switches cells, the input's key/compose
  // handlers drive editing + nav; CM's default selection/keymap stay out.
  //
  // This stays unconditional on purpose. Letting keydown through would put the
  // WHOLE keymap behind a caret the user cannot see — Backspace deleting at the
  // document cursor, arrows moving the document selection, Mod-B bolding
  // elsewhere. Keys that genuinely belong to the document are forwarded one by
  // one from `onCellKey` instead (today: undo / redo).
  ignoreEvent() {
    return true;
  }
}


/**
 * Copy control overlaid on a fenced code block's top-right corner (change:
 * codeblock-polish). Absolute-positioned inside the block's first line (styled
 * `position: relative`), so it never pushes the code text; hover reveals it.
 * Click writes the block body through the one clipboard write, which confirms.
 */
export class CopyButtonWidget extends WidgetType {
  constructor(readonly body: string) {
    super();
  }
  eq(other: CopyButtonWidget) {
    return other.body === this.body;
  }
  toDOM() {
    // An md outline icon button from the one factory (change: editor-controls,
    // D5); theme.ts only places it and gives it a --background surface.
    const btn = editorIconButton({ glyph: "copy", size: "md", weight: "outline", title: editorString("widget.copyCode"), className: "om-code-copy" });
    // Keep the click off the document: no cursor drop / selection change.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // The host's clipboard write (spec: editor-host; the app's is its one
      // clipboard write and its one confirmation — change: feedback) — no
      // in-place check-icon swap of its own. No host: the button does nothing.
      void editorEnvironment().copyText?.(this.body);
    });
    return btn;
  }
  ignoreEvent(event: Event) {
    return event.type === "click" || event.type === "mousedown";
  }
}

// The callout types' header marks: icon roles from the one glyph table,
// content marks at the `control` tier scaled with the text (change:
// editor-controls, D4). stroke=currentColor so theme.ts owns the per-type colour.
const CALLOUT_GLYPH: Record<CalloutType, EditorGlyph> = {
  note: "calloutNote",
  tip: "calloutTip",
  important: "calloutImportant",
  warning: "calloutWarning",
  caution: "calloutCaution",
};

/**
 * Header shown in place of the `[!TYPE]` marker on a callout's first line: the
 * type's icon + title (canonical GitHub keyword). Purely visual; the marker
 * reveals as editable source when the callout is touched (livePreview.ts owns
 * the reveal condition). Colored via theme.ts per-type classes (change:
 * callout-rendering).
 */
export class CalloutHeaderWidget extends WidgetType {
  constructor(readonly type: CalloutType) {
    super();
  }
  eq(other: CalloutHeaderWidget) {
    return other.type === this.type;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `om-callout-h om-callout-h-${this.type}`;
    setMarkup(span, contentMarkSvg(CALLOUT_GLYPH[this.type], "control"));
    const label = document.createElement("span");
    label.className = "om-callout-title";
    label.textContent = calloutTitle(this.type);
    span.appendChild(label);
    return span;
  }
}
