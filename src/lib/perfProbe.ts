import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { perfLog } from "./perf";

/**
 * Editor performance probes (spec: perf-instrumentation).
 *
 * Dev-only + opt-in, DEFAULT OFF, a single flag for all probes. When off the
 * editor never attaches the keystroke extension and every timing site collapses
 * to one constant branch — the hot paths (keystroke, decoration rebuild, large-
 * file open) carry ZERO probe cost, the spec's headline invariant.
 *
 * Enable for a measurement session: in a dev build run
 *   localStorage['om.perf'] = '1'
 * then reload. Read once at module load (a probe session, not a runtime
 * feature), so the hot-path check stays a plain constant.
 *
 * Probes:
 *  - keystroke A (perceived): keydown → next animation frame — full input→paint,
 *    what typing feels like; also covers cursor-move latency (arrows rebuild
 *    decorations — the ❹ concern).
 *  - keystroke B (compute): livePreview decoration rebuild time (recordBuildMs).
 *  - keystroke toString: per-keystroke doc.toString() serialization time
 *    (recordToStringMs) — scales with document size (the ❷ concern).
 *  - open: EditorState.create (parse + setup) vs new EditorView (first render +
 *    first build), by document size — large-file open latency (logOpen).
 */

/** Pure gate so it is unit-testable without import.meta.env / localStorage. */
export function shouldEnable(isDev: boolean, flag: string | null): boolean {
  return isDev && flag === "1";
}

function readEnabled(): boolean {
  // A production build folds this to `return false`: no storage read at all —
  // the published editor package must not touch an embedder's localStorage.
  if (!import.meta.env.DEV) return false;
  try {
    // Convenience enable for a driven measurement session (WKWebView has no
    // agent-reachable devtools to set the localStorage flag): `VITE_PERF=1
    // npm run tauri dev`. Dev-only, still default OFF when unset.
    if (import.meta.env.DEV && import.meta.env.VITE_PERF === "1") return true;
    return shouldEnable(import.meta.env.DEV, localStorage.getItem("om.perf"));
  } catch {
    // No localStorage (SSR / node) → off.
    return false;
  }
}

/** Read once at module load; toggling requires a reload. */
export const perfProbeEnabled = readEnabled();

let lastBuildMs = 0;
let lastToStringMs = 0;

/** livePreview reports its decoration-rebuild time (B) here. Callers guard on
 *  `perfProbeEnabled` first so a disabled build does no timing work. */
export function recordBuildMs(ms: number): void {
  lastBuildMs = ms;
}

/** The editor reports its per-keystroke doc.toString() time here. */
export function recordToStringMs(ms: number): void {
  lastToStringMs = ms;
}

/** Large-file open segmented timing, logged once per editor creation. */
export function logOpen(sizeChars: number, parseSetupMs: number, viewMs: number): void {
  perfLog(
    `[perf.open] ${sizeChars} chars | state+parse ${parseSetupMs.toFixed(1)}ms | ` +
      `view+firstBuild ${viewMs.toFixed(1)}ms | total ${(parseSetupMs + viewMs).toFixed(1)}ms`,
  );
}

/**
 * Find-panel total-count scan timing (change: find-count-perf). Logged each time
 * the panel recomputes the match total (query/doc change) — the O(document) cost
 * this change caches away from every cursor move. Callers guard on
 * `perfProbeEnabled` first, so a disabled build does no timing work.
 */
export function logFindCount(matches: number, scanMs: number): void {
  perfLog(`[perf.find-count] ${matches} matches | total-scan ${scanMs.toFixed(2)}ms`);
}

// At most one in-flight A measurement per frame, so fast typing can't stack
// rAF callbacks (natural sampling).
let pending = false;

/**
 * CM extension measuring keystroke A (keydown → next frame). Added to the editor
 * only when `perfProbeEnabled`. Logs A alongside the last build (B) and toString
 * times, so one line shows perceived latency and its two main compute costs.
 */
export const keystrokeProbe: Extension = EditorView.domEventHandlers({
  keydown: () => {
    if (pending) return false;
    pending = true;
    const t0 = performance.now();
    requestAnimationFrame(() => {
      pending = false;
      const perceived = performance.now() - t0;
      perfLog(
        `[perf.keystroke] input→frame ${perceived.toFixed(1)}ms | ` +
          `build ${lastBuildMs.toFixed(1)}ms | toString ${lastToStringMs.toFixed(1)}ms`,
      );
    });
    return false; // never consume the event
  },
});
