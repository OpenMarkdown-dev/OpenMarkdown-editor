#!/usr/bin/env node
/**
 * Build `@openmarkdown-dev/editor` from the monorepo (spec: editor-package; change:
 * editor-package, design D1–D3). Two steps, one command — `npm run build:editor`:
 *
 *   1. JS   Vite library mode over the package's two entries (`ENTRIES`):
 *           `src/index.ts` (the editor) and `src/no-diagrams.ts` (the same
 *           editor without diagram support; spec: editor-package / 无图表的入口).
 *           The editor core (`src/editor/**` minus the agent layer) plus the
 *           allowlisted app leaves it reaches goes into ONE shared unminified
 *           ESM chunk `dist/editor.js`; `dist/index.js` and
 *           `dist/no-diagrams.js` are the entries' thin files — the full one
 *           adds the Mermaid loader (`src/editor/mermaidImport.ts`), the other
 *           never imports it. Externals are exactly `EXTERNAL` below —
 *           CodeMirror / Lezer (peers) and the two lazily imported renderers
 *           (dependencies) — so their `import()` stays a bare specifier the
 *           embedder's bundler splits.
 *   2. d.ts rollup-plugin-dts rolls each entry's public types into one file:
 *           `dist/index.d.ts` and `dist/no-diagrams.d.ts`.
 *
 * Writes `packages/editor/.build/modules.json` (NOT shipped): every module id
 * Rollup put in the output, with its rendered length. The package gate
 * (`scripts/check-editor-package.mjs`) reads it to prove what is — and is not —
 * inside the bundle (agent layer, CodeMirror, React, Tauri), and to list the
 * bundled third-party code for the license check.
 *
 * `--update-api` also copies each rolled `.d.ts` over its committed API
 * snapshot (`API_SNAPSHOTS`) — the only way to change the public surface on
 * purpose (gate: `api.gate.test.ts`).
 */
import { build } from "vite";
import { rollup } from "rollup";
import dts from "rollup-plugin-dts";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(fileURLToPath(import.meta.url));
/**
 * The source root — where `src/editor/` lives and what `@/` points into. Two
 * layouts, one build (change: editor-publish, design D2):
 *   - the monorepo: this file is `packages/editor/build.mjs`, sources at `../../src`;
 *   - the exported public repo (`scripts/export-editor.mjs`): this file sits at
 *     the repo root beside `src/editor/`.
 */
const repo = existsSync(join(pkgDir, "src/editor")) ? pkgDir : resolve(pkgDir, "../..");
const dist = join(pkgDir, "dist");
const meta = join(pkgDir, ".build");
/** The package's entries: name → source. Each is `exports["./<name>"]` (index: "."). */
export const ENTRIES = {
  index: join(pkgDir, "src/index.ts"),
  "no-diagrams": join(pkgDir, "src/no-diagrams.ts"),
};
/** Entry name → its committed API snapshot (`api.gate.test.ts`). */
export const API_SNAPSHOTS = {
  index: "api/editor.api.d.ts",
  "no-diagrams": "api/editor-no-diagrams.api.d.ts",
};
/** The one chunk both entries share: the editor itself. */
export const SHARED_CHUNK = "editor.js";

/**
 * The ONE externals list (design D2). Peers: CodeMirror and Lezer — a second
 * copy of `@codemirror/state` in a page breaks CM6 (`instanceof` checks across
 * copies fail: "Unrecognized extension value"). Dependencies: the lazy
 * renderers, left as bare `import()` so the embedder's bundler code-splits them
 * and dedupes them against its own copy.
 */
export const EXTERNAL = [/^@codemirror\//, /^@lezer\//, /^temml(\/|$)/, /^mermaid(\/|$)/];
const isExternal = (id) => EXTERNAL.some((re) => re.test(id));

/**
 * Roll the public declarations into one file at `outFile`. Also what the API
 * gate (`api.gate.test.ts`) runs, so the snapshot is compared with exactly what
 * the build ships.
 */
export async function rollTypes(outFile, name = "index") {
  const bundle = await rollup({
    input: ENTRIES[name],
    external: isExternal,
    plugins: [
      dts({
        tsconfig: join(pkgDir, "tsconfig.json"),
        compilerOptions: { baseUrl: repo, paths: { "@/*": ["./src/*"] } },
      }),
    ],
    onwarn(w, warn) {
      if (w.code !== "CIRCULAR_DEPENDENCY") warn(w);
    },
  });
  await bundle.write({ file: outFile, format: "es" });
  await bundle.close();
}

export async function buildEditorPackage({ updateApi = false, quiet = false } = {}) {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(meta, { recursive: true });

  const modules = {};
  await build({
    configFile: false,
    root: pkgDir,
    logLevel: quiet ? "error" : "info",
    // A production build: `import.meta.env.DEV` is a literal `false`, so dev-only
    // probes and asserts fold away instead of reading `import.meta.env` at runtime
    // in a host that has no Vite.
    mode: "production",
    resolve: { alias: { "@": join(repo, "src") } },
    // JSON (opens_as.json) is inlined as a module; no other asset kind is reachable.
    build: {
      outDir: dist,
      emptyOutDir: true,
      target: "es2022",
      minify: false,
      sourcemap: false,
      copyPublicDir: false,
      reportCompressedSize: false,
      lib: { entry: ENTRIES, formats: ["es"], fileName: (_format, name) => `${name}.js` },
      rollupOptions: {
        external: isExternal,
        // One shared chunk, named: a second one would collide here and fail the
        // build instead of slipping an unlisted file into the package.
        output: { chunkFileNames: SHARED_CHUNK },
        plugins: [
          {
            name: "openmd-module-manifest",
            generateBundle(_opts, bundle) {
              for (const chunk of Object.values(bundle)) {
                if (chunk.type !== "chunk") continue;
                for (const [id, m] of Object.entries(chunk.modules)) {
                  if (m.renderedLength === 0) continue;
                  const rel = id.startsWith("\0") ? id : relative(repo, id);
                  (modules[chunk.fileName] ??= []).push({ id: rel, bytes: m.renderedLength });
                }
              }
            },
          },
        ],
      },
    },
  });
  writeFileSync(join(meta, "modules.json"), JSON.stringify(modules, null, 2) + "\n");

  for (const name of Object.keys(ENTRIES)) await rollTypes(join(dist, `${name}.d.ts`), name);

  if (updateApi) {
    mkdirSync(join(pkgDir, "api"), { recursive: true });
    for (const [name, snapshot] of Object.entries(API_SNAPSHOTS)) {
      copyFileSync(join(dist, `${name}.d.ts`), join(pkgDir, snapshot));
      if (!quiet) console.log(`API snapshot updated: packages/editor/${snapshot}`);
    }
  }
  return { dist, modules };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildEditorPackage({ updateApi: process.argv.includes("--update-api") });
}
