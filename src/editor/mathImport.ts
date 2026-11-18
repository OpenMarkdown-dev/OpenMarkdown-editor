import { loadWithoutWarning } from "@/lib/log";
import type { TemmlModule } from "./math";

/**
 * The editor's one `import("temml")` (change: editor-lean-deps; spec:
 * editor-package / 入口与内置渲染器): the built-in formula renderer's load,
 * installed by the entries that carry it (`./index.ts`, `./noDiagrams.ts`).
 * Everything else about math lives in `./math.ts`, which never names the
 * package, so the entry without built-in renderers (`./base.ts`) never
 * reaches Temml and a bundler — an IIFE one included — never inlines it.
 *
 * Temml warns on load when the page is in quirks mode (a test DOM without a
 * doctype, say). The warning is about Temml's `render()` into the page; the
 * editor only calls `renderToString`, which works the same in any mode — so
 * that one message is dropped (spec: live-preview-editor / 公式与图表经可替换的
 * 渲染器).
 */
export const TEMML_QUIRKS_WARNING =
  "Warning: Temml doesn't work in quirks mode. Make sure your website has a suitable doctype.";

export const importTemml = (): Promise<TemmlModule> =>
  loadWithoutWarning(TEMML_QUIRKS_WARNING, () => import("temml")).then(
    (m) => ((m as unknown as { default?: TemmlModule }).default ?? (m as unknown as TemmlModule)),
  );
