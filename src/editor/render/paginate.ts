/**
 * Page breaks for "Export as PDF" (spec: document-export; change: render-export,
 * design D9). The PDF is drawn WITHOUT the print system: the backend loads the
 * page in a hidden web view, calls `__omPaginate(width, pageHeight, margin)`
 * (defined by the script below), draws the whole page as ONE tall PDF page and
 * cuts it into paper-sized pages (`pdf_export.rs`).
 *
 * So the page itself must already be laid out as a stack of paper pages: this
 * script pushes every block that would cross a page edge down to the top of the
 * next page (a spacer before it), so the cut always falls between blocks, in
 * the blank margin band; a heading moves with the block after it. A table or
 * formula wider than the page is shrunk (to 70% at most), and a table still too
 * wide then breaks long words in its cells (paper does not scroll). A block taller than a page is entered (a long list or
 * quote breaks between its items); one that cannot be entered (a long code
 * block, a long table) is left to cross the edge — the known limit.
 *
 * Only the PDF page carries this script; "Export as HTML" stays script-free
 * (`document.ts`).
 */

/** What to do with one block: `0` it stays, `n > 0` push it down n px, `"split"` it is taller than a page. */
export type Push = number | "split";

/**
 * Where a block [top, bottom) sits against pages of pitch `pageH` whose
 * printable band is [m, pageH − m): pushed to the next band start when it
 * starts in a margin or crosses the band end; `"split"` when it is taller than
 * a band (it cannot fit anywhere).
 */
export function pushDown(top: number, bottom: number, pageH: number, m: number): Push {
  const band = pageH - 2 * m;
  if (bottom - top > band + 0.5) return "split";
  const page = Math.floor(top / pageH);
  const into = top - page * pageH;
  if (into < m - 0.5) return m - into;
  if (bottom <= page * pageH + pageH - m + 0.5) return 0;
  return (page + 1) * pageH + m - top;
}

/** The zoom that fits content `natural` px wide into `avail` px (1 = it fits). */
export function fitScale(natural: number, avail: number): number {
  return natural > avail + 0.5 && natural > 0 ? avail / natural : 1;
}

/** Number of pages a laid-out height fills. */
export function pageCount(height: number, pageH: number): number {
  return Math.max(1, Math.ceil((height - 0.5) / pageH));
}

/** Boxes that scroll sideways on screen; on paper their content is shrunk to the band width instead. */
const SCROLLERS = [".om-table-wrap", ".om-math-block"];
/** The smallest a too-wide table or formula is shrunk to. */
const MIN_ZOOM = 0.7;

/** Containers a too-tall block is entered through (their children are blocks too). */
const ENTER = ["UL", "OL", "LI", "BLOCKQUOTE", "DIV", "SECTION", "DETAILS", "DL", "ARTICLE"];

/**
 * The in-page driver. Self-contained (it is sent as source text): it measures,
 * inserts spacers and re-measures, so collapsed margins and reflow are the
 * browser's own. Returns the page count; the document is then exactly
 * `count × pageH` tall.
 */
function paginateInPage(
  width: number,
  pageH: number,
  m: number,
  push: typeof pushDown,
  enter: string[],
  count: typeof pageCount,
  fit: typeof fitScale,
  scrollers: string[],
  minZoom: number,
): number {
  const html = document.documentElement;
  const body = document.body;
  body.style.width = `${width}px`;
  const root = document.querySelector(".om-doc-body") ?? body;
  // Paper does not scroll: a too-wide table or formula is shrunk to fit.
  for (const box of Array.from(document.querySelectorAll(scrollers.join(", ")))) {
    const inner = box.firstElementChild as HTMLElement | null;
    if (!inner || fit(box.scrollWidth, box.clientWidth) === 1) continue;
    // Shrink, but not past `MIN_ZOOM` (WebKit's minimum font size stops text
    // shrinking anyway). Measure what was drawn as the BOX sees it (an
    // element's own rect is in its zoomed units) and correct a few times.
    let z = 1;
    for (let i = 0; i < 4; i++) {
      const over = fit(box.scrollWidth, box.clientWidth);
      if (over === 1) break;
      z = Math.max(minZoom, z * over);
      inner.style.setProperty("zoom", String(z));
      if (z === minZoom) break;
    }
    // Still too wide: let long words in cells break, at the band width.
    if (fit(box.scrollWidth, box.clientWidth) < 1) {
      inner.classList.add("om-pdf-squeeze");
      inner.style.width = `${box.clientWidth / z}px`;
    }
  }
  const topOf = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
  const walk = (parent: Element) => {
    for (const el of Array.from(parent.children)) {
      if (el instanceof HTMLElement && el.dataset.omSpacer) continue;
      for (let i = 0; i < 4; i++) {
        const r = el.getBoundingClientRect();
        const top = r.top + window.scrollY;
        // A heading keeps with the block after it: measured together, so it
        // never ends a page alone (unless the pair is taller than a page).
        const next = /^H[1-6]$/.test(el.tagName) ? el.nextElementSibling : null;
        const pair = next ? next.getBoundingClientRect().bottom + window.scrollY : top + r.height;
        const withNext = push(top, pair, pageH, m);
        const d = withNext === "split" ? push(top, top + r.height, pageH, m) : withNext;
        if (d === "split") {
          if (enter.includes(el.tagName) && el.children.length > 0) walk(el);
          break;
        }
        if (d < 0.5) break;
        let spacer = el.previousElementSibling as HTMLElement | null;
        if (!spacer?.dataset.omSpacer) {
          spacer = document.createElement("div");
          spacer.dataset.omSpacer = "1";
          spacer.setAttribute("aria-hidden", "true");
          el.before(spacer);
        }
        // Aim at the target top: a spacer also un-collapses margins, so
        // correct by what actually moved.
        const target = top + d;
        spacer.style.height = `${(parseFloat(spacer.style.height) || 0) + d}px`;
        const moved = topOf(el);
        if (Math.abs(moved - target) > 0.5) {
          spacer.style.height = `${Math.max(0, parseFloat(spacer.style.height) + target - moved)}px`;
        }
      }
    }
  };
  walk(root);
  const n = count(html.scrollHeight, pageH);
  for (const el of [html, body]) {
    el.style.height = `${n * pageH}px`;
    el.style.overflow = "hidden";
  }
  return n;
}

/** The PDF page's own layout: paper width, side margins, nothing wider than the band. */
function pdfStyle(): string {
  return [
    "html, body { margin: 0; padding: 0; }",
    "body.om-doc { padding: 0 var(--om-pdf-margin); box-sizing: border-box; }",
    "body.om-doc .om-doc-body { max-width: none; padding: 0; margin: 0; }",
    "body.om-doc pre code { white-space: pre-wrap; }",
    "body.om-doc .om-pdf-squeeze th, body.om-doc .om-pdf-squeeze td { overflow-wrap: anywhere; }",
    "body.om-doc img, body.om-doc svg { max-width: 100%; max-height: var(--om-pdf-band); }",
  ].join("\n");
}

/**
 * The script that defines `window.__omPaginate(width, pageH, margin)`. The
 * backend passes the geometry in CSS px (paper and margin, at the web view's
 * zoom); the function sets the margins and returns the page count.
 */
export function paginateScript(): string {
  return (
    "(function () {\n" +
    `  var pushDown = ${pushDown.toString()};\n` +
    `  var pageCount = ${pageCount.toString()};\n` +
    `  var fitScale = ${fitScale.toString()};\n` +
    `  var scrollers = ${JSON.stringify(SCROLLERS)};\n` +
    `  var minZoom = ${MIN_ZOOM};\n` +
    `  var paginate = ${paginateInPage.toString()};\n` +
    `  var css = ${JSON.stringify(pdfStyle())};\n` +
    `  var enter = ${JSON.stringify(ENTER)};\n` +
    "  window.__omPaginate = function (width, pageH, m) {\n" +
    "    var root = document.documentElement.style;\n" +
    "    root.setProperty('--om-pdf-margin', m + 'px');\n" +
    "    root.setProperty('--om-pdf-band', (pageH - 2 * m) + 'px');\n" +
    "    var style = document.createElement('style');\n" +
    "    style.textContent = css;\n" +
    "    document.head.appendChild(style);\n" +
    "    return paginate(width, pageH, m, pushDown, enter, pageCount, fitScale, scrollers, minZoom);\n" +
    "  };\n" +
    "})();\n"
  );
}

/** The exported HTML page, made ready for the PDF writer (adds the script above). */
export function pdfPage(html: string): string {
  const script = `<script>\n${paginateScript()}</script>\n`;
  const at = html.lastIndexOf("</body>");
  return at < 0 ? html + script : html.slice(0, at) + script + html.slice(at);
}
