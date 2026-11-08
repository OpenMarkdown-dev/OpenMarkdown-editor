import { tipAttrs } from "@/lib/tooltip";
import { CONTROL_SIZE, type ControlSize } from "@/components/ui/control";
import { ICON_SIZE, ICON_STROKE, type IconTier } from "@/components/ui/iconMetrics";
import { EDITOR_GLYPH_CLASS, EDITOR_INK_MUTED_CLASS, EDITOR_STATE_CLASS, contentMarkClass } from "./primitives";
import { glyphMarkup, setMarkup, type SafeMarkup } from "./markup";

/**
 * THE EDITOR'S CONTROLS AND GLYPHS — one factory, one glyph table (spec:
 * app-chrome / 编辑器里的控件只经一个工厂; change: editor-controls).
 *
 * The editor draws its controls as raw DOM (CodeMirror widgets and panels have
 * no React), so it cannot render <Button> / <IconButton>. This module is their
 * raw-DOM twin. It emits the EDITOR'S OWN classes (`./primitives.ts`, change:
 * editor-style-tokens) — the editor ships to hosts with no Tailwind — drawn
 * from the SAME ruler (`control.ts`, `iconMetrics.ts`, read as numbers): the
 * ruler's height, the square, the one corner and the state layer of
 * `.ome-state`, the weight's `data-weight`. In the app the editor's tokens map
 * onto the app's, so an editor control and an app control render the same
 * pixels; `primitives.test.ts` holds the mirror. Before the factory, each
 * widget drew its own: a 13px chevron in no box, a 22px copy button made of
 * padding and a border, find buttons 4px×6px padded (not square, not on the
 * ruler), a text `×`, an emoji in a CSS `content`.
 *
 * Editor CSS (`theme.ts`) may only PLACE a control: position it, show / hide it,
 * stack it, give it a resting SURFACE when it floats over content. Its height,
 * width, padding, corner, type size and colour are the classes' — and a
 * CodeMirror theme rule is unlayered, so it would silently beat them.
 * Gate: `scripts/check-app-surface.mjs` (editor-control-*), owner: this file.
 *
 * Glyphs come in two kinds (design D4):
 *   - inside a CONTROL → the control's icon tier, in px, never zoomed: a
 *     control is chrome (spec: workspace-shell / UI 缩放 — chrome never scales);
 *   - a CONTENT MARK in the document (a callout's header icon, a link chip's
 *     glyph) → an icon tier passed through the content zoom, so it scales with
 *     the text like every other rendered widget.
 */

/** The marker class every factory control carries (the gate keys on it). */
export const EDITOR_CONTROL_CLASS = "om-control";

/**
 * The editor's glyphs, keyed by the icon ROLE they draw (`icons.ts`). Every key
 * MUST be a role there, and its markup MUST be that lucide icon's own
 * (`controls.test.ts` renders the role and compares) — so a glyph here is never
 * a second, drifting copy of an icon. Inner markup only; `glyphSvg` wraps it.
 *
 * The role check lives in that test, not in a `satisfies Record<IconName, …>`
 * here: even a type-only import of `icons.ts` (lucide-react) is an edge out of
 * the exported editor tree, which must typecheck on its own (change:
 * editor-publish; gate: `packages/editor/export.gate.test.ts`).
 */
export const EDITOR_GLYPHS = {
  chevronDown: `<path d="m6 9 6 6 6-6"></path>`,
  chevronUp: `<path d="m18 15-6-6-6 6"></path>`,
  close: `<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>`,
  copy: `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>`,
  imageResize: `<path d="M19 13v6h-6"></path><path d="M5 11V5h6"></path><path d="m5 5 14 14"></path>`,
  link: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>`,
  calloutNote: `<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>`,
  calloutTip: `<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path>`,
  calloutImportant: `<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"></path><path d="M12 15h.01"></path><path d="M12 7v4"></path>`,
  calloutWarning: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>`,
  calloutCaution: `<path d="M12 16h.01"></path><path d="M12 8v4"></path><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"></path>`,
} as const satisfies Record<string, string>;

export type EditorGlyph = keyof typeof EDITOR_GLYPHS;

/**
 * A glyph as an `<svg>` string, in the icon set's 24-unit box with the one
 * `ICON_STROKE`. `size` is a control's pixel tier (SVG `width` / `height`
 * attributes) or a content mark's tier (a class whose size is zoomed, see
 * `contentMarkSvg`). Never a `style` attribute: a strict CSP blocks those (spec:
 * editor-host / 内核样式只经注入样式表; gate: `noInlineStyle.gate.test.ts`) — the
 * block display and the no-shrink come from `.ome-glyph` (`./primitives.ts`).
 * Decorative: the control around it carries the name.
 */
export function glyphSvg(role: EditorGlyph, size: number | IconTier): SafeMarkup {
  const box =
    typeof size === "number"
      ? `class="${EDITOR_GLYPH_CLASS}" width="${size}" height="${size}"`
      : `class="${EDITOR_GLYPH_CLASS} ${contentMarkClass(size)}"`;
  return glyphMarkup(
    `<svg xmlns="http://www.w3.org/2000/svg" ${box} viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${EDITOR_GLYPHS[role]}</svg>`
  );
}

/** A content mark's glyph: an icon tier, scaled with the document's text (design D4). */
export function contentMarkSvg(role: EditorGlyph, tier: IconTier): SafeMarkup {
  return glyphSvg(role, tier);
}

interface EditorControlOptions {
  /** The ruler tier (sm 20 / md 24 / lg 32). */
  size?: ControlSize;
  /** ghost or outline: the editor has no transient surface, so no solid (app-chrome / 实心需准入). */
  weight?: "ghost" | "outline";
  /** The class a theme rule and the widget's own code find it by. */
  className?: string;
  /** -1 for a pointer-only control that must not take keyboard focus. */
  tabIndex?: number;
  /** For a control that is a pointer affordance only (the image grip). */
  ariaHidden?: boolean;
}

/**
 * What a control is, as data — the pure half of the factory, so the tests can
 * read it without a DOM (none in node; CLAUDE.md). The DOM half only applies it.
 */
export interface EditorControlSpec {
  className: string;
  attrs: Record<string, string>;
  /** Inner markup (an icon button's glyph) or text (a text button's label). */
  html?: SafeMarkup;
  text?: string;
}

/** The weight a control declares (`data-weight`, as the app's primitives do). */
function baseAttrs(weight: "ghost" | "outline", o: EditorControlOptions): Record<string, string> {
  const attrs: Record<string, string> = { type: "button", "data-weight": weight };
  if (o.tabIndex !== undefined) attrs.tabindex = String(o.tabIndex);
  if (o.ariaHidden) attrs["aria-hidden"] = "true";
  return attrs;
}

/** A control's classes: box, ruler tier, weight (ghost = muted ink), state, marker, the caller's. */
function controlClasses(size: ControlSize, weight: "ghost" | "outline", icon: boolean, extra?: string): string {
  return [
    "ome-btn",
    `ome-btn-${size}`,
    icon ? "ome-btn-icon" : "",
    weight === "outline" ? "ome-outline" : EDITOR_INK_MUTED_CLASS,
    EDITOR_STATE_CLASS,
    EDITOR_CONTROL_CLASS,
    extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The spec of an icon-only button: the raw-DOM <IconButton>. */
export function iconButtonSpec(o: EditorControlOptions & { glyph: EditorGlyph; title: string }): EditorControlSpec {
  const size = o.size ?? "md";
  const weight = o.weight ?? "ghost";
  return {
    className: controlClasses(size, weight, true, o.className),
    attrs: { ...baseAttrs(weight, o), ...tipAttrs(o.title, { name: true }) },
    html: glyphSvg(o.glyph, ICON_SIZE[CONTROL_SIZE[size].icon]),
  };
}

/** The spec of a text button: the raw-DOM <Button>. */
export function textButtonSpec(o: EditorControlOptions & { label: string; title?: string }): EditorControlSpec {
  const size = o.size ?? "md";
  const weight = o.weight ?? "ghost";
  const attrs = baseAttrs(weight, o);
  if (o.title) Object.assign(attrs, tipAttrs(o.title));
  return { className: controlClasses(size, weight, false, o.className), attrs, text: o.label };
}

function build(spec: EditorControlSpec): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = spec.className;
  for (const [k, v] of Object.entries(spec.attrs)) btn.setAttribute(k, v);
  // The glyph markup is this module's own constant table, never input — and
  // still goes through the one sanitising sink (`markup.ts`).
  if (spec.html !== undefined) setMarkup(btn, spec.html);
  if (spec.text !== undefined) btn.textContent = spec.text;
  return btn;
}

/**
 * An icon-only button — a square of the tier's side, the tier's icon size,
 * `title` as its tooltip and accessible name. The caller wires its events.
 */
export function editorIconButton(o: EditorControlOptions & { glyph: EditorGlyph; title: string }): HTMLButtonElement {
  return build(iconButtonSpec(o));
}

/** A text button — the tier's height, inset and type size. */
export function editorTextButton(o: EditorControlOptions & { label: string; title?: string }): HTMLButtonElement {
  return build(textButtonSpec(o));
}

/**
 * A single-line text field that lines up with the tier's buttons: `.ome-field`
 * (the frame and the one corner) plus the ruler tier's height, inset and type
 * size (`.ome-field-<size>`, `./primitives.ts`).
 */
export function editorFieldClasses(size: ControlSize = "md"): string {
  return `ome-field ome-field-${size}`;
}
