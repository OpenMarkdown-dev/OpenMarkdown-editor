import { tipAttrs } from "@/lib/tooltip";
import { EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { editorString } from "./strings";
import { contentMarkSvg } from "./controls";
import { setMarkup } from "./markup";

/**
 * Long reference → compact chip (spec: reference-rendering / 长引用源触碰时收敛
 * 为 chip). When the cursor enters a link/image whose URL is long, the URL is
 * concealed into an atomic chip (link text stays visible/editable) instead of
 * spilling the whole source. Clicking the chip force-expands that one reference
 * so the URL becomes editable; moving the cursor out collapses it again.
 *
 * Threshold + label are pure helpers so they can be unit-tested (dev note:
 * editor logic lives in pure helpers). The expand state + widget live here too
 * (rather than widgets.ts) to keep the StateEffect they depend on colocated.
 */

/** URLs longer than this (chars) are chipped on touch. Configurable default. */
export const DEFAULT_CHIP_THRESHOLD = 30;

/** Whether a URL is long enough to collapse into a chip. Pure. */
export function shouldConcealUrl(url: string, threshold = DEFAULT_CHIP_THRESHOLD): boolean {
  return url.trim().length > threshold;
}

/** Max chars kept from a URL's first path segment before it's truncated. */
const SEG_MAX = 18;

/**
 * Compact chip label. For http(s): `host` plus the first path segment (and a
 * trailing `/…` when there's more), e.g. `github.com/OpenMarkdown-dev/…` — more
 * informative than the bare host, still bounded so a long URL can't blow up the
 * line (an over-long first segment is itself truncated). For other schemes /
 * local paths: the trailing segment. Pure.
 */
export function chipLabel(url: string): string {
  const trimmed = url.trim();
  const http = trimmed.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/i);
  if (http) {
    const host = http[1];
    const segs = (http[2] ?? "").split("/").filter(Boolean);
    if (segs.length === 0) return host;
    let first = segs[0];
    if (first.length > SEG_MAX) first = first.slice(0, SEG_MAX - 1) + "…";
    return host + "/" + first + (segs.length > 1 ? "/…" : "");
  }
  const scheme = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (scheme && scheme[1].toLowerCase() === "data") return "data:…";
  const name = trimmed.split(/[/\\]/).pop() || trimmed;
  return name.length > 24 ? name.slice(0, 23) + "…" : name;
}

/** A link/image whose URL source is force-expanded for editing. */
export interface ExpandedRef {
  from: number;
  to: number;
}

/** Set (or clear with `null`) the currently force-expanded reference. */
export const setExpandedRef = StateEffect.define<ExpandedRef | null>();

/**
 * Which reference (if any) has its URL source expanded for editing. Set when a
 * chip is clicked; auto-collapses once the selection leaves the reference's
 * range (design: 移出再收敛).
 */
export const expandedRefField = StateField.define<ExpandedRef | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) if (e.is(setExpandedRef)) next = e.value;
    if (!next) return null;
    if (tr.docChanged) {
      next = { from: tr.changes.mapPos(next.from, -1), to: tr.changes.mapPos(next.to, 1) };
    }
    if (tr.selection) {
      const stillInside = tr.newSelection.ranges.some(
        (r) => r.from <= next!.to && r.to >= next!.from,
      );
      if (!stillInside) return null;
    }
    return next;
  },
});

/** True when the reference starting at `from` is the expanded one. */
export function isRefExpanded(field: ExpandedRef | null | undefined, from: number): boolean {
  return field != null && field.from === from;
}

/** Compact chip replacing a long `(url)` inside a touched link/image. */
export class UrlChipWidget extends WidgetType {
  constructor(
    readonly linkFrom: number,
    readonly linkTo: number,
    readonly urlFrom: number,
    readonly label: string,
  ) {
    super();
  }
  eq(other: UrlChipWidget) {
    return (
      other.linkFrom === this.linkFrom &&
      other.linkTo === this.linkTo &&
      other.urlFrom === this.urlFrom &&
      other.label === this.label
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "om-url-chip ome-state ome-ink-muted";
    // The `link` role as a content mark (change: editor-controls, D4): the
    // inline tier scaled with the text — never an emoji in a CSS `content`.
    setMarkup(el, contentMarkSvg("link", "inline"));
    const text = document.createElement("span");
    text.className = "om-url-chip-label";
    text.textContent = this.label;
    el.appendChild(text);
    for (const [k, v] of Object.entries(tipAttrs(editorString("widget.expandLink")))) el.setAttribute(k, v);
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // Expand this reference and drop the cursor into the URL. Both ride one
      // transaction: after it the chip's atomic range is gone (expanded), so
      // the cursor lands in editable source.
      view.dispatch({
        selection: { anchor: this.urlFrom },
        effects: setExpandedRef.of({ from: this.linkFrom, to: this.linkTo }),
      });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}
