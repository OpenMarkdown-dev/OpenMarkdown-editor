import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";

/**
 * Gate (spec: live-preview-editor / 图片的 alt 只有一个读法; change: image-size,
 * design D4). What an image's `![…]` says — which part is the alt, whether a
 * size is written and what it is — has one reading, `imageAlt.ts`. Everything
 * that needs the alt or the size (the rendered image, plain copy, the
 * table-cell image, and later drag-to-resize) asks it. This test fails, with
 * file:line, on:
 *
 * - I1: a regex literal that reads an image's source — it contains `!\[` —
 *   outside the reading;
 * - I2: a regex literal that reads a size suffix — it contains an escaped `\|`
 *   and a digit class (`\d` or `[0-9]`) — outside the reading. If a future
 *   regex of that shape is NOT about image sizes, add a named owner with a
 *   reason rather than loosening the rule.
 * - I3: a template literal that WRITES a size — it holds `|${` (so also
 *   `\|${`) — outside the write side `writeImageSize` (change: image-resize,
 *   design D2). Same escape hatch: a named owner with a reason.
 *
 * Limits (stated, not hidden): textual. Comments are stripped first; tests and
 * the browser harness are not scanned. A reading that scans characters by hand
 * or builds its pattern with `new RegExp("…")` is not seen; that is review's
 * job. (`inlineCell.ts` scans a table cell by hand to FIND an image's brackets,
 * then hands the label to `readImageLabel` — change: table-cell-images.)
 */

const SRC = join(__dirname, "..");
const HARNESS = "dev/harness/";
const OWNER = "editor/imageAlt.ts";

// Assembled so this file's own source never matches its rules.
const BANG = "!" + "\\" + "[";
const PIPE = "\\" + "|";
const WRITE = "|" + "${";

interface Rule {
  what: string;
  hit: (line: string) => boolean;
}

/** The regex literals on a line: `/…/` not preceded by an identifier or `)` (division). */
function regexLiterals(line: string): string[] {
  const out: string[] = [];
  const re = /(^|[=(,:!&|?{};\s[])\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/[a-z]*/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[2]);
  return out;
}

const RULES: Rule[] = [
  {
    what: "reads an image's alt with its own regex outside the one reading (imageAlt.ts)",
    hit: (line) => regexLiterals(line).some((r) => r.includes(BANG)),
  },
  {
    what: "reads an image size suffix with its own regex outside the one reading (imageAlt.ts)",
    hit: (line) => regexLiterals(line).some((r) => r.includes(PIPE) && (r.includes("\\d") || r.includes("[0-9]"))),
  },
  {
    what: "writes an image size with its own template outside the one write side (imageAlt.ts writeImageSize)",
    hit: (line) => templateLiterals(line).some((s) => s.includes(WRITE)),
  },
];

/** The template literals on a line (single-line ones; a multi-line template is review's job). */
function templateLiterals(line: string): string[] {
  return line.match(/`(?:\\.|[^`\\])*`/g) ?? [];
}

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
        for (const rule of RULES) if (rule.hit(line)) found.push(`${path}:${i + 1}: ${rule.what}`);
      });
  }
  return found;
}

describe("image-alt gate", () => {
  it("an image's alt and size are read in src/editor/imageAlt.ts and nowhere else", () => {
    const files = listFiles(SRC, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ }).map((p) => ({
      path: repoPath(SRC, p),
      code: readFileSync(p, "utf8"),
    }));
    expect(violations(files)).toEqual([]);
    expect(files.some((f) => f.path === OWNER)).toBe(true);
  });

  it("catches each shape of a second reading", () => {
    const cases = [
      "const altMatch = src.match(/^!\\[([^\\]]*)\\]/);",
      "const alt = /^!\\[([^\\]]*)\\]/.exec(text)?.[1] ?? \"\";",
      "const size = alt.match(/\\|(\\d+)(?:x(\\d+))?$/);",
      "const clean = alt.replace(/\\|[0-9]+.*$/, \"\");",
      "const label = `${alt}|${width}`;",
      "const cell = `${alt}\\\\|${w}x${h}`;",
    ];
    for (const code of cases) expect(violations([{ path: "editor/plainCopy.ts", code }]), code).toHaveLength(1);
  });

  it("leaves the owner, other patterns, strings, the harness and comments alone", () => {
    const probe = (path: string, code: string) => violations([{ path, code }]);
    expect(probe(OWNER, "const SIZE = /^([0-9]+)(?:x([0-9]+))?$/; const m = /!\\[/;")).toEqual([]);
    // Table pipes and digits apart, an image built as a string, plain division.
    expect(probe("editor/tableEdit.ts", "const cells = line.split(/(?<!\\\\)\\|/);")).toEqual([]);
    expect(probe("editor/listIndent.ts", "const n = /^(\\d+)[.)]/.exec(text);")).toEqual([]);
    expect(probe("editor/imagePaste.ts", "const md = `![](${rel})`;")).toEqual([]);
    expect(probe("editor/x.ts", "const half = width / 2 / zoom;")).toEqual([]);
    // A table row joined with pipes as a string, a pipe in a plain string.
    expect(probe("editor/tableEdit.ts", "const row = `| ${cells.join(\" | \")} |`;")).toEqual([]);
    expect(probe("editor/x.ts", "const s = \"|${\";")).toEqual([]);
    expect(probe("editor/x.ts", "// the old /^!\\[([^\\]]*)\\]/ reading\nconst x = 1;")).toEqual([]);
    expect(probe("dev/harness/cases.ts", "const m = html.match(/^!\\[([^\\]]*)\\]/);")).toEqual([]);
  });
});
