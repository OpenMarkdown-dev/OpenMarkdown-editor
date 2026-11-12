import {
  Annotation,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { editorString } from "../strings";
import { historyKeyOf } from "../historyKey";
import { editorIconButton, editorTextButton } from "../controls";
import { finalizeValue, parseProps, type ParsedProps, type Prop } from "../frontmatterProps";
import { frontmatterRange } from "../headingIndex";
import { exitBlock } from "./exit";
import { lineAfterBlock } from "./geometry";
import { flattenCellInsert } from "../tableEdit";
import { buildPartEditor, partEditorIn, placePartCaret, reseedPart, type PartCaret } from "./partEditor";
import type { BlockEntry } from "./types";

/**
 * Frontmatter as a Properties block — B (change: properties-block; spec:
 * live-preview-editor / Properties 块). One row per top-level property, name |
 * value; clicking a name or value turns just that into a part editor. Edits
 * replace only the bytes of what was edited — the YAML is never re-serialised.
 */

/** The frontmatter text: the block lives in the first 100 lines (parseProps' limit). */
function headText(doc: Text): string {
  const n = Math.min(doc.lines, 100);
  return doc.sliceString(0, doc.line(n).to);
}

export const parsePropsOf = (state: EditorState): ParsedProps | null => parseProps(headText(state.doc));

// --- which part is being edited --------------------------------------------

export interface PropTarget {
  index: number;
  part: "key" | "value";
  /** Where the caret lands on entry; "all" selects a freshly added name; a number is an offset (undo landing). */
  caret?: PartCaret;
}
interface ActiveProp extends PropTarget {
  /** Doc changes this part did NOT make — re-seeds it (same model as tables). */
  epoch: number;
  /**
   * The value's written span (quotes included) when its edit began, so leaving a
   * value that was not changed writes nothing (spec: editor-fidelity / 进出不改字节).
   * Absent for a name, or when the row could not be read.
   */
  seed?: string;
}

/** A value's written span, quotes included — what `finalizeValue` replaces. */
function valueSpan(prop: Prop): { from: number; to: number } {
  return prop.quote ? { from: prop.valueFrom - 1, to: prop.valueTo + 1 } : { from: prop.valueFrom, to: prop.valueTo };
}

/** The written span of the value a target names, read in `doc`; undefined for a name. */
function seedOf(doc: Text, target: PropTarget): string | undefined {
  if (target.part !== "value") return undefined;
  const prop = parseProps(headText(doc))?.props[target.index];
  if (!prop) return undefined;
  const { from, to } = valueSpan(prop);
  return doc.sliceString(from, to);
}

export const setActiveProp = StateEffect.define<PropTarget | null>();
/** Marks the part editor's own per-keystroke writes. */
const propSync = Annotation.define<boolean>();

export const activePropField = StateField.define<ActiveProp | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setActiveProp)) {
        // Re-entering the part already open keeps its seed: the session goes on.
        const same = e.value && value && value.index === e.value.index && value.part === e.value.part;
        next = e.value
          ? { ...e.value, epoch: value?.epoch ?? 0, seed: same ? value.seed : seedOf(tr.newDoc, e.value) }
          : null;
      }
    }
    if (!next || !tr.docChanged) return next;
    return { ...next, epoch: next.epoch + (tr.annotation(propSync) ? 0 : 1) };
  },
});

// --- "按源码编辑" -------------------------------------------------------------

export const setPropsSource = StateEffect.define<boolean>();

/** True while the whole block is shown as YAML source; cleared once the caret leaves it. */
export const propsSourceField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPropsSource)) return e.value;
    if (!value || !tr.selection) return value;
    const p = parsePropsOf(tr.state);
    const head = tr.state.selection.main.head;
    // Leave source mode when the caret goes past the closing `---`.
    if (!p) return value;
    return head <= p.to;
  },
});

/**
 * When an edit of a VALUE ends, give it quotes if it now needs them (spec: 值需要
 * 引号时只给它加引号), riding the same transaction as the session change. Only
 * that value's bytes change.
 */
const finalizeOnLeave = EditorState.transactionFilter.of((tr) => {
  if (!tr.effects.some((e) => e.is(setActiveProp))) return tr;
  const prev = tr.startState.field(activePropField, false);
  if (!prev || prev.part !== "value" || tr.startState.readOnly) return tr;
  const prop = parsePropsOf(tr.startState)?.props[prev.index];
  if (!prop || !prop.editable) return tr;
  const { from, to } = valueSpan(prop);
  const written = tr.startState.sliceDoc(from, to);
  // A value left exactly as it was written is the author's, not ours to re-quote
  // (`plain: -dash` is valid YAML the quoting rule would still wrap).
  if (written === prev.seed) return tr;
  const want = finalizeValue(prop.value, prop.quote);
  if (written === want) return tr;
  return [tr, { changes: { from, to, insert: want }, userEvent: "input" }];
});

const exitOnOutsideClick = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (!view.state.field(activePropField, false)) return false;
    if ((e.target as HTMLElement | null)?.closest(".om-props")) return false;
    view.dispatch({ effects: setActiveProp.of(null) });
    return false;
  },
});

/**
 * Where the OUTER caret is while a name or value is edited, and where it goes
 * when the edit ends (spec: caret-rules R9) — the table's rule (`tableCaret`),
 * for this block: entering without a landing of its own puts it at that name's
 * or value's source start; ending without one, while it is still inside the
 * block, moves it to the line after the closing `---`.
 */
const propsCaret = EditorState.transactionFilter.of((tr) => {
  let target: PropTarget | null | undefined;
  for (const e of tr.effects) if (e.is(setActiveProp)) target = e.value;
  if (target === undefined || tr.selection) return tr;
  const p = parseProps(headText(tr.newDoc));
  if (!p) return tr;
  if (target) {
    const prop = p.props[target.index];
    if (!prop) return tr;
    return [tr, { selection: { anchor: target.part === "key" ? prop.keyFrom : prop.valueFrom }, sequential: true }];
  }
  if (!tr.startState.field(activePropField, false)) return tr;
  const head = tr.changes.mapPos(tr.startState.selection.main.head, -1);
  if (head < p.from || head > p.to) return tr;
  return [tr, { selection: { anchor: lineAfterBlock(tr.newDoc, p.to) }, sequential: true }];
});

export const propertiesState: Extension = [activePropField, propsSourceField, finalizeOnLeave, propsCaret, exitOnOutsideClick];

// --- writing ----------------------------------------------------------------

/** The change that writes `text` as property `index`'s name or value, or null. */
function partChange(state: EditorState, index: number, part: "key" | "value", text: string) {
  const prop = parsePropsOf(state)?.props[index];
  if (!prop) return null;
  if (part === "key") {
    // A name cannot hold `: ` or start / end with a space — the line would stop
    // being `name:` and the whole block would fall back to source mid-typing.
    const key = text.replace(/:(\s|$)/g, "-$1").trim();
    if (key === "" || key === prop.key) return null;
    return { from: prop.keyFrom, to: prop.keyTo, insert: key };
  }
  if (text === prop.value) return null;
  // `name:` with nothing after: write the separating space too.
  const bare = prop.value === "" && state.sliceDoc(prop.valueFrom - 1, prop.valueFrom) === ":";
  return { from: prop.valueFrom, to: prop.valueTo, insert: bare ? ` ${text}` : text };
}

/** Append a property row to parsed frontmatter `p`, its new name selected in the open key editor. */
export function addProperty(view: EditorView, p: ParsedProps) {
  const name = editorString("props.newName");
  view.dispatch({
    changes: { from: p.closeFrom, insert: `${name}: \n` },
    effects: setActiveProp.of({ index: p.props.length, part: "key", caret: "all" }),
    userEvent: "input",
  });
}

/**
 * Can the "add property" command run here? A document with no frontmatter gets
 * a new block; one whose frontmatter we can parse gets a new row. Frontmatter we
 * cannot parse is shown as source and is left for the author to fix by hand.
 */
export function canInsertProperty(state: EditorState): boolean {
  return frontmatterRange(headText(state.doc)) === null || parsePropsOf(state) !== null;
}

function deleteProperty(view: EditorView, prop: Prop) {
  view.dispatch({
    changes: { from: prop.linesFrom, to: Math.min(prop.linesTo + 1, view.state.doc.length) },
    effects: setActiveProp.of(null),
    userEvent: "delete",
  });
}

// --- the widget ---------------------------------------------------------------

class PropertiesWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly editing: ActiveProp | null,
  ) {
    super();
  }

  eq(other: PropertiesWidget) {
    if (this.editing || other.editing) {
      // Same DOM across the part's own keystrokes (focus + IME survive).
      return (
        this.editing?.index === other.editing?.index &&
        this.editing?.part === other.editing?.part &&
        this.editing?.epoch === other.editing?.epoch
      );
    }
    return other.source === this.source;
  }

  toDOM(view: EditorView) {
    // Vertical spacing is PADDING on the measured wrapper, never margin (spec:
    // 渲染态点击落点精度 — margin sits outside CM's height measurement).
    const wrap = document.createElement("div");
    wrap.className = "om-props";
    const p = parseProps(this.source)!;
    const editable = !view.state.readOnly;

    p.props.forEach((prop, i) => {
      const row = document.createElement("div");
      row.className = "om-prop-row ome-state";
      row.dataset.omProp = String(i);
      row.appendChild(this.cell(view, prop, i, "key", editable));
      row.appendChild(this.cell(view, prop, i, "value", editable));
      if (editable) {
        // An sm ghost icon button from the one factory (change: editor-controls,
        // D5) — the `close` role, not a text `×`. Nested `.ome-state`: its own
        // hover patch on the row's fill.
        const del = editorIconButton({ glyph: "close", size: "sm", title: editorString("props.delete"), className: "om-prop-del" });
        del.dataset.omAction = "delete";
        row.appendChild(del);
      }
      wrap.appendChild(row);
    });

    if (editable) {
      const foot = document.createElement("div");
      foot.className = "om-props-foot";
      // sm ghost text buttons from the one factory (change: editor-controls).
      const add = editorTextButton({ label: editorString("props.add"), size: "sm", className: "om-props-add" });
      add.dataset.omAction = "add";
      const source = editorTextButton({ label: editorString("props.editSource"), size: "sm", className: "om-props-source" });
      source.dataset.omAction = "source";
      foot.append(add, source);
      wrap.appendChild(foot);
    }

    wrap.addEventListener("mousedown", (e) => {
      if (view.state.readOnly) return;
      const target = e.target as HTMLElement;
      if (target.closest(".om-part-editor")) return; // caret placement inside the open part
      const current = parsePropsOf(view.state);
      if (!current) return;
      const action = (target.closest("[data-om-action]") as HTMLElement | null)?.dataset.omAction;
      const rowEl = target.closest(".om-prop-row") as HTMLElement | null;
      const index = rowEl ? Number(rowEl.dataset.omProp) : -1;
      e.preventDefault();
      if (action === "add") return addProperty(view, current);
      if (action === "source") {
        view.dispatch({
          effects: [setActiveProp.of(null), setPropsSource.of(true)],
          selection: { anchor: view.state.doc.line(Math.min(2, view.state.doc.lines)).from },
        });
        view.focus();
        return;
      }
      const prop = current.props[index];
      if (!prop) return;
      if (action === "delete") return deleteProperty(view, prop);
      const part = target.closest(".om-prop-key") ? "key" : "value";
      if (part === "value" && !prop.editable) return; // read-only row: use 按源码编辑
      view.dispatch({ effects: setActiveProp.of({ index, part }) });
    });
    return wrap;
  }

  private cell(view: EditorView, prop: Prop, index: number, part: "key" | "value", editable: boolean) {
    const el = document.createElement("div");
    el.className = part === "key" ? "om-prop-key" : prop.editable ? "om-prop-value" : "om-prop-value om-prop-readonly";
    const text = part === "key" ? prop.key : prop.editable ? prop.value : this.source.slice(prop.valueFrom, prop.linesTo);
    if (editable && this.editing && this.editing.index === index && this.editing.part === part) {
      // Current item (design flat-states D5): selected fill via `.ome-state`.
      el.classList.add("om-prop-editing", "ome-state");
      el.dataset.selected = "true";
      el.appendChild(this.partEditor(view, text, index, part));
    } else {
      el.textContent = text;
    }
    return el;
  }

  private partEditor(view: EditorView, text: string, index: number, part: "key" | "value") {
    const host = buildPartEditor(
      view,
      text,
      {
        sync: (value) => {
          const change = partChange(view.state, index, part, value);
          if (change) {
            // Joinable, so a burst of typing is one undo step; `propSync` keeps
            // the epoch (and so this very editor) from being re-seeded.
            view.dispatch({ changes: change, userEvent: "input.type", annotations: propSync.of(true) });
          }
        },
        onKey: (e) => this.onKey(e, view, index, part),
      },
      { accept: flattenCellInsert, caret: view.state.field(activePropField, false)?.caret },
    );
    return host;
  }

  private onKey(e: KeyboardEvent, view: EditorView, index: number, part: "key" | "value"): boolean {
    const history = historyKeyOf(e);
    if (history) {
      e.preventDefault();
      (history === "undo" ? undo : redo)(view);
      return true;
    }
    const p = parsePropsOf(view.state);
    if (!p) return false;
    const go = (target: PropTarget | null) => {
      e.preventDefault();
      view.dispatch({ effects: setActiveProp.of(target) });
      if (!target) view.focus();
      return true;
    };
    // Editable stops in reading order: key, value (when editable), next key, …
    const stops: PropTarget[] = p.props.flatMap((prop, i) =>
      prop.editable ? [{ index: i, part: "key" as const }, { index: i, part: "value" as const }] : [{ index: i, part: "key" as const }],
    );
    const at = stops.findIndex((s) => s.index === index && s.part === part);
    const plain = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
    switch (e.key) {
      case "Escape":
        // Esc lands on the line after the block, in view (spec: caret-rules R9).
        e.preventDefault();
        view.dispatch({
          effects: setActiveProp.of(null),
          selection: { anchor: lineAfterBlock(view.state.doc, p.to) },
          scrollIntoView: true,
        });
        view.focus();
        return true;
      case "Tab":
        if (e.shiftKey) return at > 0 ? go(stops[at - 1]) : (e.preventDefault(), true);
        return at < stops.length - 1 ? go(stops[at + 1]) : (e.preventDefault(), true);
      case "Enter": {
        // To the next row's value (or name, when it has no editable value).
        const nextRow = index + 1;
        if (nextRow >= p.props.length) return go(null);
        return go({ index: nextRow, part: p.props[nextRow].editable ? "value" : "key" });
      }
      case "ArrowUp":
        if (!plain) return false;
        if (index > 0) return go({ index: index - 1, part: part === "value" && p.props[index - 1].editable ? "value" : "key" });
        e.preventDefault();
        return true; // the block is at the top of the file: nowhere further up
      case "ArrowDown":
        if (!plain) return false;
        if (index < p.props.length - 1) {
          return go({ index: index + 1, part: part === "value" && p.props[index + 1].editable ? "value" : "key" });
        }
        e.preventDefault();
        exitBlock(view, { from: p.from, to: p.to }, "down", [setActiveProp.of(null)]);
        return true;
    }
    return false;
  }

  updateDOM(dom: HTMLElement): boolean {
    const editing = this.editing;
    if (!editing) return false;
    const part = partEditorIn(dom);
    const row = part?.dom.closest(".om-prop-row") as HTMLElement | null;
    if (!part || !row || Number(row.dataset.omProp) !== editing.index) return false;
    const inKey = !!part.dom.closest(".om-prop-key");
    if (inKey !== (editing.part === "key")) return false;
    const prop = parseProps(this.source)?.props[editing.index];
    if (!prop) return false;
    reseedPart(part, editing.part === "key" ? prop.key : prop.value);
    return true;
  }

  destroy(dom: HTMLElement) {
    partEditorIn(dom)?.destroy();
  }

  ignoreEvent() {
    return true;
  }
}


export const frontmatterEntry: BlockEntry = {
  id: "frontmatter",
  mode: "B",
  scan: (state) => {
    if (state.field(propsSourceField, false)) return null; // 按源码编辑: plain YAML
    const p = parsePropsOf(state);
    if (!p) return null; // unparseable → shown as source (spec: 解析失败直接显示源码)
    const editing = state.field(activePropField, false) ?? null;
    return { from: p.from, to: p.to, widget: new PropertiesWidget(state.sliceDoc(p.from, p.to), editing) };
  },
  enter: (view, _block, edge) => {
    const p = parsePropsOf(view.state);
    if (!p || p.props.length === 0) return;
    const index = edge === "top" ? 0 : p.props.length - 1;
    view.dispatch({ effects: setActiveProp.of({ index, part: p.props[index].editable ? "value" : "key" }) });
  },
  // An undo landed in the block (spec: caret-rules R2b): edit the name or value
  // holding `pos`, its caret at the change; the outer caret stays at `pos`.
  enterAt: (view, _block, pos) => {
    const p = parsePropsOf(view.state);
    const target = p ? propAt(p, pos) : null;
    if (!target) return;
    const prop = p!.props[target.index];
    const from = target.part === "key" ? prop.keyFrom : prop.valueFrom;
    const to = target.part === "key" ? prop.keyTo : prop.valueTo;
    const caret = Math.max(0, Math.min(pos, to) - from);
    const open = view.state.field(activePropField, false);
    if (open && open.index === target.index && open.part === target.part) {
      const wrap = view.contentDOM.querySelector<HTMLElement>(".om-props");
      const editor = wrap ? partEditorIn(wrap) : undefined;
      if (editor) return placePartCaret(editor, caret);
    }
    view.dispatch({ effects: setActiveProp.of({ ...target, caret }), selection: { anchor: pos } });
  },
  leave: (state) => (state.field(activePropField, false) ? [setActiveProp.of(null)] : []),
};

/**
 * The name or value an offset in the frontmatter falls in: the value when it is
 * editable and holds `pos`, else that row's name; between rows, the nearest row
 * above (the first row above all of them). Null when there are no rows. Pure.
 */
export function propAt(p: ParsedProps, pos: number): { index: number; part: "key" | "value" } | null {
  if (p.props.length === 0) return null;
  let index = 0;
  p.props.forEach((prop, i) => {
    if (prop.linesFrom <= pos) index = i;
  });
  const prop = p.props[index];
  const inValue = prop.editable && pos >= prop.valueFrom && pos <= prop.linesTo;
  return { index, part: inValue ? "value" : "key" };
}

