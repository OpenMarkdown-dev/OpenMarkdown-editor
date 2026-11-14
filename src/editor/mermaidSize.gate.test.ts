import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";

/**
 * Gate (spec: live-preview-editor / Mermaid 图表渲染 — 规模的算法与阈值各只定义一处;
 * change: mermaid-large-diagrams, task 2.2). The size metric, the threshold N
 * and the wide-diagram floor are defined in `mermaidSize.ts`; the one "is it
 * large / does it wait" decision is in `mermaid.ts` (`isLargeDiagram`,
 * `waitsForUser`). Fails, with file:line, on:
 *
 * - S1: a diagram's size compared anywhere else (`diagramSize(…) > 300`);
 * - S2: `LARGE_DIAGRAM_SIZE` / `MIN_DIAGRAM_SCALE` (re)defined outside `mermaidSize.ts`;
 * - S3: the threshold compared outside `mermaid.ts` (callers ask `isLargeDiagram` / `waitsForUser`).
 *
 * Limits (stated, not hidden): textual, comments stripped, `src/editor` only,
 * tests not scanned. A size computed by hand (counting lines of a body and
 * comparing that) is not seen — a review item.
 */
const EDITOR = join(__dirname);

const RULES: { what: string; re: RegExp; owners: string[] }[] = [
  { what: "a diagram's size compared outside mermaid.ts (use isLargeDiagram / waitsForUser)", re: /\bdiagramSize\([^)]*\)\s*[<>]=?/, owners: ["mermaid.ts", "mermaidSize.ts"] },
  { what: "the size threshold or the scale floor defined outside mermaidSize.ts", re: /\b(?:const|let|var)\s+(?:LARGE_DIAGRAM_SIZE|MIN_DIAGRAM_SCALE)\b|\b(?:LARGE_DIAGRAM_SIZE|MIN_DIAGRAM_SCALE)\s*=(?!=)/, owners: ["mermaidSize.ts"] },
  { what: "the size threshold compared outside mermaid.ts (use isLargeDiagram / waitsForUser)", re: /[<>]=?\s*LARGE_DIAGRAM_SIZE\b|\bLARGE_DIAGRAM_SIZE\s*[<>]/, owners: ["mermaid.ts", "mermaidSize.ts"] },
];

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function violations(files: { path: string; code: string }[]): string[] {
  const out: string[] = [];
  for (const { path, code } of files) {
    stripComments(code)
      .split("\n")
      .forEach((line, i) => {
        for (const r of RULES) if (!r.owners.includes(path) && r.re.test(line)) out.push(`editor/${path}:${i + 1}: ${r.what}`);
      });
  }
  return out;
}

describe("mermaid size gate", () => {
  it("the size, the threshold and the floor have one definition and one decision", () => {
    const files = listFiles(EDITOR, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ }).map((p) => ({
      path: repoPath(EDITOR, p),
      code: readFileSync(p, "utf8"),
    }));
    expect(files.some((f) => f.path === "mermaidSize.ts")).toBe(true);
    expect(files.some((f) => f.path === "blocks/mermaid.ts")).toBe(true);
    expect(violations(files)).toEqual([]);
  });

  it("catches a planted comparison, a second threshold, a hand-written check", () => {
    const cases: [string, string][] = [
      ["blocks/mermaid.ts", "    if (diagramSize(b) > 300) return pending();"],
      ["widgets.ts", "const MIN_DIAGRAM_SCALE = 0.5;"],
      ["blocks/mermaid.ts", "if (size >= LARGE_DIAGRAM_SIZE) return null;"],
    ];
    for (const [path, code] of cases) expect(violations([{ path, code }]), code).toHaveLength(1);
  });

  it("leaves the owners, readers and comments alone", () => {
    const cases: [string, string][] = [
      ["mermaidSize.ts", "export const LARGE_DIAGRAM_SIZE = 300;"],
      ["mermaid.ts", "  return diagramSize(body) > LARGE_DIAGRAM_SIZE;"],
      ["widgets.ts", "root.style.minWidth = `${box.width * MIN_DIAGRAM_SCALE}px`;"],
      ["blocks/mermaid.ts", "  const size = diagramSize(body);"],
      ["blocks/mermaid.ts", "// diagramSize(b) > 300 would be a second threshold"],
    ];
    for (const [path, code] of cases) expect(violations([{ path, code }]), code).toEqual([]);
  });
});
