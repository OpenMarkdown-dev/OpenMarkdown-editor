/**
 * Startup timing instrumentation (spec: app-startup / cold-start budget).
 *
 * Marks are relative to performance.timeOrigin (webview navigation start).
 * The Rust side logs process-start → window-created separately; together
 * they form the full cold-start trace.
 */

const marks: Record<string, number> = {};

export function perfMark(name: string) {
  marks[name] = performance.now();
  performance.mark(`om:${name}`);
}

export function perfTrace(): Record<string, number> {
  return { ...marks };
}

/**
 * Where a perf line goes when one is installed (see `setPerfLogSink`); null →
 * the console.
 */
let perfLogSink: ((line: string) => void) | null = null;

/**
 * Route perf lines somewhere other than the console (spec: perf-instrumentation /
 * dev 可读). The app installs one at startup (`main.tsx`): in Tauri the
 * WKWebView console does NOT reach the `tauri dev` terminal, so its sink sends
 * the line through a Rust command that logs via `log::info!` (which does).
 *
 * Injected rather than imported here: this module is an allowlisted leaf of the
 * editor core (`editorBoundary.gate.test.ts`), and an `import("./backend")`
 * in it put the whole backend wrapper — Tauri, the app dictionary, the store,
 * React — into the published editor package as a lazy chunk (change:
 * editor-package; gate: `scripts/check-editor-package.mjs`).
 */
export function setPerfLogSink(sink: ((line: string) => void) | null): void {
  perfLogSink = sink;
}

/** Emit a perf line so a measurement session can read it: the installed sink, else the console. */
export function perfLog(line: string): void {
  if (perfLogSink) {
    perfLogSink(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}
