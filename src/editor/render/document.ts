import { renderHTML, type RenderOptions } from "./renderHtml";
import { DOC_CLASS, renderStylesheet } from "./renderStyle";
import { ensureMath, isMathReady } from "../math";
import type { SafeMarkup } from "../markup";

/**
 * One note → one self-contained HTML page (spec: document-export / 导出的 HTML
 * 自包含; change: render-export). Pure: everything it needs from outside — the
 * local images' bytes, the drawn diagrams — is handed in, already prepared, so
 * it is node-testable and the same page feeds both "Export HTML" and the PDF
 * writer (which loads this page and prints it to a file).
 *
 * The page:
 *   - carries its stylesheet inline (light, generated from the token table);
 *   - embeds every local image it was given as a `data:` URI; a remote image
 *     keeps its URL (nothing is fetched at export); a local image that could
 *     not be read keeps its src as written;
 *   - has no script, no external stylesheet, no font download.
 */
export interface DocumentInput {
  /** The page title (the note's name). */
  title: string;
  /** `<html lang>`, the app's UI language. */
  lang?: string;
  /** Local image src as written → its `data:` URI. */
  images?: ReadonlyMap<string, string>;
  /** Mermaid fence body → its drawing. */
  diagrams?: ReadonlyMap<string, SafeMarkup>;
  /** TeX → MathML; default: the editor's converter (load it first: `mathLoaded`). */
  math?: RenderOptions["math"];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildHtmlDocument(markdown: string, input: DocumentInput): string {
  const body = renderHTML(markdown, {
    math: input.math,
    diagram: (b) => input.diagrams?.get(b) ?? null,
    image: (src) => input.images?.get(src) ?? null,
  });
  return (
    "<!doctype html>\n" +
    `<html lang="${esc(input.lang ?? "en")}">\n<head>\n<meta charset="utf-8">\n` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="generator" content="OpenMarkdown">\n' +
    `<title>${esc(input.title)}</title>\n<style>\n${renderStylesheet("light")}</style>\n</head>\n` +
    `<body class="${DOC_CLASS}">\n<article class="om-doc-body">\n${body}</article>\n</body>\n</html>\n`
  );
}

/**
 * Resolves once the math converter is loaded, or after `timeoutMs` — whichever
 * comes first. A converter that failed to load leaves formulas as TeX source
 * (the editor's own degrade), so a slow or failed load never blocks an export.
 */
export function mathLoaded(timeoutMs = 10_000): Promise<void> {
  if (isMathReady()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    ensureMath(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
