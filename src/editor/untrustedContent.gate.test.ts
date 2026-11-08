import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";

/**
 * Gate (spec: editor-host / 不可信内容渲染不执行脚本; change:
 * editor-untrusted-content, design D4). The editor renders documents other
 * people wrote; these rules keep every way document content could become live
 * markup or navigation behind its one chokepoint. Scope: `src/editor/**`,
 * tests excluded. Fails, with file:line, on:
 *
 * - U1: a markup sink — `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
 *   `createContextualFragment`, `DOMParser`, `document.write`, `srcdoc`,
 *   `setHTMLUnsafe`, `parseHTMLUnsafe` — outside `editor/markup.ts` (whose
 *   `setMarkup` only takes sanitised `SafeMarkup`);
 * - U2: a cast to `SafeMarkup` outside `editor/markup.ts` (the brand is minted
 *   only by the sanitiser);
 * - U3: an element that navigates or runs content — `<a>`, `<iframe>`,
 *   `<script>`, `<object>`, `<embed>`, `<form>` — or a navigation of the page
 *   (`window.open`, `location…`): links go only through `followLink` → the
 *   host (with `safeUrl.ts`'s scheme policy before it);
 * - U4: raw-HTML syntax nodes (`HTMLBlock`, `HTMLTag`, `CommentBlock`,
 *   `ProcessingInstructionBlock`) named outside the two files that only ever
 *   treat them as source text (`spellProse.ts` skips them, `inlineCell.ts` maps
 *   `HTMLTag` to "source"; `render/renderHtml.ts` writes them out as escaped
 *   text). Naming one elsewhere is the first step to rendering
 *   raw HTML — that needs a change of the spec first.
 *
 * Limits (stated, not hidden): textual, comments stripped first. A sink reached
 * by computed property (`el["inner" + "HTML"]`) or through a helper outside
 * `src/editor` is not seen — review's job; the editor's import closure is
 * itself fenced by `editorBoundary.gate.test.ts`.
 */

const SRC = join(__dirname, "..");
const OWNER = "editor/markup.ts";
const RAW_HTML_READERS = new Set([
  "editor/spellProse.ts",
  "editor/inlineCell.ts",
  // The HTML renderer (change: render-export) names them only to SHOW them as
  // escaped text — the same source-only reading; `renderHtml.test.ts` pins it.
  "editor/render/renderHtml.ts",
]);

// Assembled so this file's own source never matches its rules.
const SINK = new RegExp(
  "\\b(" +
    ["inner" + "HTML", "outer" + "HTML", "insertAdjacent" + "HTML", "createContextual" + "Fragment", "DOM" + "Parser",
      "document\\.write", "src" + "doc", "setHTML" + "Unsafe", "parseHTML" + "Unsafe"].join("|") +
    ")\\b",
);
const CAST = new RegExp("\\bas\\s+" + "Safe" + "Markup\\b");
const LIVE_ELEMENT = new RegExp("createElement(NS)?\\([^)]*['\"`](a|iframe|script|object|embed|form)['\"`]\\s*\\)");
const NAVIGATE = new RegExp("\\bwindow\\.open\\s*\\(|\\b(window\\.|document\\.)?location\\s*(\\.(href|assign|replace)\\b|=[^=])");
const RAW_HTML_NODE = new RegExp("\\b(" + ["HTML" + "Block", "HTML" + "Tag", "Comment" + "Block", "ProcessingInstruction" + "Block"].join("|") + ")\\b");

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function violations(files: { path: string; code: string }[]): string[] {
  const found: string[] = [];
  for (const { path, code } of files) {
    if (!path.startsWith("editor/")) continue;
    stripComments(code)
      .split("\n")
      .forEach((line, i) => {
        const at = `${path}:${i + 1}`;
        if (path !== OWNER && SINK.test(line)) found.push(`${at}: U1 markup sink outside ${OWNER} (use setMarkup with sanitised markup)`);
        if (path !== OWNER && CAST.test(line)) found.push(`${at}: U2 SafeMarkup minted outside ${OWNER}`);
        if (LIVE_ELEMENT.test(line)) found.push(`${at}: U3 an element that navigates or runs content`);
        if (NAVIGATE.test(line)) found.push(`${at}: U3 the editor navigates the page (links go through followLink → the host)`);
        if (!RAW_HTML_READERS.has(path) && RAW_HTML_NODE.test(line)) found.push(`${at}: U4 raw-HTML node named outside its source-only readers`);
      });
  }
  return found;
}

describe("untrusted-content gate", () => {
  it("src/editor has no markup sink, live element, page navigation or raw-HTML renderer outside its chokepoint", () => {
    const files = listFiles(SRC, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ }).map((p) => ({
      path: repoPath(SRC, p),
      code: readFileSync(p, "utf8"),
    }));
    // The scan is not empty, and the chokepoint exists and is the one sink.
    expect(files.some((f) => f.path === OWNER)).toBe(true);
    expect(files.filter((f) => f.path.startsWith("editor/")).length).toBeGreaterThan(50);
    expect(violations(files)).toEqual([]);
  });

  it("catches each rule", () => {
    const probe = (code: string, path = "editor/widgets.ts") => violations([{ path, code }]);
    expect(probe("el.inner" + "HTML = x;")).toHaveLength(1);
    expect(probe("el.outer" + "HTML = x;")).toHaveLength(1);
    expect(probe('el.insertAdjacent' + 'HTML("beforeend", x);')).toHaveLength(1);
    expect(probe("range.createContextual" + "Fragment(x);")).toHaveLength(1);
    expect(probe("new DOM" + "Parser().parseFromString(x, 'text/html');")).toHaveLength(1);
    expect(probe("frame.src" + "doc = x;")).toHaveLength(1);
    expect(probe("const m = x as Safe" + "Markup;")).toHaveLength(1);
    expect(probe('const a = document.createElement("a");')).toHaveLength(1);
    expect(probe("const f = document.createElement('iframe');")).toHaveLength(1);
    expect(probe("window.open(url);")).toHaveLength(1);
    expect(probe("location.href = url;")).toHaveLength(1);
    expect(probe('case "HTML' + 'Block":')).toHaveLength(1);
  });

  it("leaves the owner, comments, other elements and the source-only readers alone", () => {
    const probe = (code: string, path = "editor/widgets.ts") => violations([{ path, code }]);
    expect(probe("el.inner" + "HTML = markup;", OWNER)).toEqual([]);
    expect(probe("return x as Safe" + "Markup;", OWNER)).toEqual([]);
    expect(probe("// el.inner" + "HTML = x used to live here\nconst y = 1;")).toEqual([]);
    expect(probe('const s = document.createElement("span");')).toEqual([]);
    expect(probe('const t = document.createElement("table");')).toEqual([]);
    expect(probe('  HTML' + 'Tag: "source",', "editor/inlineCell.ts")).toEqual([]);
    expect(probe("if (a.location === b.location) {}")).toEqual([]);
    expect(probe("el.textContent = x;")).toEqual([]);
  });
});
