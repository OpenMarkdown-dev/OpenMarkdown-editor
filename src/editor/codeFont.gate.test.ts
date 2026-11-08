import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";
import { CODE_TYPE } from "./theme";
import { MONO_FONT_FAMILY } from "@/lib/fonts";
import { EDITOR_TOKENS, tokenProperty } from "./tokens";

/**
 * Gate (spec: live-preview-editor / 代码只有一种字体). Fails, with the file and
 * line, on:
 *
 * - F1: a monospace stack written out anywhere in product code but
 *   `src/lib/fonts.ts` — import `MONO_FONT_FAMILY` instead;
 * - F2: the editor theme's inline-code mark or code-block line not taking
 *   `CODE_TYPE` — the two must stay one type;
 * - F3: a `t.monospace` highlight rule setting a size — it sits inside the
 *   inline-code mark, so a size there compounds with the mark's.
 *
 * Limits (stated, not hidden): the scan is textual. A stack assembled at
 * runtime, or a font named only by a Tailwind class, is not seen; the harness
 * case `code-font` measures what the rendered code actually uses.
 */

const ROOT = process.cwd();
const HOME = "src/lib/fonts.ts";
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Names that only a monospace stack carries. */
const MONO_NAMES = /ui-monospace|'SF Mono'|"SF Mono"|\bMenlo\b/;

/** Product sources, repo-relative: tests and the browser harness are out of scope. */
function productFiles(): string[] {
  return listFiles(join(ROOT, "src"), { include: /\.(ts|tsx|css)$/ })
    .map((f: string) => repoPath(ROOT, f))
    .filter((rel: string) => !/\.test\.tsx?$/.test(rel) && !rel.startsWith("src/dev/harness/"));
}

describe("code font gate", () => {
  it("F1: the monospace stack is written once, in src/lib/fonts.ts", () => {
    const hits: string[] = [];
    for (const rel of productFiles()) {
      if (rel === HOME) continue;
      read(rel).split("\n").forEach((line, i) => {
        if (MONO_NAMES.test(line)) hits.push(`${rel}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("F2: inline code and code-block lines take CODE_TYPE", () => {
    // The code font is the `font-mono` token, whose default is the one stack
    // (change: editor-style-tokens; a host may override the token).
    expect(CODE_TYPE.fontFamily).toBe(`var(${tokenProperty("font-mono")})`);
    expect(EDITOR_TOKENS["font-mono"]).toBe(MONO_FONT_FAMILY);
    const theme = read("src/editor/theme.ts");
    expect(theme).toMatch(/"\.om-codeblock-line": CODE_TYPE,/);
    expect(theme).toMatch(/"\.om-inline-code": \{\s*\.\.\.CODE_TYPE,/);
  });

  it("F3: no t.monospace highlight rule sets a size", () => {
    const theme = read("src/editor/theme.ts");
    const rules = theme.match(/\{\s*tag: t\.monospace[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.filter((r) => /fontSize/.test(r))).toEqual([]);
  });
});
