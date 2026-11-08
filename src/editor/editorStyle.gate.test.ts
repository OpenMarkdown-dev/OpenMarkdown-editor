import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";
import { EDITOR_TOKENS } from "./tokens";

/**
 * Gate (spec: editor-host / 编辑器样式自成一体; change: editor-style-tokens,
 * design D7). The editor core ships to hosts with none of the app's CSS, so it
 * paints only through its own tokens and classes. Fails, with `file:line`, on:
 *
 * - T1: a `var(--x)` in editor code that is neither an editor token
 *   (`--ome-<role>` in `tokens.ts`) nor on INTERNAL below — a variable the
 *   editor writes for itself, or the host's one knob, each with its reason;
 * - T2: a colour literal (`#hex`, `rgb()`, `hsl()`, `oklch()`, `oklab()`,
 *   `lab()`, `lch()`, `hwb()`) anywhere in editor code but `tokens.ts`, the
 *   one table of defaults;
 * - T3: a class the editor writes (`className = …`, `className: …`,
 *   `classList.add / toggle / remove(…)`, `optionClass`) outside its own
 *   namespaces `om-` / `ome-` / `cm-` — a Tailwind utility, say, which a host
 *   without Tailwind would not style.
 * INTERNAL and EXEMPT keep no dead entries.
 *
 * HONEST LIMITS: lexical, comment lines skipped. A name or a class assembled
 * at runtime (beyond a `${…}` tail), a named colour (`"red"`), or a style
 * written through `element.style` from a computed string is not seen; the
 * mirror tests (`tokens.test.ts`, `primitives.test.ts`) and the browser
 * harness judge the rendered result.
 */

const SRC = join(process.cwd(), "src");
const TOKEN_FILE = "editor/tokens.ts";

/** Variables the editor may read that are not tokens — each with its reason. */
const INTERNAL: Record<string, string> = {
  "--ome-state-layer": "the state layer `.ome-state` chooses (primitives.ts); its hand-back re-paints it",
  "--om-inset": "a line's left inset, written by the inset composer (insets/)",
  "--om-inset-img": "the inset composer's bar / fill layers",
  "--om-inset-pos": "the inset composer's layer positions",
  "--om-inset-size": "the inset composer's layer sizes",
  "--om-bar-": "one quote / callout bar's x (insets/compose.ts, per level)",
  "--om-fill-": "one callout tint's x (insets/compose.ts, per level)",
  "--om-mark-x": "a list marker's x (inset composer)",
  "--om-mark-w": "a list marker's width (inset composer)",
  "--om-fold-x": "the fold toggle's x (inset composer)",
  "--om-fold-left": "the fold toggle's x resolved on its line (registered in primitives.ts)",
  "--cc": "a callout's colour, set per type on its line from an --ome-callout-* token",
  "--om-pdf-margin": "the PDF page's side margin, set on the exported page by its paginate script (render/paginate.ts), not the editor",
  "--om-pdf-band": "the PDF page's printable height, set like --om-pdf-margin (render/paginate.ts)",
  CONTENT_ZOOM_VAR: "the host's content zoom (--om-content-zoom), read with a fallback of 1: no host, no zoom",
};

/** Files outside this gate's T1, each with its reason. */
const EXEMPT: Record<string, string> = {};

const tokenNames = Object.keys(EDITOR_TOKENS).map((t) => `--ome-${t}`);

function productFiles(): { path: string; lines: string[] }[] {
  // The agent layer (`editor/agent/**`) is not the core: the app installs it as
  // a plugin and it may read app tokens such as --agent (spec: editor-host).
  return listFiles(join(SRC, "editor"), { include: /\.ts$/, exclude: /\.test\.ts$/ })
    .filter((f: string) => !repoPath(SRC, f).startsWith("editor/agent/"))
    .map((f: string) => ({
    path: repoPath(SRC, f),
    lines: readFileSync(f, "utf8").split("\n"),
  }));
}

const isComment = (l: string) => /^\s*(?:\/\/|\*|\/\*)/.test(l);
const code = (l: string) => l.replace(/\s\/\/\s.*$/, "");

/** T1: is `var(<ref>` allowed? `ref` is `--name`, `--name${` (a templated tail) or `${CONST}`. */
function varAllowed(ref: string, used: Set<string>): boolean {
  const tail = ref.endsWith("${");
  const name = tail ? ref.slice(0, -2) : ref;
  const constRef = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(ref)?.[1];
  const key = constRef ?? name;
  if (Object.hasOwn(INTERNAL, key)) return used.add(key), true;
  if (tail) return tokenNames.some((t) => t.startsWith(name));
  return tokenNames.includes(name);
}

const VAR_REF = /var\(\s*(--[A-Za-z0-9_-]+(?:\$\{)?|\$\{[A-Za-z0-9_]+\})/g;
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
const CLASS_WRITES = [
  /\bclassName\s*=\s*(["'`])((?:(?!\1).)*)\1/g,
  /\bclassName\s*:\s*(["'`])((?:(?!\1).)*)\1/g,
  /\boptionClass\s*:\s*\([^)]*\)\s*=>\s*(["'`])((?:(?!\1).)*)\1/g,
];
const CLASS_LIST = /\bclassList\.(?:add|toggle|remove)\(([^)]*)\)/g;
const OWN_CLASS = /^(?:om|ome|cm)-|\$\{/;

export function violations(files: { path: string; lines: string[] }[], used = new Set<string>()): string[] {
  const out: string[] = [];
  for (const { path, lines } of files) {
    lines.forEach((raw, i) => {
      if (isComment(raw)) return;
      const line = code(raw);
      const at = `${path}:${i + 1}`;
      if (!Object.hasOwn(EXEMPT, path)) {
        for (const m of line.matchAll(VAR_REF)) {
          if (!varAllowed(m[1], used)) out.push(`${at}: var(${m[1]}) is neither an editor token (--ome-*, tokens.ts) nor INTERNAL — T1`);
        }
      }
      if (path !== TOKEN_FILE && COLOUR.test(line)) out.push(`${at}: a colour literal outside the token table (${TOKEN_FILE}) — T2`);
      const classes: string[] = [];
      for (const re of CLASS_WRITES) for (const m of line.matchAll(re)) classes.push(...m[2].split(/\s+/));
      for (const m of line.matchAll(CLASS_LIST)) {
        for (const s of m[1].matchAll(/(["'`])((?:(?!\1).)*)\1/g)) classes.push(...s[2].split(/\s+/));
      }
      for (const c of classes.filter(Boolean)) {
        if (!OWN_CLASS.test(c)) out.push(`${at}: class "${c}" is outside the editor's namespaces (om- / ome- / cm-) — T3`);
      }
    });
  }
  return out;
}

const probe = (path: string, code: string) => violations([{ path, lines: code.split("\n") }]);

describe("editor style gate", () => {
  const files = productFiles();

  it("sees the editor (guards against an empty scan passing)", () => {
    expect(files.some((f) => f.path === "editor/theme.ts")).toBe(true);
    expect(files.some((f) => f.path === TOKEN_FILE)).toBe(true);
  });

  it("the editor paints only through its tokens and its own classes", () => {
    const v = violations(files);
    expect(v, `editor style: ${v.length} violation(s):\n${v.join("\n")}\n`).toEqual([]);
  });

  it("INTERNAL and EXEMPT keep no dead entries", () => {
    const used = new Set<string>();
    violations(files, used);
    expect(Object.keys(INTERNAL).filter((k) => !used.has(k)), "INTERNAL entries no editor file reads — delete them").toEqual([]);
    const gone = Object.keys(EXEMPT).filter((p) => !existsSync(join(SRC, p)));
    expect(gone, "EXEMPT files that no longer exist — delete them").toEqual([]);
    const clean = Object.keys(EXEMPT).filter((p) => {
      const f = files.find((x) => x.path === p)!;
      return f && violations([{ ...f, path: "editor/__probe.ts" }]).length === 0;
    });
    expect(clean, "EXEMPT files that would pass without the exemption — delete them").toEqual([]);
  });

  it("T1 catches an app variable and an unknown token; passes tokens, templated tails and INTERNAL", () => {
    expect(probe("editor/x.ts", `const a = { color: "var(--primary)" };`)).toHaveLength(1);
    expect(probe("editor/x.ts", `const a = { color: "var(--ome-primary)" };`)).toHaveLength(1);
    expect(probe("editor/x.ts", "const a = `var(--om-whatever-${i})`;")).toHaveLength(1);
    expect(probe("editor/x.ts", "const a = `var(${OTHER_VAR}, 1)`;")).toHaveLength(1);
    expect(probe("editor/x.ts", `const a = { color: "var(--ome-accent)", b: "var(--om-inset, 0px)" };`)).toEqual([]);
    expect(probe("editor/x.ts", "const a = `var(--ome-callout-${t})`; const z = `var(${CONTENT_ZOOM_VAR}, 1)`;")).toEqual([]);
    expect(productFiles().some((f) => f.path.startsWith("editor/agent/"))).toBe(false);
  });

  it("T2 catches a colour literal outside the token table", () => {
    expect(probe("editor/theme.ts", `const a = { color: "#17c" };`)).toHaveLength(1);
    expect(probe("editor/theme.ts", `const a = { color: "oklch(0.5 0.1 200)" };`)).toHaveLength(1);
    expect(probe("editor/theme.ts", `const a = { boxShadow: "0 1px rgba(0,0,0,.1)" };`)).toHaveLength(1);
    expect(probe(TOKEN_FILE, `  bg: { light: "oklch(0.99 0.002 95)", dark: "oklch(0.2 0.005 270)" },`)).toEqual([]);
    expect(probe("editor/theme.ts", `// CM paints #17c here\nconst a = { color: "var(--ome-fg)" }; // not #fff`)).toEqual([]);
  });

  it("T3 catches a Tailwind utility written as a class; passes the editor's namespaces", () => {
    expect(probe("editor/x.ts", `el.className = "om-x text-muted-foreground";`)).toHaveLength(1);
    expect(probe("editor/x.ts", `el.classList.add("om-x", "px-2");`)).toHaveLength(1);
    expect(probe("editor/x.ts", `editorIconButton({ glyph: "copy", className: "h-6" });`)).toHaveLength(1);
    expect(probe("editor/x.ts", `autocompletion({ optionClass: () => "bg-muted" });`)).toHaveLength(1);
    expect(probe("editor/x.ts", "el.className = `om-a ome-state cm-foldPlaceholder ${HOST_CLASS}`;")).toEqual([]);
    expect(probe("editor/x.ts", `el.classList.toggle("om-find-no-match", on);`)).toEqual([]);
  });
});
