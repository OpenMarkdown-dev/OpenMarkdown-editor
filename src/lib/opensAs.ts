/**
 * What a path opens as (spec: image-viewer / 一条路径打开成什么只在一处判).
 *
 * The table is `src-tauri/crates/openmd-proto/opens_as.json` — ONE file, read
 * by Rust (`openmd_proto::opens_as`, for the socket / argv / CLI) and imported
 * here, so the two sides cannot disagree. The frontend asks here and nowhere
 * else: the open funnel (`openPath` in `store/workspace.ts`) routes on it, the
 * viewer's commands gate on it. Gate: `opensAs.gate.test.ts` — no other file
 * in the app's TS or Rust source spells an image extension list.
 */
import table from "./opens_as.json";

/** `document`: a markdown tab. `image`: read-only, in the viewer panel. */
export type OpensAs = "document" | "image";

const IMAGE: ReadonlySet<string> = new Set(table.image.map((e) => e.toLowerCase()));
const DOCUMENT: ReadonlySet<string> = new Set(table.document.map((e) => e.toLowerCase()));

/** The extension after the last dot of the last segment, lower-case; none → "". */
function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** What `path` opens as — by its extension, case-insensitively, no disk access. */
export function opensAs(path: string): OpensAs {
  return IMAGE.has(extensionOf(path)) ? "image" : "document";
}


/**
 * Is `path` a file the home file model lists (spec: home-file-model / 可见性
 * 只有一条规则)? What can be opened is listed: a listed document type or an
 * image. Rust's twin is `openmd_proto::listed` (the model itself); the browser
 * harness's simulated model asks this one.
 */
export function listedFile(path: string): boolean {
  const ext = extensionOf(path);
  return DOCUMENT.has(ext) || IMAGE.has(ext);
}
