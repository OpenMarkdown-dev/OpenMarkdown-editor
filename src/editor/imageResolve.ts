/**
 * Pure resolution of a markdown image `src` to a loadable URL (spec:
 * reference-rendering / 本地资源经 asset-protocol 白名单渲染).
 *
 * Kept free of CodeMirror / Tauri so it can be unit-tested (dev note: editor
 * logic lives in pure helpers — EditorView can't be constructed in node).
 * The caller injects `toAssetUrl` (= `convertFileSrc` in the app) and the open
 * document's directory; this module owns the security boundary: a local path is
 * resolved against `docDir` and MUST stay within it, otherwise it returns
 * `null` so the live-preview layer degrades to source display.
 */

/** A src with a URL scheme (`http:`, `https:`, `data:`, `file:`, …). */
export function isRemoteSrc(src: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src);
}

/** Collapse `.`/`..` segments in a POSIX path (no FS access). */
export function normalizePosix(path: string): string {
  const isAbs = path.startsWith("/");
  const stack: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length && stack[stack.length - 1] !== "..") stack.pop();
      else if (!isAbs) stack.push("..");
      // Absolute path with an empty stack: `..` above root is a no-op.
    } else {
      stack.push(part);
    }
  }
  return (isAbs ? "/" : "") + stack.join("/");
}

/** True when `abs` is `dir` itself or nested under it. */
export function withinDir(abs: string, dir: string): boolean {
  const nd = normalizePosix(dir);
  return abs === nd || abs.startsWith(nd + "/");
}

/**
 * Resolve a markdown image `src`:
 * - remote / data / any `scheme:` URL → returned unchanged;
 * - local path (relative to `docDir`, or absolute) that stays within `docDir` →
 *   `toAssetUrl(absolutePath)`;
 * - no `docDir` (browser dev / unsaved), or a local path that escapes `docDir`
 *   (the asset-protocol whitelist boundary) → `null` (caller shows source).
 */
export function resolveImageSrc(
  rawSrc: string,
  docDir: string | null,
  toAssetUrl: (absPath: string) => string,
): string | null {
  const src = rawSrc.trim();
  if (!src) return null;
  if (isRemoteSrc(src)) return src;
  if (!docDir) return null;
  const abs = src.startsWith("/")
    ? normalizePosix(src)
    : normalizePosix(docDir + "/" + src);
  if (!withinDir(abs, docDir)) return null;
  return toAssetUrl(abs);
}
