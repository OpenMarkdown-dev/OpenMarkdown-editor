import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../../scripts/lib/repoFiles.mjs";

/**
 * Gate (spec: block-editing / B 类小块的编辑器只有一份; change: missing-gates,
 * design D2). A B block's part — a table cell, a property name or value — is
 * edited only through the ONE part editor (`blocks/partEditor.ts`), which is
 * what gives it per-keystroke sync, document-owned undo, reseeding and IME
 * safety. This test fails, with file:line, on the two shapes a second one takes:
 *
 * - E1: another editor instance (`new EditorView(`) anywhere in `src/` outside
 *   the document editor, the part editor and the harness's isolation probe;
 * - E2: a hand-built text control in `src/editor/` — a textarea, a
 *   contenteditable element, or an `<input>` whose type is not set to checkbox
 *   on its own line or the two after it — outside the find panel.
 *
 * Limits (stated, not hidden): the scan is textual; comments are stripped
 * first and tests are not scanned. An editor built through an alias
 * (`const V = EditorView; new V(…)`) or another library's component, a React
 * `<input>` laid over a block from the component layer, and a block that calls
 * the part editor with the wrong hooks are not seen — the last is what the
 * behaviour tests (`tableArrowNav.test.ts`, `frontmatterProps.test.ts`) hold.
 */

const SRC = join(__dirname, "../..");

interface Rule {
  what: string;
  /** Which files the rule scans (repo paths below `src/`). */
  scope: (path: string) => boolean;
  /** The 0-based lines of `lines` that break the rule. */
  hits: (lines: string[]) => number[];
  owners: Record<string, string>;
}

const lineHits = (re: RegExp) => (lines: string[]) =>
  lines.flatMap((l, i) => (re.test(l) ? [i] : []));

const EDITOR_DIR = (path: string) => path.startsWith("editor/");

const RULES: Rule[] = [
  {
    what: "an editor instance outside the document editor and the part editor",
    scope: () => true,
    hits: lineHits(/\bnew\s+EditorView\s*\(/),
    owners: {
      "editor/base.ts": "the document editor itself",
      "editor/blocks/partEditor.ts": "the one B-block part editor",
      "dev/harness/cases.ts":
        "editor-nested-isolation probe: mounts nestedEditorBase() alone to measure outer-style leaks; an instrument, not an editor",
    },
  },
  {
    what: "a hand-built text control in the editor (use the part editor)",
    scope: EDITOR_DIR,
    hits: (lines) =>
      lines.flatMap((l, i) => {
        if (/createElement\(\s*["'`]textarea["'`]\s*\)/.test(l)) return [i];
        if (/\.contentEditable\s*=(?!=)/.test(l)) return [i];
        if (/setAttribute\(\s*["'`]contenteditable["'`]/i.test(l)) return [i];
        if (/createElement\(\s*["'`]input["'`]\s*\)/.test(l)) {
          const near = lines.slice(i, i + 3).join("\n");
          return /\.type\s*=\s*["'`]checkbox["'`]/.test(near) ? [] : [i];
        }
        return [];
      }),
    owners: { "editor/findPanel.ts": "the find / replace fields belong to a panel, not a block part" },
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
    const lines = stripComments(code).split("\n");
    for (const rule of RULES) {
      if (!rule.scope(path) || rule.owners[path]) continue;
      for (const i of rule.hits(lines)) found.push(`${path}:${i + 1}: ${rule.what}`);
    }
  }
  return found;
}

describe("part-editor gate", () => {
  it("block parts are edited only through the one part editor", () => {
    const files = sources(SRC).map((p) => ({ path: repoPath(SRC, p), code: readFileSync(p, "utf8") }));
    expect(files.some((f) => f.path === "editor/blocks/partEditor.ts")).toBe(true);
    expect(violations(files)).toEqual([]);
  });

  it("catches each shape of a second part editor", () => {
    const cases: [string, string][] = [
      ["editor/blocks/math.ts", "const v = new EditorView({ parent: host, state });"],
      ["editor/widgets.ts", "const v = new  EditorView ( { doc } );"],
      ["editor/widgets.ts", 'const ta = document.createElement("textarea");'],
      ["editor/blocks/properties.ts", 'el.contentEditable = "true";'],
      ["editor/widgets.ts", 'cell.setAttribute("contenteditable", "plaintext-only");'],
      ["editor/widgets.ts", 'const i = document.createElement("input");\ni.value = text;'],
      // `type` set too far away: treated as a text input on purpose.
      ["editor/widgets.ts", 'const i = document.createElement("input");\n\n\n\ni.type = "checkbox";'],
    ];
    for (const [path, code] of cases) expect(violations([{ path, code }]), code).toHaveLength(1);
    expect(violations([{ path: "lib/x.ts", code: "ok();\nnew EditorView({})" }])).toEqual([
      "lib/x.ts:2: an editor instance outside the document editor and the part editor",
    ]);
  });

  it("leaves the owners, checkboxes, reads, other layers and comments alone", () => {
    const cases: [string, string][] = [
      ["editor/blocks/partEditor.ts", "const view = new EditorView({ parent: host, state });"],
      ["editor/base.ts", "const view = new EditorView({ parent: options.parent, state });"],
      ["dev/harness/cases.ts", "const nested = new EditorView({ parent: probe, doc: 'x' });"],
      ["editor/widgets.ts", "// new EditorView( is only built by partEditor"],
      ["editor/widgets.ts", 'const box = document.createElement("input");\nbox.type = "checkbox";'],
      ["editor/findPanel.ts", 'const input = document.createElement("input");\ninput.type = "text";'],
      ["components/X.tsx", 'const ta = document.createElement("textarea");'],
      ["editor/widgets.ts", "const part = EditorView.findFromDOM(el);"],
      ["editor/widgets.ts", 'const ce = view.contentDOM.getAttribute("contenteditable");'],
      ["editor/widgets.ts", 'if (el.contentEditable === "true") return;'],
    ];
    for (const [path, code] of cases) expect(violations([{ path, code }]), `${path}: ${code}`).toEqual([]);
  });
});
