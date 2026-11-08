/**
 * The overlay stack (spec: command-registry / 浮层栈拥有 Escape、焦点归还与模态作用域).
 *
 * Every layer that floats over the window — the palette, the settings panel,
 * the cheat sheet, the feedback composer, a confirm dialog, a menu — pushes
 * itself here while it is on screen. The stack is the ONE owner of three
 * things that used to be re-implemented per overlay, each slightly wrong:
 *
 * - **Escape** dismisses the TOPMOST layer only. One window-capture listener,
 *   installed on the first push, swallows the key so it never also reaches the
 *   layer underneath (a confirm dialog over settings used to close both).
 * - **Focus return**: a layer remembers what had focus when it opened and gives
 *   it back when it closes — unless focus has already moved somewhere real
 *   (a command the layer ran focused the intercom input, say).
 * - **Modal scope**: while any `modal` layer is open, `runCommand` refuses
 *   ambient invocations (global shortcuts, native-menu accelerators) of
 *   commands that are not `modalSafe` — ⌘W with settings open must not close
 *   the tab hidden behind it.
 *
 * Pure module (no React): the hook in `useOverlayLayer.ts` is a thin adapter,
 * and the logic is unit-tested in node without a DOM.
 */

export interface OverlayLayer {
  /** A modal layer blocks ambient commands; a menu is not modal. */
  modal: boolean;
  /** Called on Escape (and ⌘W for a modal) when this layer is on top. */
  dismiss(): void;
  /** The layer's root element, if any — used to decide whether focus is "ours". */
  element?: () => Element | null;
  /**
   * A hint, not a surface (the tooltip): Escape dismisses it like any top
   * layer, but it never stands in front for anything else — `dismissTop`
   * (⌘W over a modal) passes it by.
   */
  transient?: boolean;
}

interface Entry extends OverlayLayer {
  key: number;
  returnFocus: Element | null;
}

const stack: Entry[] = [];
let nextKey = 1;
let installed = false;

function activeElement(): Element | null {
  return typeof document === "undefined" ? null : document.activeElement;
}

function focusable(el: Element | null): el is HTMLElement {
  return !!el && typeof (el as HTMLElement).focus === "function" && el.isConnected !== false;
}

/**
 * Escape: one listener for the whole app, window capture phase so it runs
 * before any element handler. IME composition keeps its Escape (it cancels the
 * candidate, not the panel).
 */
export function handleEscapeKey(
  e: Pick<KeyboardEvent, "key" | "isComposing" | "preventDefault" | "stopPropagation">,
): boolean {
  if (e.key !== "Escape" || e.isComposing) return false;
  const top = stack[stack.length - 1];
  if (!top) return false;
  e.preventDefault();
  e.stopPropagation();
  top.dismiss();
  return true;
}

function install(): void {
  if (installed || typeof window === "undefined" || !window.addEventListener) return;
  installed = true;
  window.addEventListener("keydown", (e) => void handleEscapeKey(e), true);
}

/** Push a layer; returns its pop. Popping twice is harmless. */
export function pushLayer(layer: OverlayLayer): () => void {
  install();
  const entry: Entry = { ...layer, key: nextKey++, returnFocus: activeElement() };
  stack.push(entry);
  return () => {
    const i = stack.findIndex((e) => e.key === entry.key);
    if (i === -1) return;
    stack.splice(i, 1);
    restoreFocus(entry);
  };
}

/**
 * Give focus back — but only if nobody else has taken it. "Nobody" = focus is
 * on the body, gone, or still inside the layer that just closed.
 */
function restoreFocus(entry: Entry): void {
  const now = activeElement();
  const root = entry.element?.() ?? null;
  const orphaned =
    now === null ||
    (typeof document !== "undefined" && now === document.body) ||
    (root !== null && root.contains(now));
  if (orphaned && focusable(entry.returnFocus)) entry.returnFocus.focus();
}

/** Is any modal layer open? The modal-scope test `runCommand` reads. */
export function isModalOpen(): boolean {
  return stack.some((e) => e.modal);
}

/** Dismiss the topmost non-transient layer; false when there is none. */
export function dismissTop(): boolean {
  const top = [...stack].reverse().find((e) => !e.transient);
  if (!top) return false;
  top.dismiss();
  return true;
}

/** Number of open layers (tests / harness). */
export function layerCount(): number {
  return stack.length;
}

/** Test-only: forget every layer without dismissing. */
export function resetOverlayStack(): void {
  stack.length = 0;
}
