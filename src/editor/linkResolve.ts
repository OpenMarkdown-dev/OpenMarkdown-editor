/**
 * Pure classification of a markdown link `href` into a navigation target
 * (spec: live-preview-editor / 链接点击导航). The editor's Cmd/Ctrl+click handler
 * feeds the raw href + the open document's directory here and routes by `kind`.
 *
 * Mirrors `imageResolve.ts` (reuses `isRemoteSrc` / `normalizePosix`) but DROPS
 * its `withinDir` security clamp: an image src must stay inside the
 * asset-protocol whitelist, whereas a link only "opens another file in the app"
 * and may legitimately point at `../sibling.md`. Kept free of CodeMirror / Tauri
 * so it can be unit-tested (dev note: editor logic lives in pure helpers).
 */

import { normalizePosix } from "./imageResolve";
import { isScriptUrl, normalizeUrl, urlScheme } from "./safeUrl";

export type LinkTarget =
  /** Has a URL scheme (`https:` / `mailto:` / …) → the external-open funnel decides. */
  | { kind: "external"; url: string }
  /** Pure `#heading` → scroll within the current document. */
  | { kind: "anchor"; heading: string }
  /**
   * Relative (resolved against `docDir`) or absolute local path → open in-app if
   * it exists. `heading` carries a cross-document `#frag`, handed to the host
   * with the path (`EditorHost.openLink`).
   */
  | { kind: "local"; absPath: string; heading: string | null }
  /** Relative path with no `docDir` to resolve against (unsaved document). */
  | { kind: "unresolvable" }
  /**
   * A script-capable URL (`javascript:` / `vbscript:` / `data:` …, however
   * obfuscated — `safeUrl.ts`): followed nowhere, handed to no host callback
   * (spec: editor-host / 不可信内容渲染不执行脚本).
   */
  | { kind: "blocked"; url: string; scheme: string };

/** decodeURIComponent that never throws on a malformed sequence (`%`, `%zz`). */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Classify a link `href` relative to the open document's directory:
 * - script-capable URL (`javascript:` / `vbscript:` / `data:` …) → `blocked`;
 * - scheme URL → `external` (the external-open funnel; docDir irrelevant);
 * - pure `#anchor` → `anchor` (same-document scroll);
 * - absolute path → `local` (docDir irrelevant);
 * - relative path with a `docDir` → `local` resolved against it (`..` may escape);
 * - relative path with no `docDir`, or a blank href → `unresolvable`.
 *
 * The path is `%`-decoded (markdown often `%20`-encodes spaces); a `#fragment`
 * is split off BEFORE decoding so an encoded `%23` in the filename survives.
 */
export function resolveLinkTarget(rawHref: string, docDir: string | null): LinkTarget {
  // A CommonMark pointy-bracket destination `[x](<…>)` arrives with its
  // brackets (the grammar's URL node includes them); the target is inside.
  const trimmed = rawHref.trim();
  const href = /^<[^<>]*>$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
  if (!href) return { kind: "unresolvable" };

  // Script-capable URL — refused before anything else, read as a browser
  // would read it (entities decoded, tabs / newlines dropped).
  if (isScriptUrl(href)) return { kind: "blocked", url: href, scheme: urlScheme(href) as string };

  // External URL (has a scheme, as a browser would see it) — classified before
  // anything else so an absolute URL with a `#fragment` never reads as an
  // anchor / local path. The host gets the normalised URL, the one a browser
  // would follow.
  if (urlScheme(href) !== null) return { kind: "external", url: normalizeUrl(href) };

  // Pure same-document anchor.
  if (href.startsWith("#")) return { kind: "anchor", heading: safeDecode(href.slice(1)) };

  // Local path, optionally with a `#fragment`. Split on the literal `#` first
  // (before decoding), then decode each part.
  const hash = href.indexOf("#");
  const path = safeDecode(hash === -1 ? href : href.slice(0, hash));
  const heading = hash === -1 ? null : safeDecode(href.slice(hash + 1));

  if (path.startsWith("/")) return { kind: "local", absPath: normalizePosix(path), heading };

  // Relative path needs a directory to resolve against.
  if (!docDir) return { kind: "unresolvable" };
  return { kind: "local", absPath: normalizePosix(docDir + "/" + path), heading };
}
