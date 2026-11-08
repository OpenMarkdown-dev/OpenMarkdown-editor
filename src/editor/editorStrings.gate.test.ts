import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";
import { buildGraph, resolveImport } from "../../scripts/lib/moduleGraph.mjs";
import { configureEditorEnvironment, type EditorEnvironment } from "./environment";
import {
  DEFAULT_EDITOR_LANG,
  EDITOR_LANGS,
  EDITOR_STRINGS,
  editorLang,
  editorString,
  type EditorStringKey,
} from "./strings";

/**
 * Gate (spec: editor-host / 编辑器自带界面文字、语言由宿主指定). The editor's UI
 * words are its own table (`strings.ts`), in the language the host picks.
 * Fails when:
 *
 * - an editor file imports the app's dictionary (`lib/i18n.ts`) — any import,
 *   type-only and dynamic included — or reaches it through a runtime import
 *   chain (printed);
 * - a key passed to `editorString` anywhere in `src/` is missing from the table;
 * - a language's entry is empty or loses / renames a `{placeholder}` of zh's;
 * - the table keeps a key no editor file draws (the set stays minimal);
 * - an editor module draws a word at module evaluation (a top-level
 *   `editorString(` line), before the host could have named the language.
 *
 * HONEST LIMITS: keys are read as string literals inside the call's line (a key
 * built at run time is not seen — `tsc` still types it); the top-level check
 * sees an unindented line only, not a call nested in a top-level object literal.
 */

const SRC = join(process.cwd(), "src");

function sources(): Record<string, string> {
  const files = listFiles(SRC, {
    include: /\.tsx?$/,
    exclude: (name: string) => /\.test\.tsx?$/.test(name) || name.endsWith(".d.ts"),
  });
  return Object.fromEntries(files.map((f: string) => [repoPath(SRC, f), readFileSync(f, "utf8")]));
}

const src = sources();
const files = new Set(Object.keys(src));
const editorFiles = Object.keys(src).filter((p) => p.startsWith("editor/"));
const APP_DICT = "lib/i18n.ts";
const KEYS = Object.keys(EDITOR_STRINGS.zh) as EditorStringKey[];

/** Every key literal handed to `editorString(` in `text`, with its line. */
function usedKeys(text: string): { key: string; line: number }[] {
  const out: { key: string; line: number }[] = [];
  text.split("\n").forEach((l, i) => {
    for (const call of l.matchAll(/\beditorString\(([^)]*)/g)) {
      for (const m of call[1].matchAll(/["']([a-z]+\.[A-Za-z.]+)["']/g)) out.push({ key: m[1], line: i + 1 });
    }
  });
  return out;
}

describe("editor strings gate", () => {
  it("sees the editor tree and its words (guards against an empty scan passing)", () => {
    expect(editorFiles.length).toBeGreaterThan(50);
    expect(editorFiles.flatMap((p) => usedKeys(src[p])).length).toBeGreaterThan(10);
  });

  it("no editor file imports the app dictionary", () => {
    const bad: string[] = [];
    for (const p of editorFiles) {
      src[p].split("\n").forEach((l, i) => {
        for (const m of l.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/g)) {
          const spec = m[1] ?? m[2] ?? m[3];
          if (resolveImport(p, spec, files) === APP_DICT) bad.push(`${p}:${i + 1}  ${l.trim()}`);
        }
      });
    }
    expect(bad, `the editor has its own words (editor/strings.ts) — drop the app i18n import:\n${bad.join("\n")}`).toEqual([]);
  });

  it("no runtime import chain from the editor reaches the app dictionary", () => {
    const graph = buildGraph(src) as { edges: { from: string; to: string; line: number; text: string }[] };
    const parent = new Map<string, { from: string; line: number; text: string } | null>(editorFiles.map((f) => [f, null]));
    const queue = [...editorFiles];
    while (queue.length) {
      const n = queue.shift()!;
      for (const e of graph.edges) {
        if (e.from !== n || parent.has(e.to)) continue;
        parent.set(e.to, e);
        queue.push(e.to);
      }
    }
    const chain: string[] = [];
    for (let at = APP_DICT, e = parent.get(at); e; at = e.from, e = parent.get(at)) {
      chain.unshift(`    ${`${e.from}:${e.line}`.padEnd(34)} ${e.text}`);
    }
    expect(parent.has(APP_DICT), `the editor reaches ${APP_DICT}:\n${chain.join("\n")}`).toBe(false);
  });

  it("every key drawn anywhere is in the table", () => {
    const missing = Object.keys(src)
      .flatMap((p) => usedKeys(src[p]).map((u) => ({ ...u, p })))
      .filter((u) => !(u.key in EDITOR_STRINGS.zh))
      .map((u) => `${u.p}:${u.line}  ${u.key}`);
    expect(missing).toEqual([]);
  });

  const tokens = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();

  it.each(EDITOR_LANGS)("%s has every key, none empty, zh's placeholders kept", (lang) => {
    const table = EDITOR_STRINGS[lang];
    const bad: string[] = [];
    for (const key of KEYS) {
      const got = table[key];
      if (typeof got !== "string" || !got.trim()) bad.push(`${key}: missing or empty`);
      else if (tokens(got).join() !== tokens(EDITOR_STRINGS.zh[key]).join()) bad.push(`${key}: {${tokens(got)}} vs zh`);
    }
    for (const key of Object.keys(table)) if (!(key in EDITOR_STRINGS.zh)) bad.push(`${key}: not a zh key`);
    expect(bad).toEqual([]);
  });

  it("the table keeps no key the editor does not draw", () => {
    const drawn = new Set(editorFiles.flatMap((p) => usedKeys(src[p]).map((u) => u.key)));
    expect(KEYS.filter((k) => !drawn.has(k))).toEqual([]);
  });

  it("no editor module draws a word at module evaluation", () => {
    const top = editorFiles.flatMap((p) =>
      src[p]
        .split("\n")
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /^\S/.test(l) && /\beditorString\(/.test(l) && !/^export function editorString\(/.test(l))
        .map(({ l, i }) => `${p}:${i + 1}  ${l.trim()}`),
    );
    expect(top, "read the language when drawing (inside a function), not at import time").toEqual([]);
  });
});

describe("the host picks the language", () => {
  afterEach(() => configureEditorEnvironment({}));

  it("defaults to English when the host names none", () => {
    configureEditorEnvironment({});
    expect(DEFAULT_EDITOR_LANG).toBe("en");
    expect(editorLang()).toBe("en");
    expect(editorString("widget.copyCode")).toBe("Copy code");
  });

  it("speaks the host's language, read at call time", () => {
    configureEditorEnvironment({ language: "ko" });
    expect(editorString("widget.fold")).toBe("접기");
    configureEditorEnvironment({ language: "zh" });
    expect(editorString("find.close")).toBe("关闭 (Esc)");
    expect(editorString("widget.renderFailed", { reason: "x" })).toBe("无法渲染:x");
  });

  it("falls back to English for a language it does not ship", () => {
    configureEditorEnvironment({ language: "fr" } as unknown as EditorEnvironment);
    expect(editorLang()).toBe("en");
  });

  it("follows a host getter, so the host's boot-time language wins whatever the import order", () => {
    let lang: "ja" | "en" = "en";
    configureEditorEnvironment({
      get language() {
        return lang;
      },
    });
    lang = "ja";
    expect(editorString("props.add")).toBe("+ プロパティを追加");
  });
});
