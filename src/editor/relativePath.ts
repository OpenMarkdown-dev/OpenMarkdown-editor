/**
 * Pure POSIX path relativization — shared by change: sidebar-drag-link (从侧栏拖入
 * 工作区文件插入相对链接) and change: link-autocomplete. Given the linking
 * document's directory and an absolute target, produce the relative path to write
 * into a markdown link so it resolves back to the target — the inverse of
 * `linkResolve.ts` (which joins docDir + relative). Kept free of CodeMirror /
 * Tauri so it can be unit-tested (dev note: editor logic lives in pure helpers —
 * EditorView can't be constructed in node). Reuses `imageResolve.ts`'s
 * `normalizePosix` to fold `.`/`..`/trailing slashes before diffing segments.
 */

import { normalizePosix } from "./imageResolve";

/**
 * Relative path from `fromDir` (the linking document's directory) to `toAbs`
 * (an existing workspace file's absolute path). Both are normalized first, then
 * their common prefix is stripped: each remaining `fromDir` segment becomes a
 * `..` and the remaining target segments are appended.
 *
 * - same dir       → bare filename (`a.md`)
 * - subdir         → `sub/b.md`
 * - ancestor       → `../x.md`, `../../x/y.md`
 * - sibling branch → `../a/b.md`
 * - identical      → `.`
 */
export function relativePath(fromDir: string, toAbs: string): string {
  const from = normalizePosix(fromDir).split("/").filter(Boolean);
  const to = normalizePosix(toAbs).split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const parts = [...from.slice(i).map(() => ".."), ...to.slice(i)];
  return parts.length ? parts.join("/") : ".";
}
