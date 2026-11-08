import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../../scripts/lib/repoFiles.mjs";

/**
 * Gate (spec: structure-input / 别处注册结构键即失败; design D6): outside the
 * structure entry, nothing binds Enter / Tab / Shift-Tab / Backspace / Mod-] /
 * Mod-[, pulls in a stock binding for them, or leaves `markdown()`'s own keymap
 * on. Comments are stripped first, so prose about these keys is fine.
 */

const SRC = join(__dirname, "../..");

/** Files allowed to mention a structure key in code, and why. */
const ALLOW: Record<string, string> = {
  // The completion popup takes Enter / Tab only while it is open (Prec.highest).
  "editor/linkComplete.ts": "completion popup accepts with Tab / Enter while open",
  // Synthesises Tab keydown events to drive the editor; binds nothing.
  "dev/harness/cases.ts": "dispatches Tab key events in browser harness cases",
};

const RULES: { what: string; test: (code: string) => boolean }[] = [
  {
    what: "a binding for a structure key",
    test: (code) => /\bkey\s*:\s*["'](Enter|Tab|Shift-Tab|Backspace|Mod-\[|Mod-\])["']/.test(code),
  },
  { what: "indentWithTab", test: (code) => /\bindentWithTab\b/.test(code) },
  { what: "markdownKeymap", test: (code) => /\bmarkdownKeymap\b/.test(code) },
  {
    what: "markdown() without addKeymap: false",
    test: (code) => markdownCalls(code).some((args) => !/\baddKeymap\s*:\s*false\b/.test(args)),
  },
];

/** The argument text of every `markdown(...)` call. */
function markdownCalls(code: string): string[] {
  const out: string[] = [];
  const re = /\bmarkdown\(/g;
  for (let m; (m = re.exec(code)); ) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
    }
    out.push(code.slice(start, i - 1));
  }
  return out;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function sources(dir: string): string[] {
  return listFiles(dir, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ });
}

export function violations(files: { path: string; code: string }[]): string[] {
  const found: string[] = [];
  for (const { path, code } of files) {
    if (path.startsWith("editor/structure/") || ALLOW[path]) continue;
    const bare = stripComments(code);
    for (const rule of RULES) if (rule.test(bare)) found.push(`${path}: ${rule.what}`);
  }
  return found;
}

describe("structure-key gate", () => {
  it("no structure key is bound outside src/editor/structure/", () => {
    const files = sources(SRC).map((p) => ({ path: repoPath(SRC, p), code: readFileSync(p, "utf8") }));
    expect(violations(files)).toEqual([]);
  });

  it("catches each kind of stray binding", () => {
    const probe = (code: string) => violations([{ path: "editor/x.ts", code }]);
    expect(probe(`keymap.of([{ key: "Tab", run }])`)).toEqual(["editor/x.ts: a binding for a structure key"]);
    expect(probe(`keymap.of([indentWithTab])`)).toEqual(["editor/x.ts: indentWithTab"]);
    expect(probe(`markdown({ base })`)).toEqual(["editor/x.ts: markdown() without addKeymap: false"]);
    expect(probe(`markdown({ base, addKeymap: false })`)).toEqual([]);
    expect(probe(`// a comment about { key: "Enter" }\nconst x = 1;`)).toEqual([]);
  });
});
