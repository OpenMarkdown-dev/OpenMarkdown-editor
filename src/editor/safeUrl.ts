/**
 * The editor's ONE URL policy for document content (spec: editor-host /
 * 不可信内容渲染不执行脚本; change: editor-untrusted-content, design D2–D3).
 *
 * A link target or an image source comes straight from the document, which an
 * embedder may have received from someone else. Two chokepoints use this module:
 *
 *   - links: `resolveLinkTarget` (`linkResolve.ts`) classifies a script-capable
 *     URL as `blocked`, so `followLink` hands it to NO host callback — a naive
 *     embedder whose `openExternal` is `window.open(url)` can't be made to run
 *     `javascript:`;
 *   - images: `editorImageSrc` is the only way `livePreviewConfig.resolveImage`
 *     is built (`index.ts`, and the facet's default), so every `<img src>` —
 *     body and table cell — went through it.
 *
 * Scheme detection follows what a browser (WHATWG URL) would see, not just the
 * raw text: leading / trailing C0 controls and spaces are stripped, tabs and
 * newlines anywhere are removed, and the character references an HTML-aware
 * consumer would decode (`&#106;`, `&colon;`, `&Tab;` …) are decoded first.
 * So `java\tscript:`, ` javascript:`, `&#106;avascript:` all read as
 * `javascript:`. Pure (node-tested in `untrustedContent.test.ts`).
 */

/** Schemes that run script or carry an active document when navigated to. */
const SCRIPT_SCHEMES = new Set(["javascript", "vbscript", "livescript", "data"]);

const NAMED_REFS: Record<string, string> = {
  colon: ":", tab: "\t", newline: "\n", sol: "/", lpar: "(", rpar: ")", amp: "&", quot: '"', apos: "'",
  period: ".", comma: ",", semi: ";", num: "#", excl: "!", quest: "?", lt: "<", gt: ">", equals: "=",
};

/** Decode numeric and the obfuscation-relevant named character references (`;` optional, as browsers do). */
function decodeRefs(s: string): string {
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));?/g, (m, dec, hex, name) => {
    if (name !== undefined) return NAMED_REFS[name.toLowerCase()] ?? m;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

/** The URL as a browser would parse it: refs decoded, edge controls / spaces trimmed, tabs / newlines removed. */
export function normalizeUrl(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return decodeRefs(raw).replace(/^[\u0000- ]+|[\u0000- ]+$/g, "").replace(/[\t\n\r]/g, "");
}

/** The lower-cased scheme of `raw` after normalisation, or null when it has none. */
export function urlScheme(raw: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalizeUrl(raw));
  return m ? m[1].toLowerCase() : null;
}

/**
 * True when following / loading `raw` could run script: `javascript:`,
 * `vbscript:`, `livescript:`, and `data:` — except, for an image, a `data:image/…`
 * (inside `<img>` even SVG never runs script).
 */
export function isScriptUrl(raw: string, use: "link" | "image" = "link"): boolean {
  const scheme = urlScheme(raw);
  if (scheme === null || !SCRIPT_SCHEMES.has(scheme)) return false;
  if (use === "image" && scheme === "data") return !/^data:image\//i.test(normalizeUrl(raw));
  return true;
}

/**
 * The editor's image source for `raw` — the one image chokepoint (design D3).
 *
 * - With a host `resolveImage`: the host's answer (its policy: the app's
 *   asset-protocol whitelist), except a script-capable URL, which is refused
 *   whatever the host said.
 * - With none (an embedder that did not decide): only an absolute `https:` URL
 *   loads. A relative path would resolve against the EMBEDDING PAGE (wrong file,
 *   and a request to the page's own origin the document's author chose); `http:`
 *   is mixed content; `file:` / `data:` / `blob:` / custom schemes are the
 *   host's to allow. Everything else degrades to its source text.
 *
 * null = show the source (spec: 白名单外路径降级).
 */
export function editorImageSrc(raw: string, hostResolve?: (src: string) => string | null): string | null {
  if (hostResolve) {
    const src = hostResolve(raw);
    return src == null || isScriptUrl(src, "image") ? null : src;
  }
  return urlScheme(raw) === "https" ? normalizeUrl(raw) : null;
}
