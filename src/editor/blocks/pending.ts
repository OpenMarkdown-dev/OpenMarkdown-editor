import { type ChangeDesc, MapMode } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import { editorString } from "../strings";
import type { PendingContent } from "./render";

/**
 * The ONE placeholder (spec: block-editing / 块在渲染前占住它的位置; change:
 * render-placeholder-size, design D2, D3). When a renderer answers `pending()`
 * ("mine, not yet" — `./render.ts`), whatever is waiting — a block, an inline
 * formula, a table-cell formula, an image still downloading — shows this, never
 * its source. Defined here only:
 *
 * - what it looks like: a quiet empty box (`.om-pending` in `theme.ts`, the one
 *   rule; the class is named only here and there — gate R5 in
 *   `render.gate.test.ts`), `aria-busy`, labelled 「正在渲染」;
 * - how big it is: `reservedSize`, the one size order — stated → remembered →
 *   carried → minimum — and the in-memory size memory it reads;
 * - how it is entered: a mousedown reveals the source, exactly as on a rendered
 *   A block (`clickRevealsSource`, shared with the rendered widgets);
 * - an optional content slot a deferred block fills (design D8: a large
 *   diagram's hint and Render button, change `mermaid-large-diagrams`).
 *
 * A leaf: CodeMirror, `../strings`, and a type from `./render`, so the image
 * factory, the cell renderer and the block field can all import it without a
 * cycle (`src/moduleGraph.gate.test.ts`). Styles go on as CSSOM values only,
 * never a `style=` attribute (spec: editor-host / 内核样式只经注入样式表).
 */

const PENDING_CLASS = "om-pending";

// --- Size ------------------------------------------------------------------

/** A size in CSS pixels. `width` only where it matters (an image). */
export interface Size {
  width?: number;
  height: number;
}

/** The size a placeholder reserves, and which step of the order gave it. */
export type Reserved =
  | { origin: "stated" | "remembered" | "carried"; size: Size }
  | { origin: "minimum"; minHeight: string };

/** One text line: the framework's default minimum. */
export const DEFAULT_PENDING_MIN_HEIGHT = "1lh";

/**
 * The one size order (design D3). First known wins:
 *   1. `stated` — the document's own size (an image's `|WxH`);
 *   2. `key` — the size last drawn for this exact thing in this session;
 *   3. `carried` — for a block just edited, the height it had before the edit;
 *   4. the minimum (`minHeight`, default one line).
 */
export function reservedSize(q: {
  stated?: Size | null;
  key?: string | null;
  carried?: Size | null;
  minHeight?: string;
}): Reserved {
  if (q.stated) return { origin: "stated", size: q.stated };
  const remembered = q.key != null ? rememberedSize(q.key) : undefined;
  if (remembered) return { origin: "remembered", size: remembered };
  if (q.carried) return { origin: "carried", size: q.carried };
  return { origin: "minimum", minHeight: q.minHeight ?? DEFAULT_PENDING_MIN_HEIGHT };
}

/** A reserved size as element style VALUES (CSSOM): a known size exactly, the minimum as a floor. */
export function reserveStyle(r: Reserved): { height?: string; minHeight?: string } {
  return r.origin === "minimum" ? { minHeight: r.minHeight } : { height: `${r.size.height}px` };
}

/** Sizes kept; the least recently used is dropped first. In memory only, shared by every editor. */
export const SIZE_MEMORY_LIMIT = 300;
const memory = new Map<string, Size>();

export function rememberSize(key: string, size: Size): void {
  if (!(size.height > 0)) return;
  memory.delete(key);
  memory.set(key, size);
  while (memory.size > SIZE_MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
}

export function rememberedSize(key: string): Size | undefined {
  const size = memory.get(key);
  if (size) {
    memory.delete(key);
    memory.set(key, size);
  }
  return size;
}

/** Tests only: start from an empty memory. */
export function forgetSizes(): void {
  memory.clear();
}

/** The memory key of a block's drawn size: which entry, which scheme, which source. */
export function blockSizeKey(entryId: string, scheme: string, source: string): string {
  return `${entryId}\n${scheme}\n${source}`;
}

/** The memory key of a picture's natural size: its resolved `src`. */
export const imageSizeKey = (src: string): string => `image\n${src}`;

// --- The carried size ------------------------------------------------------

/**
 * A revealed A block's last drawn height, kept against its start while its
 * source is edited (the source — and so its key — changes, which is exactly
 * when the old size is the best guess: spec scenario 渲染过的图表编辑后离开不跳).
 */
export interface Carried {
  from: number;
  height: number;
}

/**
 * A block's start through an edit — the ONE rule for everything kept against a
 * block's start (a carried height here; a large diagram's approval,
 * `askedDiagrams` in `./mermaid.ts`). Text inserted exactly at the start (an
 * Enter, a block pasted above) pushes the block down, so what is kept follows
 * the block (`assoc` 1); a start that is deleted gives null.
 */
export function mapBlockStart(from: number, changes: ChangeDesc): number | null {
  return changes.mapPos(from, 1, MapMode.TrackDel);
}

/** Carried sizes through an edit (`mapBlockStart`); a deleted start drops its entry. */
export function mapCarried(list: readonly Carried[], changes: ChangeDesc): Carried[] {
  const out: Carried[] = [];
  for (const c of list) {
    const from = mapBlockStart(c.from, changes);
    if (from !== null) out.push({ from, height: c.height });
  }
  return out;
}

export function carriedAt(list: readonly Carried[], from: number): Size | null {
  const c = list.find((x) => x.from === from);
  return c ? { height: c.height } : null;
}

// --- The element -----------------------------------------------------------

/**
 * An A block's rendered body or placeholder: own the mousedown so a click drops
 * the caret at the block's start, which the A reveal then expands into source —
 * the replaced range is atomic, so CM's default click cannot place the caret
 * (mirrors TableWidget). Pair with an `ignoreEvent` that claims "mousedown".
 * `except`: a region whose own clicks are not a reveal (a placeholder's content).
 */
export function clickRevealsSource(wrap: HTMLElement, view: EditorView, from: number, except?: HTMLElement): HTMLElement {
  const reveal = () => {
    view.dispatch({ selection: { anchor: from } });
    view.focus();
  };
  let press: { x: number; y: number; scrollLeft: number } | null = null;
  wrap.addEventListener("mousedown", (e) => {
    if (except && e.target instanceof Node && except.contains(e.target)) return;
    // A press on the box's own scrollbar (a wide diagram) scrolls, never reveals.
    const r = wrap.getBoundingClientRect();
    if (pressOnScrollbar({ x: e.clientX - r.left, y: e.clientY - r.top }, wrap)) return;
    e.preventDefault();
    // A box that scrolls sideways (change: mermaid-large-diagrams, design D5):
    // an overlay scrollbar takes no room, so the press cannot be told from a
    // press on the diagram yet. Reveal on the click instead, and only if it was
    // a click — no drag, no scroll in between.
    if (wrap.scrollWidth > wrap.clientWidth) {
      press = { x: e.clientX, y: e.clientY, scrollLeft: wrap.scrollLeft };
      return;
    }
    reveal();
  });
  wrap.addEventListener("click", (e) => {
    const p = press;
    press = null;
    if (p && isPlainClick(p, { x: e.clientX, y: e.clientY, scrollLeft: wrap.scrollLeft })) reveal();
  });
  return wrap;
}

/**
 * Was a press-and-release a click on the content, not a drag or a scroll?
 * Pure (change: mermaid-large-diagrams, design D5 fallback for overlay scrollbars).
 */
export function isPlainClick(
  down: { x: number; y: number; scrollLeft: number },
  up: { x: number; y: number; scrollLeft: number },
): boolean {
  return Math.abs(up.x - down.x) <= 4 && Math.abs(up.y - down.y) <= 4 && Math.abs(up.scrollLeft - down.scrollLeft) < 1;
}

/**
 * Is a press at `at` (px from the element's border-box corner) outside the
 * element's client box — on its scrollbar or border? (change:
 * mermaid-large-diagrams, design D5.) Pure, so it is tested without a DOM.
 */
export function pressOnScrollbar(
  at: { x: number; y: number },
  el: { clientLeft: number; clientTop: number; clientWidth: number; clientHeight: number },
): boolean {
  const x = at.x - el.clientLeft;
  const y = at.y - el.clientTop;
  return x < 0 || y < 0 || x > el.clientWidth || y > el.clientHeight;
}

function box(tag: "div" | "span", flow: "block" | "inline"): HTMLElement {
  const el = document.createElement(tag);
  el.className = PENDING_CLASS;
  el.dataset.omPending = flow;
  el.setAttribute("aria-busy", "true");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", editorString("widget.rendering"));
  return el;
}

/**
 * The inline box takes its source's width without showing it: the source laid
 * out invisible (and out of the accessibility tree) inside the box.
 */
function ghost(el: HTMLElement, source: string): void {
  const text = document.createElement("span");
  text.textContent = source;
  text.style.visibility = "hidden";
  text.setAttribute("aria-hidden", "true");
  el.appendChild(text);
}

/**
 * The placeholder as an element, for detached DOM the editor's decorations
 * cannot reach — a table cell's formula (like `failedSourceElement`).
 */
export function pendingElement(source: string): HTMLElement {
  const el = box("span", "inline");
  ghost(el, source);
  return el;
}

/**
 * Show an image frame as the placeholder until its picture arrives (design D6:
 * no size known). `clearPending` takes it off again.
 */
export function markPending(el: HTMLElement, minHeight: string, minWidth?: string): void {
  el.classList.add(PENDING_CLASS);
  el.dataset.omPending = "inline";
  el.setAttribute("aria-busy", "true");
  el.style.minHeight = minHeight;
  if (minWidth) el.style.minWidth = minWidth;
}

export function clearPending(el: HTMLElement): void {
  el.classList.remove(PENDING_CLASS);
  delete el.dataset.omPending;
  el.removeAttribute("aria-busy");
  el.style.minHeight = "";
  el.style.minWidth = "";
}

/**
 * The placeholder widget: a block (in the block field, through its one `push`,
 * so it gets the selected state, `blockId` and `blockMode` like a rendered
 * block) or inline (a formula in a line, `source` giving its width).
 */
export class PendingWidget extends WidgetType {
  constructor(
    readonly flow: "block" | "inline",
    readonly from: number,
    readonly reserved: Reserved,
    readonly content?: PendingContent,
    readonly source?: string,
  ) {
    super();
  }

  eq(other: PendingWidget): boolean {
    return (
      other.flow === this.flow &&
      other.from === this.from &&
      other.source === this.source &&
      other.content?.key === this.content?.key &&
      sameReserved(other.reserved, this.reserved)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const el = box(this.flow === "block" ? "div" : "span", this.flow);
    Object.assign(el.style, reserveStyle(this.reserved));
    if (this.source !== undefined) ghost(el, this.source);
    if (this.content) {
      // The content speaks for itself; the box is no longer just "busy". A
      // press anywhere in the box still reveals the source, like any
      // placeholder; a control in the content stops its own mousedown.
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
      el.appendChild(this.content.build(view));
    }
    return clickRevealsSource(el, view, this.from);
  }

  ignoreEvent(event: Event): boolean {
    if (event.type === "mousedown" || event.type === "click") return true;
    // Everything inside the content (a button) is the content's own.
    return !!this.content && event.target instanceof Node && this.contentOwns(event.target);
  }

  private contentOwns(target: Node): boolean {
    const el = target instanceof Element ? target : target.parentElement;
    return !!el?.closest(`.${PENDING_CLASS} > :not([aria-hidden])`);
  }

  get estimatedHeight(): number {
    return this.reserved.origin === "minimum" ? -1 : this.reserved.size.height;
  }
}

function sameReserved(a: Reserved, b: Reserved): boolean {
  if (a.origin === "minimum" || b.origin === "minimum") {
    return a.origin === b.origin && (a as { minHeight: string }).minHeight === (b as { minHeight: string }).minHeight;
  }
  return a.origin === b.origin && a.size.height === b.size.height && a.size.width === b.size.width;
}
