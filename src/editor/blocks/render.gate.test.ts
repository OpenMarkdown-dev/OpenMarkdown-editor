import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../../scripts/lib/repoFiles.mjs";

/**
 * Gate (spec: block-editing / 渲染失败只在一处接住; change: block-fallback, design
 * D8). A renderer only draws: it returns its output, returns null for "not now",
 * or THROWS for "cannot". Catching that throw, showing the document's own text
 * and marking it is done once, by `attemptRender` in `blocks/render.ts`. This
 * test fails, with file:line, on the three shapes of a renderer that decides
 * its own failure instead:
 *
 * - R1: a renderer told not to throw — `throwOnError: false` anywhere, or a
 *   `.renderToString(` call with no `throwOnError: true` on its line or the two
 *   after it (Temml's default is false: it paints the error red and returns it);
 * - R2: a try / catch in a renderer module — `editor/blocks/` (bar render.ts),
 *   `editor/math.ts`, `editor/mermaid.ts`, `editor/widgets.ts`;
 * - R3: the failure mark's class named outside render.ts and the editor theme;
 * - R4 (change: render-placeholder-size, design D9): "not yet" answered with
 *   `null` — in a renderer module, an `if (!…) return null` on a not-ready
 *   check (`isMathReady()`) or within NOT_READY_WINDOW lines after a render
 *   cache lookup (`shownMermaid(`). The not-ready answer is `pending(…)`;
 * - R5: the placeholder's class `om-pending` named outside `blocks/pending.ts`
 *   and the editor theme, so no module draws its own placeholder.
 *
 * Limits (stated, not hidden): textual, comments stripped first, tests not
 * scanned. A renderer outside these modules that validates by hand and returns
 * null instead of throwing is not seen — a review item. Mermaid (change:
 * editor-mermaid) is a registry entry under `blocks/` plus its renderer module
 * `editor/mermaid.ts`, both inside the scope.
 */

const SRC = join(__dirname, "../..");

interface Rule {
  what: string;
  scope: (path: string) => boolean;
  /** The 0-based lines of `lines` that break the rule. */
  hits: (lines: string[]) => number[];
  owners: Record<string, string>;
}

const RENDERER_MODULE = (path: string) =>
  (path.startsWith("editor/blocks/") && path !== "editor/blocks/render.ts") ||
  path === "editor/math.ts" ||
  path === "editor/mermaid.ts" ||
  path === "editor/widgets.ts";

/**
 * The named exceptions to R2: each renderer's lazy-load `.catch` — a failed
 * LOAD is not one place that cannot render (everything stays source,
 * unmarked). Module → its load expression: math.ts imports temml itself;
 * mermaid.ts calls the injected loader (`./mermaidImport.ts` holds the one
 * `import("mermaid")`, so the diagram-free entry never reaches it).
 */
const LOADERS: Record<string, RegExp> = {
  "editor/math.ts": /\bimport\(\s*["']temml["']\s*\)/,
  "editor/mermaid.ts": /\bloaded = load\(\)/,
};
const LOADER_CATCH_WINDOW = 8;
const isLoaderCatch = (path: string, lines: string[], i: number) =>
  path in LOADERS &&
  /^\s*\.catch\(/.test(lines[i]) &&
  lines
    .slice(Math.max(0, i - LOADER_CATCH_WINDOW), i)
    .some((l) => LOADERS[path].test(l));

/** A not-ready probe: the converter check, or a render-cache lookup. */
const NOT_READY = /\bisMathReady\(\)|\bshownMermaid\(/;
const NOT_READY_WINDOW = 3;
/** "Not ready → null": an `if (!x …) return null`, the shape that hides "not yet" as "not mine". */
const NULL_ON_NOT_READY = /\bif\s*\(\s*!\s*[\w.?]+(?:\(\))?[^)]*\)\s*return\s+null\b/;

const RULES: ((path: string) => Rule)[] = [
  () => ({
    what: "a renderer told not to throw (renderers throw; attemptRender in blocks/render.ts catches)",
    scope: () => true,
    hits: (lines) =>
      lines.flatMap((l, i) => {
        if (/\bthrowOnError\s*:\s*false\b/.test(l)) return [i];
        if (/\.renderToString\s*\(/.test(l)) {
          const near = lines.slice(i, i + 3).join("\n");
          return /\bthrowOnError\s*:\s*true\b/.test(near) ? [] : [i];
        }
        return [];
      }),
    owners: {},
  }),
  (path) => ({
    what: "a renderer catching its own error (let it throw; attemptRender in blocks/render.ts catches)",
    scope: RENDERER_MODULE,
    hits: (lines) =>
      lines.flatMap((l, i) =>
        /\btry\s*\{|\bcatch\s*[{(]|\.catch\s*\(/.test(l) && !isLoaderCatch(path, lines, i) ? [i] : [],
      ),
    owners: {},
  }),
  () => ({
    what: "the render-failure mark named outside blocks/render.ts (use failedSourceMark)",
    scope: () => true,
    // The class, not the `data-om-render-failed` hook the harness reads.
    hits: (lines) => lines.flatMap((l, i) => (/(?<![\w-])om-render-failed/.test(l) ? [i] : [])),
    owners: {
      "editor/blocks/render.ts": "the one failure mark",
      "editor/theme.ts": "its one style rule",
    },
  }),
  () => ({
    what: "\"not yet\" answered with null (return pending() — blocks/render.ts; null means \"not mine\")",
    scope: RENDERER_MODULE,
    hits: (lines) =>
      lines.flatMap((l, i) => {
        if (!NULL_ON_NOT_READY.test(l)) return [];
        const recent = lines.slice(Math.max(0, i - NOT_READY_WINDOW), i + 1);
        return recent.some((r) => NOT_READY.test(r)) ? [i] : [];
      }),
    owners: {},
  }),
  () => ({
    what: "the placeholder class named outside blocks/pending.ts (use PendingWidget / pendingElement / markPending)",
    scope: () => true,
    hits: (lines) => lines.flatMap((l, i) => (/(?<![\w-])om-pending(?![\w-])/.test(l) ? [i] : [])),
    owners: {
      "editor/blocks/pending.ts": "the one placeholder",
      "editor/theme.ts": "its one style rule",
    },
  }),
];

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function violations(files: { path: string; code: string }[]): string[] {
  const found: string[] = [];
  for (const { path, code } of files) {
    const lines = stripComments(code).split("\n");
    for (const make of RULES) {
      const rule = make(path);
      if (!rule.scope(path) || rule.owners[path]) continue;
      for (const i of rule.hits(lines)) found.push(`${path}:${i + 1}: ${rule.what}`);
    }
  }
  return found;
}

describe("render-fallback gate", () => {
  it("renderers throw, and only blocks/render.ts catches and marks", () => {
    const files = listFiles(SRC, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ }).map((p) => ({
      path: repoPath(SRC, p),
      code: readFileSync(p, "utf8"),
    }));
    expect(files.some((f) => f.path === "editor/blocks/render.ts")).toBe(true);
    expect(violations(files)).toEqual([]);
  });

  it("catches each shape of a renderer deciding its own failure", () => {
    const cases: [string, string][] = [
      ["editor/math.ts", "temml.renderToString(tex, { displayMode, throwOnError: false });"],
      ["lib/x.ts", "const o = { throwOnError : false };"],
      ["editor/math.ts", "temml.renderToString(tex, { displayMode });"],
      ["editor/blocks/table.ts", "try {\n  parse();\n} finally {}"],
      ["editor/widgets.ts", "mermaid.render(id, src).catch((e) => fallback(e));"],
      ["editor/math.ts", "} catch (e) {"],
      ["editor/blocks/mermaid.ts", "} catch {"],
      ["editor/mermaid.ts", "mermaidAPI.render(id, body).catch(() => null);"],
      // mermaid.ts's loader exception names mermaid, not temml.
      ["editor/mermaid.ts", 'import("temml")\n  .then((m) => use(m))\n  .catch((e: unknown) => {'],
      ["editor/livePreview.ts", 'deco.push(Decoration.mark({ class: "om-render-failed" }));'],
      // A `.catch` in math.ts that is not the converter's load.
      ["editor/math.ts", 'load("other")\n  .catch((e) => {});'],
      // R4: "not yet" hidden as "not mine".
      ["editor/blocks/math.ts", "    if (!isMathReady()) return null;"],
      ["editor/blocks/mermaid.ts", "    const out = shownMermaid(fence.body, scheme);\n    if (!out || out.kind === \"source\") return null;"],
      // R5: a second placeholder.
      ["editor/livePreview.ts", 'el.className = "om-pending";'],
      ["components/X.tsx", '<div className="om-pending" />'],
    ];
    for (const [path, code] of cases) expect(violations([{ path, code }]), `${path}: ${code}`).toHaveLength(1);
  });

  it("leaves the wrapper, the loader, the theme, other layers and comments alone", () => {
    const cases: [string, string][] = [
      ["editor/math.ts", 'import("temml")\n  .then((m) => use(m))\n  .catch((e: unknown) => {'],
      ["editor/mermaid.ts", 'loaded = load()\n  .catch((e: unknown) => {'],
      ["editor/math.ts", "temml.renderToString(tex, {\n  displayMode,\n  throwOnError: true,\n});"],
      ["editor/blocks/render.ts", "try {\n  return ok(render());\n} catch (e) {"],
      ["editor/blocks/render.ts", 'Decoration.mark({ class: "om-render-failed" })'],
      ["editor/theme.ts", '".om-render-failed": { cursor: "help" },'],
      ["editor/linkResolve.ts", "try {\n  new URL(x);\n} catch {"],
      ["editor/math.ts", "// throwOnError: false would paint the error red"],
      ["dev/harness/cases.ts", 'document.querySelectorAll("[data-om-render-failed]")'],
      // R4: the not-ready answer is pending; null for "not mine" is fine.
      ["editor/blocks/math.ts", "    if (!isMathReady()) return pending();"],
      ["editor/blocks/mermaid.ts", "    const out = shownMermaid(fence.body, scheme);\n    if (out?.kind === \"source\") return null;\n    if (!out) return pending();"],
      ["editor/blocks/mermaid.ts", "    if (!fence) return null;"],
      // R5: the owner, the theme, and a data hook that is not the class.
      ["editor/blocks/pending.ts", 'const PENDING_CLASS = "om-pending";'],
      ["editor/theme.ts", '".om-pending": { borderRadius: "var(--ome-radius)" },'],
      ["dev/harness/cases.ts", 'document.querySelectorAll("[data-om-pending]")'],
    ];
    for (const [path, code] of cases) expect(violations([{ path, code }]), `${path}: ${code}`).toEqual([]);
  });
});
