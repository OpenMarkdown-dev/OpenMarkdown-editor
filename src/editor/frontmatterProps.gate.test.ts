import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";

/**
 * Gate (spec: live-preview-editor / frontmatter 的属性只有一个读法; change:
 * missing-gates, design D3). WHERE the frontmatter is has one rule
 * (`headingIndex.ts`, held by `headingIndexGate.test.ts`); WHAT properties it
 * holds — each name, value and the bytes they sit on — has one reading,
 * `frontmatterProps.ts`. Everything that needs a property (the Properties
 * block, plain copy) asks it. This test fails, with file:line, on:
 *
 * - P1: walking the frontmatter's lines — reading `.closeLine` — outside the
 *   rule that defines it, the parser that turns those lines into the
 *   `Frontmatter` node, and the property reading;
 * - P2: a `name: value` line pattern — a line-anchored regex literal with a
 *   capture group, a colon, and another capture group — outside the reading;
 * - P3: a YAML library, in source or in package.json. The Properties block
 *   needs byte positions so an edit changes only its bytes; a YAML library
 *   hands back values and re-serialises.
 * - P4 (spec: frontmatter 的属性只有一个写法; change: write-back-valid, design
 *   D7): a `name: value` line BUILT outside the one writing — a template
 *   literal interpolating a value right before `: ` / `:\n` (`` `${k}: ` ``,
 *   `` `${k}: ${v}` ``), or a concatenation onto `": "` — anywhere in
 *   `src/editor/` but `frontmatterProps.ts` (`writeScalar` / `newPropertyLine`).
 *   A name or value written bare is how `key- x #[: {oops: [1, "` reached a
 *   file. Constant strings (`"---\nname: "`) interpolate nothing and pass.
 *
 * Limits (stated, not hidden): textual. Comments are stripped first; tests and
 * the browser harness (a test driver seeding documents) are not scanned. A
 * reader that slices the frontmatter text and splits on ":" by hand, or a
 * pattern built with `new RegExp("…")`, is not seen. P4 sees the line shape
 * only: a line assembled through a helper elsewhere (`[k, v].join(": ")`) is
 * not seen. What the writer writes is held by the round-trip table in
 * `frontmatterProps.test.ts`; that only the edited bytes change, by the
 * byte-level tests in `blocks/properties.test.ts` and `fidelity.gate.test.ts`.
 */

const SRC = join(__dirname, "..");
const ROOT = join(SRC, "..");
const HARNESS = "dev/harness/";

// Assembled so this file's own source never matches its rules.
const CLOSE = "close" + "Line";
const YAML_LIBS = ["yaml", "js-yaml", "yamljs", "gray-matter", "front-matter"];

interface Rule {
  what: string;
  re: RegExp;
  owners: Record<string, string>;
  /** Only paths under this prefix are scanned (default: all of `src/`). */
  scope?: string;
}

const RULES: Rule[] = [
  {
    what: "walks the frontmatter's lines outside the property reading",
    re: new RegExp(`\\.${CLOSE}\\b`),
    owners: {
      "editor/headingIndex.ts": "defines the frontmatter range (the one frontmatter rule)",
      "editor/frontmatterParse.ts": "consumes those lines into the Frontmatter node without reading them",
      "editor/frontmatterProps.ts": "the one property reading",
    },
  },
  {
    what: "a `name: value` line pattern outside the property reading",
    // A regex literal: `/^(`, a group closed before a `:`, then another `(`.
    re: /\/\^\([^/\n]*\)[^/(\n]*:[^/\n]*\([^/\n]*\//,
    owners: { "editor/frontmatterProps.ts": "the one property reading (its KEY pattern)" },
  },
  {
    what: "a YAML library",
    re: new RegExp(
      `(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*)["'\`](?:${YAML_LIBS.join("|")})["'\`]`,
    ),
    owners: {},
  },
  {
    what: "a `name: value` line built outside the one property writing (writeScalar)",
    // `${…}: ` / `${…}:\n` / `${…}: ${…}` in a template, or `+ ": "` / `+ ":\n"`.
    re: /\$\{[^}]*\}:(?: (?:\\n|`|\$\{)|\\n)|\+\s*["'`]:(?: |\\n)/,
    scope: "editor/",
    owners: {
      "editor/frontmatterProps.ts": "the one property writing (writeScalar / newPropertyLine)",
      "editor/skill.ts": "the Properties block as ONE display line for plain copy (`k: v · k: v`), never written to a file",
      "editor/render/renderStyle.ts": "CSS declarations (`prop: value;`), not frontmatter",
      "editor/markup.ts": "an error message naming a selector, not frontmatter",
    },
  },
];

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function sources(dir: string): string[] {
  return listFiles(dir, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ });
}

export function violations(files: { path: string; code: string }[]): string[] {
  const found: string[] = [];
  for (const { path, code } of files) {
    if (path.startsWith(HARNESS)) continue;
    stripComments(code)
      .split("\n")
      .forEach((line, i) => {
        for (const rule of RULES) {
          if (rule.scope && !path.startsWith(rule.scope)) continue;
          if (!rule.owners[path] && rule.re.test(line)) found.push(`${path}:${i + 1}: ${rule.what}`);
        }
      });
  }
  return found;
}

/** YAML libraries named in a package.json's dependency lists. */
export function yamlDependencies(pkg: string): string[] {
  const json = JSON.parse(pkg) as Record<string, Record<string, string> | undefined>;
  const deps = { ...json.dependencies, ...json.devDependencies };
  return YAML_LIBS.filter((name) => name in deps);
}

describe("properties gate", () => {
  it("frontmatter properties are read in src/editor/frontmatterProps.ts and nowhere else", () => {
    const files = sources(SRC).map((p) => ({ path: repoPath(SRC, p), code: readFileSync(p, "utf8") }));
    expect(files.some((f) => f.path === "editor/frontmatterProps.ts")).toBe(true);
    expect(violations(files)).toEqual([]);
  });

  it("the app depends on no YAML library", () => {
    expect(yamlDependencies(readFileSync(join(ROOT, "package.json"), "utf8"))).toEqual([]);
  });

  it("catches each shape of a second property reading", () => {
    const cases = [
      `const close = frontmatterRange(doc)!.${CLOSE};`,
      "const m = line.match(/^(\\w[\\w-]*)\\s*:\\s?(.*)$/);",
      "const m = line.match(/^([^:]+):\\s*(.*)$/);",
      'import YAML from "yaml";',
      'const { data } = (await import("gray-matter")).default(doc);',
      "const y = require('js-yaml');",
      "changes: { from: p.closeFrom, insert: `${name}: \\n` },",
      "insert: `---\\n${name}: \\n---\\n\\n`",
      "const line = `${key}: ${value}`;",
      'const line = key + ": " + value;',
    ];
    for (const code of cases) expect(violations([{ path: "editor/plainCopy.ts", code }]), code).toHaveLength(1);
    expect(yamlDependencies('{"dependencies":{"js-yaml":"^4"}}')).toEqual(["js-yaml"]);
    expect(yamlDependencies('{"devDependencies":{"yaml":"^2"}}')).toEqual(["yaml"]);
  });

  it("leaves the owners, range users, other patterns, the harness and comments alone", () => {
    const probe = (path: string, code: string) => violations([{ path, code }]);
    for (const owner of ["editor/headingIndex.ts", "editor/frontmatterParse.ts", "editor/frontmatterProps.ts"]) {
      expect(probe(owner, `const n = range.${CLOSE} - 1;`)).toEqual([]);
    }
    expect(probe("editor/frontmatterProps.ts", "const KEY = /^([^\\s#][^:]*?)(\\s*):(?=\\s|$)/;")).toEqual([]);
    expect(probe("editor/sectionOps.ts", "return frontmatterRange(text)?.bodyFrom ?? 0;")).toEqual([]);
    expect(probe("editor/refChip.ts", "const scheme = t.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);")).toEqual([]);
    expect(probe("editor/x.ts", `// reads .${CLOSE} the old way\nconst x = 1;`)).toEqual([]);
    expect(probe("dev/harness/cases.ts", `const n = fm.${CLOSE};`)).toEqual([]);
    expect(probe("editor/x.ts", 'import { parse } from "yamlish-thing";')).toEqual([]);
    expect(yamlDependencies('{"dependencies":{"react":"^18"}}')).toEqual([]);
    // P4: the writer itself, a constant, a non-editor path, an `a:b` id.
    expect(probe("editor/frontmatterProps.ts", "return `${writeScalar(name, \"key\", null)}: \\n`;")).toEqual([]);
    expect(probe("editor/skill.ts", 'const head = "---\\nname: ";')).toEqual([]);
    expect(probe("editorSite/comparison.ts", "out.push(`${who}: ${why}`);")).toEqual([]);
    expect(probe("editor/structure/index.ts", "found.set(`${n.from}:${n.to}`, n);")).toEqual([]);
  });
});
