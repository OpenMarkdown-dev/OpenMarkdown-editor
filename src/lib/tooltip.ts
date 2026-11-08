/**
 * The app's one tooltip (spec: app-chrome / 悬停提示只有一个实现).
 *
 * An element declares its hint with `data-tip`; this module, installed once
 * (`App.tsx`), shows it. It replaces the browser's native `title`, whose timing
 * belongs to the system (about a second on macOS), never shows on keyboard
 * focus, and ignores the theme. Attribute-driven and delegated, so React chrome
 * and the editor's raw-DOM widgets use the same layer with nothing to wrap.
 * Escape is the overlay stack's: a shown tip is its topmost non-modal layer.
 * `tooltip.gate.test.ts` fails on a native `title` anywhere in product code.
 */
import { TEXT } from "@/components/ui/type";
import { pushLayer } from "@/components/ui/overlayStack";

/** Pointer rest before a tip shows. */
export const TIP_DELAY_MS = 300;
/** After a tip hides, the next one within this window shows at once. */
export const TIP_WARM_MS = 500;
/** Anchor edge ↔ tip edge, and the tip's minimum distance from the window edge. */
export const TIP_GAP_PX = 6;

/** The attribute a hinted element carries. */
export const TIP_ATTR = "data-tip";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the tip goes: below the anchor, centred; above it when below does not
 * fit; x clamped so the whole tip stays inside the viewport. Pure.
 */
export function placeTip(
  anchor: Box,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number; side: "below" | "above" } {
  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  const x = Math.max(TIP_GAP_PX, Math.min(centred, viewport.width - tip.width - TIP_GAP_PX));
  const below = anchor.top + anchor.height + TIP_GAP_PX;
  if (below + tip.height <= viewport.height - TIP_GAP_PX) return { x, y: below, side: "below" };
  return { x, y: Math.max(TIP_GAP_PX, anchor.top - TIP_GAP_PX - tip.height), side: "above" };
}

/**
 * The attributes that give an element a hint. `name: true` for an icon-only
 * control: the hint is its accessible name. Otherwise the element's visible
 * text stays its name and the hint is read as its description.
 */
export function tipAttrs(text: string, opts: { name?: boolean } = {}): Record<string, string> {
  return opts.name
    ? { [TIP_ATTR]: text, "aria-label": text }
    : { [TIP_ATTR]: text, "aria-description": text };
}

/** Classes of the one tip element: an inverse label chip, never a surface. */
const TIP_CLASS = `pointer-events-none fixed z-[70] max-w-80 whitespace-pre-line rounded-md bg-foreground px-2 py-1 text-background shadow-md ${TEXT.label}`;

/** Install the layer; returns the cleanup. Idempotent per call site (App mounts it once). */
export function installTooltips(doc: Document = document): () => void {
  const win = doc.defaultView ?? window;
  const el = doc.createElement("div");
  el.setAttribute("role", "tooltip");
  el.setAttribute("data-om-tooltip", "");
  el.className = TIP_CLASS;
  el.hidden = true;
  doc.body.appendChild(el);

  let anchor: HTMLElement | null = null;
  let timer: number | undefined;
  let hiddenAt = -Infinity;
  // While a tip is up it is the topmost (non-modal) layer, so Escape — owned
  // by the overlay stack, never by a second listener — dismisses the tip
  // first, without moving focus, and the next Escape reaches the layer below.
  let popLayer: (() => void) | null = null;

  const hintedFrom = (t: EventTarget | null): HTMLElement | null =>
    t instanceof Element ? (t.closest(`[${TIP_ATTR}]`) as HTMLElement | null) : null;

  const show = (target: HTMLElement) => {
    const text = target.getAttribute(TIP_ATTR);
    if (!text || !target.isConnected) return;
    el.textContent = text;
    el.hidden = false;
    const r = target.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const p = placeTip(r, t, { width: win.innerWidth, height: win.innerHeight });
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.dataset.side = p.side;
    popLayer ??= pushLayer({ modal: false, transient: true, dismiss: hide, element: () => el });
  };

  function hide() {
    win.clearTimeout(timer);
    timer = undefined;
    if (!el.hidden) hiddenAt = performance.now();
    el.hidden = true;
    anchor = null;
    const pop = popLayer;
    popLayer = null;
    pop?.();
  }

  const arm = (target: HTMLElement) => {
    if (anchor === target) return;
    hide();
    anchor = target;
    const warm = performance.now() - hiddenAt < TIP_WARM_MS;
    if (warm) show(target);
    else timer = win.setTimeout(() => anchor === target && show(target), TIP_DELAY_MS);
  };

  const onOver = (e: PointerEvent) => {
    const t = hintedFrom(e.target);
    if (t) arm(t);
    else if (anchor) hide();
  };
  const onOut = (e: PointerEvent) => {
    if (!anchor) return;
    const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (!to || !anchor.contains(to)) hide();
  };
  const onFocusIn = (e: FocusEvent) => {
    const t = hintedFrom(e.target);
    if (t && t.matches(":focus-visible")) arm(t);
  };

  doc.addEventListener("pointerover", onOver);
  doc.addEventListener("pointerout", onOut);
  doc.addEventListener("pointerdown", hide, true);
  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("focusout", hide);
  win.addEventListener("scroll", hide, true);
  win.addEventListener("blur", hide);
  return () => {
    hide();
    doc.removeEventListener("pointerover", onOver);
    doc.removeEventListener("pointerout", onOut);
    doc.removeEventListener("pointerdown", hide, true);
    doc.removeEventListener("focusin", onFocusIn);
    doc.removeEventListener("focusout", hide);
    win.removeEventListener("scroll", hide, true);
    win.removeEventListener("blur", hide);
    el.remove();
  };
}
