import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";

/**
 * Gate (spec: section-write / 一个标题模型 + frontmatter 只有一条规则; change:
 * heading-model): which lines are headings and where the frontmatter is are
 * decided in `src/editor/headingIndex.ts` and nowhere else in the app. Product
 * code that spells out heading syntax (`#{1,6}`), reads heading nodes off the
 * syntax tree (`ATXHeading` / `SetextHeading`), or compares a line with the
 * `---` fence fails here, and so does product code that writes an anchor
 * ordinal (`#${…}`) or the `::` path separator (change: heading-anchors). Its Rust twin is `section.rs`, held to the same
 * rules by `fixtures/section-write/vectors.json`.
 *
 * Limits (stated, not hidden): textual and therefore greppable — comments are
 * stripped first; a heading rule written another way (`startsWith("#")` on a
 * line, a character loop) or a fence built at runtime would not be seen.
 * Tests are not scanned: they may restate the rules as independent oracles.
 */

const SRC = join(__dirname, "..");
const HOME = "editor/headingIndex.ts";

/** Files allowed to spell these out, and why. */
const ALLOW: Record<string, string> = {
  // The golden-case fixture format: `## ` lines are case titles of the
  // structure-key fixtures, parsed by the test runner, not markdown headings.
  "editor/structure/golden.ts": "parses the structure-key golden fixture format (`## ` case titles)",
};

// Assembled so this file's own source never matches its rules.
const DASHES = "-".repeat(3);
const SEP = ":".repeat(2);
const RULES: { what: string; test: (code: string) => boolean }[] = [
  { what: "ATX heading syntax (#{1,6})", test: (c) => c.includes("#{" + "1,6}") },
  { what: "heading nodes read off the syntax tree", test: (c) => /\b(ATX|Setext)Heading/.test(c) },
  { what: "a `---` fence literal", test: (c) => new RegExp(`["'\`]${DASHES}["'\`]`).test(c) },
  { what: "a `---` fence regex", test: (c) => new RegExp(`/\\^${DASHES}`).test(c) },
  // Anchors and paths (change: heading-anchors): only the model writes an
  // ordinal onto a query or joins / splits on the path separator, so escaping
  // and the round-trip invariant cannot be bypassed by a hand-built string.
  { what: "anchor ordinal built from a template (`#${`)", test: (c) => c.includes("#$" + "{") },
  { what: "the `::` path separator as a literal", test: (c) => new RegExp(`["'\`]${SEP}["'\`]`).test(c) },
];

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function sources(dir: string): string[] {
  return listFiles(dir, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ });
}

export function violations(files: { path: string; code: string }[]): string[] {
  const found: string[] = [];
  for (const { path, code } of files) {
    // The browser harness is a test driver: its cases seed documents and check
    // the app against independent oracles, like the tests do.
    if (path === HOME || ALLOW[path] || path.startsWith("dev/harness/")) continue;
    const bare = stripComments(code);
    for (const rule of RULES) if (rule.test(bare)) found.push(`${path}: ${rule.what}`);
  }
  return found;
}

describe("heading-model gate", () => {
  it("heading and frontmatter detection, anchors and paths live only in src/editor/headingIndex.ts", () => {
    const files = sources(SRC).map((p) => ({ path: repoPath(SRC, p), code: readFileSync(p, "utf8") }));
    expect(files.some((f) => f.path === HOME)).toBe(true);
    expect(violations(files)).toEqual([]);
  });

  it("catches each kind of stray detection", () => {
    const probe = (code: string) => violations([{ path: "editor/x.ts", code }]);
    expect(probe("const ATX = /^ {0,3}(#{" + "1,6})/;")).toEqual(["editor/x.ts: ATX heading syntax (#{1,6})"]);
    expect(probe(`if (node.name === "ATX` + `Heading2") {}`)).toEqual(["editor/x.ts: heading nodes read off the syntax tree"]);
    expect(probe(`if (line.trim() === "${DASHES}") {}`)).toEqual(["editor/x.ts: a `---` fence literal"]);
    expect(probe(`const fence = /^${DASHES}\\s*$/;`)).toEqual(["editor/x.ts: a `---` fence regex"]);
    expect(probe("const a = `${path}#$" + "{k}`;")).toEqual(["editor/x.ts: anchor ordinal built from a template (`#${`)"]);
    expect(probe(`const path = segs.join("${SEP}");`)).toEqual(["editor/x.ts: the `::` path separator as a literal"]);
    // Prose and inserted text are fine; the home is exempt.
    expect(probe(`// a "${DASHES}" fence\nconst skeleton = "${DASHES}\\nname: ";`)).toEqual([]);
    expect(violations([{ path: HOME, code: `"${DASHES}"` }])).toEqual([]);
  });
});
