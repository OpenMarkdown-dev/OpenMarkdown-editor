import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";
import * as editorPackage from "../index";

/**
 * Gate (spec: editor-docs / 保真页给出可自跑的无损往返检查; editor-fidelity /
 * 对外名称 lossless round-trip; change: editor-lossless-claim, D5).
 *
 * The fidelity page tells readers to run one script on their own file and see
 * `byte-identical`. This gate runs THAT script — the `js roundtrip-check` block,
 * exactly as the page shows it, with only its import from
 * `@openmarkdown-dev/editor` bound to the package's public entry (the module
 * imported above) — over every file in `fixtures/roundtrip/` and the corpus's
 * line-ending / BOM / final-newline variants. Every run must print
 * `byte-identical`; a control run on an edited document must print `changed`,
 * so the gate can fail.
 *
 * It ships in the public editor repository too (scripts/lib/editorExport.mjs):
 * there the fixtures sit at the same repo-relative path, and the package's
 * `docs/` is at the root instead of under `packages/editor/`.
 */

const ROOT = resolve(__dirname, "../..");
const FIXTURES = join(ROOT, "fixtures/roundtrip");
/** The package's docs: `packages/editor/docs/` here, `docs/` in the public repository. */
const DOCS = [join(ROOT, "packages/editor/docs"), join(ROOT, "docs")].find((d) => existsSync(join(d, "fidelity.md")));
if (!DOCS) throw new Error("fidelity.md not found under packages/editor/docs/ or docs/");
const page = readFileSync(join(DOCS, "fidelity.md"), "utf8");

/** The ONE fenced block whose info string is `js roundtrip-check`. */
const blocks = [...page.matchAll(/^```js[ \t]+roundtrip-check[ \t]*\n([\s\S]*?)^```$/gm)];
const code = blocks.length === 1 ? blocks[0][1] : "";

const IMPORT = /^import \{([^}]+)\} from "@openmarkdown-dev\/editor";$/m;
/** The page's script, its package import bound to the public entry. */
const bind = (src: string) => src.replace(IMPORT, "const {$1} = globalThis.__openmarkdownEditor;");

const work = mkdtempSync(join(tmpdir(), "om-roundtrip-"));
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  delete (globalThis as Record<string, unknown>).__openmarkdownEditor;
});

let n = 0;
/** Run the page's script as `node roundtrip.mjs <file>`; return what it printed. */
async function runPageScript(bytes: Uint8Array, src = code): Promise<string> {
  const id = n++;
  const input = join(work, `in-${id}.md`);
  writeFileSync(input, bytes);
  const script = join(work, `roundtrip-${id}.mjs`);
  writeFileSync(script, bind(src));
  (globalThis as Record<string, unknown>).__openmarkdownEditor = editorPackage;
  const argv = process.argv;
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  try {
    process.argv = [argv[0], script, input];
    await import(/* @vite-ignore */ pathToFileURL(script).href);
  } finally {
    process.argv = argv;
    log.mockRestore();
  }
  return out.join("\n");
}

const enc = (s: string) => new TextEncoder().encode(s);
const BOM = "﻿";
const files: string[] = listFiles(FIXTURES, { include: /\.md$/, recursive: false });
const CORPUS = readFileSync(join(FIXTURES, "corpus.md"), "utf8");
const cases: [string, Uint8Array][] = [
  ...files.map((f): [string, Uint8Array] => [repoPath(FIXTURES, f), readFileSync(f)]),
  ["corpus.md as CRLF", enc(CORPUS.replaceAll("\n", "\r\n"))],
  ["corpus.md with BOM", enc(BOM + CORPUS)],
  ["corpus.md with BOM + CRLF", enc(BOM + CORPUS.replaceAll("\n", "\r\n"))],
  ["corpus.md without a final newline", enc(CORPUS.replace(/\n$/, ""))],
  ["corpus.md with three final newlines", enc(CORPUS + "\n\n")],
  ["corpus.md with mixed line endings", enc(CORPUS.replace(/\n/g, (_m, at: number) => (at % 3 === 0 ? "\r\n" : "\n")))],
  ["corpus.md with lone CR line breaks", enc(CORPUS.replaceAll("\n", "\r"))],
];

describe("the fidelity page's round-trip check", () => {
  it("is exactly one js block that imports the package's file path from @openmarkdown-dev/editor", () => {
    expect(blocks).toHaveLength(1);
    expect(code).toMatch(IMPORT);
    expect(bind(code)).not.toMatch(/@openmarkdown-dev\/editor/);
    for (const name of ["openMarkdownFile", "createEditorState", "saveMarkdownFile"]) expect(code).toContain(name);
    expect(code).toMatch(/"byte-identical"/);
  });

  it("covers both fixture files, and the variants are what they say", () => {
    expect(files.map((f) => repoPath(FIXTURES, f)).sort()).toEqual(["corpus.md", "crlf-bom.md"]);
    const mixed = new TextDecoder().decode(cases.find(([name]) => name.includes("mixed"))![1]);
    expect(mixed).toMatch(/\r\n/);
    expect(mixed).toMatch(/[^\r]\n/);
  });

  for (const [name, bytes] of cases) {
    it(`${name}: prints byte-identical`, async () => {
      expect(await runPageScript(bytes)).toBe("byte-identical");
    });
  }

  it("prints changed when the document was edited (the gate can fail)", async () => {
    const edited = code.replace("state.doc.toString()", 'state.doc.toString() + "x"');
    expect(edited).not.toBe(code);
    expect(await runPageScript(enc(CORPUS), edited)).toBe("changed");
  });
});
