import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";

/**
 * Gate (spec: live-preview-editor / 图片元素只有一处生成; change:
 * table-cell-images, design D5). A rendered image — the picture, its size
 * values, its frame, its load-failure notice — is made in one place,
 * `imageElement.ts`. The body image (`ImageWidget`) and the table-cell image
 * (`inlineCell.ts`) both call it. This test fails, with file:line, on:
 *
 * - E1: `createElement("img")` outside that module.
 *
 * Limits (stated, not hidden): textual. Comments are stripped first; tests and
 * the browser harness are not scanned. A React `<img>` in the app's chrome (the
 * settings panel's glyph) is not document content and not in scope; an image
 * made with `new Image()` or `innerHTML` is not seen — that is review's job.
 */

const SRC = join(__dirname, "..");
const HARNESS = "dev/harness/";
const OWNER = "editor/imageElement.ts";

// Assembled so this file's own source never matches its rule.
const MAKE_IMG = new RegExp("createElement\\(\\s*['\"`]" + "img" + "['\"`]\\s*\\)");

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function violations(files: { path: string; code: string }[]): string[] {
  const found: string[] = [];
  for (const { path, code } of files) {
    if (path.startsWith(HARNESS) || path === OWNER) continue;
    stripComments(code)
      .split("\n")
      .forEach((line, i) => {
        if (MAKE_IMG.test(line)) found.push(`${path}:${i + 1}: makes an image element outside the one factory (${OWNER})`);
      });
  }
  return found;
}

describe("image-element gate", () => {
  it("an image element is made in src/editor/imageElement.ts and nowhere else", () => {
    const files = listFiles(SRC, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ }).map((p) => ({
      path: repoPath(SRC, p),
      code: readFileSync(p, "utf8"),
    }));
    expect(violations(files)).toEqual([]);
    expect(files.some((f) => f.path === OWNER)).toBe(true);
  });

  it("catches a second factory, whatever the quotes", () => {
    const cases = [
      'const img = document.createElement("img");',
      "const img = document.createElement('img');",
      "el.appendChild(document.createElement( `img` ));",
    ];
    for (const code of cases) expect(violations([{ path: "editor/inlineCell.ts", code }]), code).toHaveLength(1);
  });

  it("leaves the owner, other elements, the harness and comments alone", () => {
    const probe = (path: string, code: string) => violations([{ path, code }]);
    expect(probe(OWNER, 'const img = document.createElement("img");')).toEqual([]);
    expect(probe("editor/widgets.ts", 'const span = document.createElement("span");')).toEqual([]);
    expect(probe("editor/x.ts", "// document.createElement(\"img\") used to live here\nconst x = 1;")).toEqual([]);
    expect(probe("dev/harness/cases.ts", 'const img = document.createElement("img");')).toEqual([]);
  });
});
