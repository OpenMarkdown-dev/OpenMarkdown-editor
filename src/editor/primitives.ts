import { EditorView, ViewPlugin } from "@codemirror/view";
import { CONTROL_SIZE, type ControlSize } from "@/components/ui/control";
import { TEXT_METRICS, type TextTier } from "@/components/ui/type";
import { ICON_SIZE, type IconTier } from "@/components/ui/iconMetrics";
import { zoomed } from "./contentZoom";

/**
 * THE EDITOR'S STYLE PRIMITIVES — its own classes for state, fields, buttons
 * and chrome type (spec: editor-host / 编辑器样式自成一体; change:
 * editor-style-tokens, design D4–D6).
 *
 * The editor ships to hosts with no Tailwind and no index.css, so it cannot
 * lean on the app's `.om-state` / `.om-field` / `:focus-visible` rules or on
 * utility classes. These are their editor-side twins, written ONCE here and
 * styled only through `--ome-*` tokens (`./tokens.ts`):
 *
 *   .ome-state      the state layer — hover / selected derived from semantic
 *                   attributes, one corner, never a background-color;
 *   .ome-ink-muted  muted ink that rises to --ome-fg in a state;
 *   .ome-field      a single-line field's frame (accent while focused);
 *   .ome-btn        a factory control's box: reset, ruler height, inset, type,
 *                   weight (`.ome-outline`; ghost = `.ome-ink-muted`), the
 *                   square of an icon button, the keyboard focus ring;
 *   .ome-type-*     a chrome type tier.
 *
 * They MIRROR the app's definitions (index.css, buttonClasses.ts): in the app
 * the editor's tokens are mapped onto the app's, so both render the same
 * pixels. `primitives.test.ts` holds the mirror to the app's definitions — the
 * selector lists, the ruler (read from `control.ts` / `type.ts`, never
 * copied), the transition and the disabled fade — so it cannot drift (design
 * D6, a stated trade-off).
 *
 * Gate: `check-app-surface` state-not-by-fill names this file as the editor's
 * one state definition (its fourth named exception); nowhere else in the
 * editor may paint a state.
 */

/** The class names, for the factory and the widgets (and the gate). */
export const EDITOR_STATE_CLASS = "ome-state";
export const EDITOR_INK_MUTED_CLASS = "ome-ink-muted";
/** Every editor glyph's `<svg>`: a block, never shrunk (`controls.ts` / `glyphSvg`). */
export const EDITOR_GLYPH_CLASS = "ome-glyph";
/** A content mark's glyph size: an icon tier through the content zoom (`controls.ts` / `contentMarkSvg`). */
export const contentMarkClass = (tier: IconTier): string => `ome-icon-${tier}`;

/**
 * The semantic attributes that make an `.ome-state` SELECTED — the app's list
 * (`.om-state:is(…)` in index.css), each written so its specificity is ONE
 * attribute: selected and hover then tie and selected, declared after, wins.
 * (CodeMirror's style-mod splits a selector key on every comma, so the list is
 * written out part by part rather than inside one `:is()`.)
 */
export const SELECTED_STATES = [
  '[aria-selected="true"]',
  '[aria-current]:not([aria-current="false"])',
  '[aria-pressed="true"]',
  '[aria-checked="true"]',
  '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]',
  '[data-selected="true"]',
] as const;

/** `[a]:not([b])…` → one attribute of specificity, the rest under `:where()`. */
function oneAttribute(state: string): string {
  const first = /^\[[^\]]+\]/.exec(state)![0];
  const rest = state.slice(first.length);
  return rest ? `${first}:where(${rest})` : first;
}

/** Hover that a disabled control never takes. */
const HOVER = ":hover:where(:not(:disabled):not([aria-disabled=\"true\"]))";

const selected = (base: string) => SELECTED_STATES.map((s) => `${base}${oneAttribute(s)}`).join(", ");

/** Tailwind's `transition-colors` (property list, 150ms, the default ease) — mirrored. */
export const COLOR_TRANSITION =
  "color 150ms cubic-bezier(0.4, 0, 0.2, 1), background-color 150ms cubic-bezier(0.4, 0, 0.2, 1), border-color 150ms cubic-bezier(0.4, 0, 0.2, 1), outline-color 150ms cubic-bezier(0.4, 0, 0.2, 1), text-decoration-color 150ms cubic-bezier(0.4, 0, 0.2, 1), fill 150ms cubic-bezier(0.4, 0, 0.2, 1), stroke 150ms cubic-bezier(0.4, 0, 0.2, 1)";
/** `disabled:opacity-40` — mirrored. */
export const DISABLED_OPACITY = "0.4";

/** A chrome type tier as declarations (px; the tier's line height, or none). */
export function typeTier(tier: TextTier): Record<string, string> {
  const m = TEXT_METRICS[tier];
  return m.leading === null ? { fontSize: `${m.size}px` } : { fontSize: `${m.size}px`, lineHeight: `${m.leading}px` };
}

const SIZES = Object.keys(CONTROL_SIZE) as ControlSize[];

/** A ruler tier's height, inset and type — what `.ome-btn-<size>` / `.ome-field-<size>` set. */
function rulerTier(size: ControlSize): Record<string, string> {
  const r = CONTROL_SIZE[size];
  return { height: `${r.px}px`, paddingLeft: `${r.padPx}px`, paddingRight: `${r.padPx}px`, ...typeTier(r.type) };
}

/** The primitives as a style spec (exported so the mirror test reads the rules themselves). */
export const PRIMITIVE_STYLES: Record<string, Record<string, string>> = {
  // What Tailwind's preflight gives every element in the app, for the
  // editor's own DOM: border-box sizing (a table cell's padding sits inside
  // its max-width) and a rule with no UA margin. Zero specificity: anything
  // the editor or a host says wins.
  ":where(&) *, :where(&) *::before, :where(&) *::after": { boxSizing: "border-box" },
  ":where(&) :where(hr)": { height: "0", margin: "0", color: "inherit" },
  ":where(&) :where(table)": { textIndent: "0", borderColor: "inherit" },

  // The text column is not a control: a host's generic focus ring (a global
  // `:focus-visible { outline; box-shadow; border-radius }`, specificity
  // (0,1,0)) must not frame the whole document. Scoped under the theme's class,
  // so it wins without `!important`; the editor's own focus indication — the
  // caret and the selection — is untouched. Bare key on purpose: nested
  // editors (a table cell being edited) are covered too. The app's own reset
  // for contenteditable (index.css) says the same. (spec: editor-host /
  // 宿主的通用焦点样式不落在编辑区)
  ".cm-content:focus, .cm-content:focus-visible": { outline: "none", boxShadow: "none", borderRadius: "0" },

  // A factory control's box (the raw-DOM twin of Button / IconButton). First,
  // so the size, weight and ink rules below override its resets.
  ".ome-btn": {
    boxSizing: "border-box",
    margin: "0",
    padding: "0",
    font: "inherit",
    letterSpacing: "inherit",
    color: "inherit",
    backgroundColor: "transparent",
    border: "0 solid",
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
    transition: COLOR_TRANSITION,
  },
  ".ome-btn:disabled": { cursor: "not-allowed", opacity: DISABLED_OPACITY },
  ...Object.fromEntries(SIZES.map((s) => [`.ome-btn-${s}`, rulerTier(s)])),
  ...Object.fromEntries(
    SIZES.map((s) => [`.ome-btn-${s}.ome-btn-icon`, { width: `${CONTROL_SIZE[s].px}px`, paddingLeft: "0", paddingRight: "0" }]),
  ),
  ".ome-outline": { borderWidth: "1px", borderColor: "var(--ome-border)", color: "var(--ome-fg)" },
  // Keyboard focus is a ring, not a state: the accent, inset, following the corner.
  ".ome-btn:focus-visible": { outline: "2px solid var(--ome-accent)", outlineOffset: "-2px" },

  // A field's frame: --ome-border at rest, the accent while focused.
  ".ome-field": {
    boxSizing: "border-box",
    margin: "0",
    font: "inherit",
    letterSpacing: "inherit",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--ome-border)",
    borderRadius: "var(--ome-radius)",
  },
  ".ome-field:focus-within": { borderColor: "var(--ome-accent)" },
  ...Object.fromEntries(SIZES.map((s) => [`.ome-field-${s}`, rulerTier(s)])),

  // The state layer. Reset on every `.ome-state` so a nested one never paints
  // its parent's layer (the custom property inherits).
  [`.${EDITOR_STATE_CLASS}`]: {
    "--ome-state-layer": "none",
    borderRadius: "var(--ome-radius)",
    backgroundImage: "var(--ome-state-layer)",
  },
  [`.${EDITOR_STATE_CLASS}${HOVER}`]: {
    "--ome-state-layer": "linear-gradient(var(--ome-state-hover), var(--ome-state-hover))",
  },
  [selected(`.${EDITOR_STATE_CLASS}`)]: {
    "--ome-state-layer": "linear-gradient(var(--ome-state-selected), var(--ome-state-selected))",
  },
  // Muted ink (a ghost control, a muted content mark) rises to the text
  // colour in either state (AA on the fill).
  [`.${EDITOR_INK_MUTED_CLASS}`]: { color: "var(--ome-muted-fg)" },
  [`.${EDITOR_STATE_CLASS}.${EDITOR_INK_MUTED_CLASS}${HOVER}, ${selected(`.${EDITOR_STATE_CLASS}.${EDITOR_INK_MUTED_CLASS}`)}`]: {
    color: "var(--ome-fg)",
  },

  // Glyphs (spec: editor-host / 内核样式只经注入样式表). Sized and placed by
  // CLASS, never by a `style` attribute in the markup: a strict
  // `style-src 'self' 'nonce-…'` blocks parsed style attributes, while these
  // rules arrive through CodeMirror's nonce'd stylesheet. A control's glyph
  // keeps its pixel size as SVG `width` / `height` attributes (presentation
  // attributes, not styles); a content mark's size is its tier, zoomed.
  [`.${EDITOR_GLYPH_CLASS}`]: { display: "block", flex: "none" },
  ...Object.fromEntries(
    (Object.keys(ICON_SIZE) as IconTier[]).map((t) => {
      const side = zoomed(`${ICON_SIZE[t]}px`);
      return [`.${contentMarkClass(t)}`, { width: side, height: side }];
    }),
  ),

  // Chrome type tiers.
  ...Object.fromEntries((Object.keys(TEXT_METRICS) as TextTier[]).map((t) => [`.ome-type-${t}`, typeTier(t)])),
};

export const editorPrimitives = EditorView.baseTheme(PRIMITIVE_STYLES);

/**
 * Custom properties the editor needs REGISTERED (a typed, resolved value):
 * `--om-fold-left` is a <length> resolved on the line that sets it, so the
 * composer's `em` lengths compute in the line's font and inherit as px into
 * the fold toggle, whose own type size differs (writer:
 * `insets/decorate.ts`). Registered from here, once per page, so a host needs
 * no stylesheet for it; a page that registered it already keeps its own.
 */
export const REGISTERED_PROPERTIES = [
  { name: "--om-fold-left", syntax: "<length>", inherits: true, initialValue: "0px" },
] as const;

let registered = false;
function registerProperties(): void {
  if (registered) return;
  registered = true;
  const css = (globalThis as { CSS?: { registerProperty?: (p: object) => void } }).CSS;
  if (!css?.registerProperty) return;
  for (const p of REGISTERED_PROPERTIES) {
    try {
      css.registerProperty(p);
    } catch {
      // Already registered on this page: the first registration stands.
    }
  }
}

const propertyRegistration = ViewPlugin.define(() => {
  registerProperties();
  return {};
});

/** Everything that makes the editor's look self-contained, outer and nested editors alike. */
export const editorStyleBase = [editorPrimitives, propertyRegistration];
