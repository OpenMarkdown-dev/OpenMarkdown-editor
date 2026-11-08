/**
 * The live-preview configuration facet, split out of `livePreview.ts` so that
 * modules BELOW it in the import graph can read it too.
 *
 * `livePreview.ts` imports `./widgets`, so anything in `widgets.ts` that needs the
 * config (e.g. `TableWidget` following a link out of a rendered cell — change:
 * table-cell-link-navigation) cannot import it back from `livePreview.ts` without
 * creating a cycle. Both now depend on this leaf module instead. `livePreview.ts`
 * re-exports these names, so existing importers are unaffected.
 */

import { Facet } from "@codemirror/state";
import { editorImageSrc } from "./safeUrl";

export interface LivePreviewConfig {
  /** false = reading mode: always render, never reveal source. */
  revealOnSelection: boolean;
  /**
   * Resolve an image src to a loadable URL. Returns `null` when the local path
   * is outside the asset-protocol whitelist (or unresolvable), signalling the
   * image should degrade to source display (spec: 白名单外路径降级).
   */
  resolveImage: (src: string) => string | null;
  /** URL length (chars) beyond which a touched reference collapses to a chip. */
  chipThreshold?: number;
  /**
   * Open document's directory — relative local links resolve against it (spec:
   * 链接点击导航). null = unsaved document → relative links are unresolvable.
   */
  docDir?: string | null;
  /**
   * Navigate to a local file target in-app (spec: 本地相对链接在 app 内导航).
   * Injected — not imported — so the editor layer stays decoupled from the
   * workspace store; the callback owns the `paths_exist` gate and MUST NOT
   * create a missing file.
   */
  openLink?: (absPath: string, fragment: string | null) => void;
}

export const livePreviewConfig = Facet.define<LivePreviewConfig, LivePreviewConfig>({
  combine: (values) =>
    // No config: the no-host image policy (`safeUrl.ts` — https only).
    values[0] ?? { revealOnSelection: true, resolveImage: (s: string) => editorImageSrc(s) },
});
