import { createSignal } from "./signal";
import { loadUi, saveUi, UI_KEYS } from "./uiState";

const MIN = 0.5;
const MAX = 2.0;
const STEP = 0.1;

/**
 * The ONE source of the content scale (spec: workspace-shell / UI 缩放). Content
 * surfaces derive their size from it: the editor's font size and text column
 * (src/editor/theme.ts) and the `.om-content-zoom` panel bodies (index.css).
 * Chrome — every bar and head, tabs, head icons, the sidebar switch, menus, the
 * palette, settings — never reads it; `check-app-surface.mjs` holds that line.
 */
export const CONTENT_ZOOM_VAR = "--om-content-zoom";

/**
 * Emitted after the scale changes. A CSS variable changing restyles the editor
 * but does not resize its scroller, so CodeMirror would not notice its line
 * heights moved; the editor subscribes and re-measures. A signal, not a
 * `window` event (change: feedback, design D8): one pub/sub for the app.
 */
export const contentZoomChanged = createSignal();

let level = 1;

/** The current content scale — for a surface that sizes its type in JS (the terminal). */
export function contentZoom(): number {
  return level;
}

/** Clamp to 0.5–2.0 and round to one decimal, so repeated ± steps never drift. */
export function clampZoom(next: number): number {
  if (!Number.isFinite(next)) return 1;
  return Math.round(Math.min(Math.max(next, MIN), MAX) * 10) / 10;
}

function apply(next: number): void {
  level = clampZoom(next);
  saveUi(UI_KEYS.zoom, level);
  document.documentElement.style.setProperty(CONTENT_ZOOM_VAR, String(level));
  contentZoomChanged.emit();
}

/**
 * Apple Notes-style content zoom: enlarge or shrink the TEXT — the document and
 * the panels' contents — and never the chrome around it. Clamped 0.5–2.0,
 * restored from localStorage on startup (spec: UI 缩放). The webview's own zoom
 * is never touched: a whole-page zoom would scale the chrome row and push it
 * off the native traffic lights.
 *
 * The three actions are registry commands (`view.zoomIn` / `view.zoomOut` /
 * `view.zoomReset`, ⌘= / ⌘- / ⌘0, change: command-registry) — this module owns
 * the scale, not a keydown listener of its own.
 */
export function zoomIn(): void {
  apply(level + STEP);
}

export function zoomOut(): void {
  apply(level - STEP);
}

export function zoomReset(): void {
  apply(1);
}

/** Restore the persisted scale on startup. No-op outside Tauri. */
export function initZoom(): () => void {
  if (!("__TAURI_INTERNALS__" in window)) return () => {};
  level = loadUi(UI_KEYS.zoom, 1);
  if (level !== 1) apply(level);
  return () => {};
}
