/**
 * UI-state persistence (design D8): localStorage holds window/UI state
 * (region widths, split ratios, zoom); settings.json stays user preferences only.
 */

export const UI_KEYS = {
  /**
   * Both regions' widths + every stack's split ratios (spec: panel-regions /
   * 记忆的边界 — app level, so switching homes never moves a divider). Seeded
   * once from the legacy widths below.
   */
  panelLayout: "om.ui.panelLayout",
  /**
   * LEGACY, read-only (pre-`panel-regions`): the last sidebar width. Seeds
   * `panelLayout` on first run when no home remembers a width.
   */
  sidebarWidth: "om.ui.sidebarWidth",
  /**
   * LEGACY, read-only. Pre-`file-home` app-level sidebar state, read once by
   * the home migration (folder workspaces showed their tree).
   */
  sidebarCollapsed: "om.ui.sidebarCollapsed",
  outlineOverlayEnabled: "om.ui.outlineOverlayEnabled",
  /**
   * The folds of the window-scoped panel cards (家): one list for the whole
   * window, shared by every home (change panel-chrome, design D27).
   */
  windowFolded: "om.ui.windowFolded",
  zoom: "om.ui.zoom",
  recentFiles: "om.ui.recentFiles",
} as const;

export function loadUi<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveUi(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private-mode / quota failures degrade to session-only state.
  }
}

/** MRU cap (palette-anywhere D2): plenty for a palette page, tiny on disk. */
const RECENT_FILES_MAX = 20;

/**
 * Recently opened files, most recent first (palette-anywhere D2). A separate
 * namespace from the per-home memory (`om.home:<root>`): that is a "where was I
 * in this home" snapshot, reusing it as history would cross-pollute both.
 */
export function loadRecentFiles(): string[] {
  const raw = loadUi<unknown>(UI_KEYS.recentFiles, []);
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
}

/** Prepend a path to the MRU: dedupe, cap at RECENT_FILES_MAX. */
export function pushRecentFile(path: string): void {
  const next = [path, ...loadRecentFiles().filter((p) => p !== path)];
  saveUi(UI_KEYS.recentFiles, next.slice(0, RECENT_FILES_MAX));
}
