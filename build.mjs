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
 *   2. browser  each `BROWSER_BUILDS` file: the same source as its entry, as
 *           ONE minified ESM file with nothing external (change:
 *           editor-lean-deps) — for pages without a bundler. Its module list
 *           is `.build/browser-modules.json`.
 *   3. d.ts rollup-plugin-dts rolls each entry's public types into one file:
 *           `dist/index.d.ts`, `dist/no-diagrams.d.ts`, `dist/no-renderers.d.ts`.
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
import { build, transformWithEsbuild } from "vite";
import { rollup } from "rollup";
import dts from "rollup-plugin-dts";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  "no-renderers": join(pkgDir, "src/no-renderers.ts"),
};
/**
 * Entry name → the editor-core module behind it and the built-in renderer
 * packages its closure reaches (change: editor-lean-deps; spec: editor-package
 * / 入口与内置渲染器). The one table: `package.gate.test.ts` proves each
 * closure on the source graph, `check-editor-package.mjs` on the build, and
 * `check-editor-consumer.mjs` in an IIFE bundle. A host's `renderMath` /
 * `renderDiagram` works with every entry.
 */
export const ENTRY_RENDERERS = {
  index: { core: "editor/index.ts", renderers: ["temml", "mermaid"] },
  "no-diagrams": { core: "editor/noDiagrams.ts", renderers: ["temml"] },
  "no-renderers": { core: "editor/base.ts", renderers: [] },
};
/** The renderer packages an entry may carry built in. */
export const RENDERER_PACKAGES = ["temml", "mermaid"];
/**
 * The shape of the dependency declarations (change: editor-lean-deps): no
 * declared package is pinned to one exact version (a host on another patch
 * gets a second copy); these are never declared — a host opts in to them
 * itself; and these are the optional peers (none today).
 */
export const DEPENDENCY_SHAPE = {
  hostOptIn: ["@codemirror/language-data"],
  optionalPeers: [],
};
/** Entry name → its committed API snapshot (`api.gate.test.ts`). */
export const API_SNAPSHOTS = {
  index: "api/editor.api.d.ts",
  "no-diagrams": "api/editor-no-diagrams.api.d.ts",
  "no-renderers": "api/editor-no-renderers.api.d.ts",
};
/** The one chunk every entry shares: the editor itself. */
export const SHARED_CHUNK = "editor.js";
/**
 * The other chunks, by file → exactly the modules in it, the lazily loaded
 * one first (change: editor-lean-deps):
 *   - `math.js`, the built-in Temml loader, which the full and the
 *     diagram-free entries share and the entry without renderers never
 *     imports — so it cannot live in the shared chunk (that would put
 *     `import("temml")` in every entry's static closure);
 *   - `diagram.js`, how a diagram is drawn (`mermaidRender.ts`) and the
 *     sanitiser's diagram profile it alone uses (`diagramMarkup.ts`), loaded
 *     with the first diagram — never part of an entry's first load.
 */
export const NAMED_CHUNKS = {
  "math.js": ["src/editor/mathImport.ts"],
  "diagram.js": ["src/editor/mermaidRender.ts", "src/editor/diagramMarkup.ts"],
};
/**
 * The prebuilt single-file browser builds (change: editor-lean-deps, #4):
 * file → the entry it is built from. One minified ESM file with everything
 * it needs inlined — CodeMirror, Lezer, the HTML grammar and the built-in
 * renderers of that entry — for a page with no bundler (`<script
 * type="module">`, an import map, a CDN). A single file cannot load anything
 * later, so it is built from the diagram-free entry: Mermaid alone would be
 * several times the editor; diagrams come from the page's own Mermaid
 * (`renderDiagram`). Its types are that entry's. Exported as `./browser`.
 */
export const BROWSER_BUILDS = { "browser.js": "no-diagrams" };
/** Every file the package ships from `dist/`: each entry with its types, the chunks, the browser builds. The one list. */
export const DIST_FILES = [
  ...Object.keys(ENTRIES).flatMap((name) => [`dist/${name}.js`, `dist/${name}.d.ts`]),
  `dist/${SHARED_CHUNK}`,
  ...Object.keys(NAMED_CHUNKS).map((f) => `dist/${f}`),
  ...Object.keys(BROWSER_BUILDS).map((f) => `dist/${f}`),
];

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

/**
 * The license notices of the third-party packages bundled into a browser
 * build, as one leading comment: each package, its version and license, and
 * its license file's text (an MIT notice must travel with the code).
 */
function licenseBanner(mods) {
  const pkgs = new Map();
  for (const { id } of mods) {
    const m = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(id);
    if (!m || pkgs.has(m[2])) continue;
    const dir = join(repo, m[1]);
    const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const file = readdirSync(dir).find((f) => /^licen[cs]e(\.md|\.txt)?$/i.test(f));
    pkgs.set(m[2], { version: meta.version, license: meta.license ?? "", text: file ? readFileSync(join(dir, file), "utf8").trim() : "" });
  }
  const names = [...pkgs.keys()].sort();
  const body = [
    "@openmarkdown-dev/editor browser build (MIT). It bundles:",
    ...names.map((n) => `  ${n}@${pkgs.get(n).version} (${pkgs.get(n).license})`),
    "",
    ...names.flatMap((n) => (pkgs.get(n).text ? [`--- ${n} ---`, pkgs.get(n).text, ""] : [])),
  ].join("\n");
  return `/*!\n${body.replace(/\*\//g, "* /")}\n*/\n`;
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
        // One shared chunk, named, plus the listed loader chunks: any other
        // chunk would collide with the shared one here and fail the build
        // instead of slipping an unlisted file into the package.
        output: {
          // Rollup groups modules by the entries that import them (and by
          // what loads lazily): the editor (all three), the Temml loader (two
          // of three), the diagram drawing (on demand). Each named chunk
          // holds exactly its listed modules.
          chunkFileNames: (chunk) => {
            const ids = chunk.moduleIds.map((id) => relative(repo, id)).sort();
            const same = (mods) => mods.length === ids.length && [...mods].sort().every((m, i) => m === ids[i]);
            const hit = Object.entries(NAMED_CHUNKS).find(([, mods]) => same(mods));
            return hit ? hit[0] : SHARED_CHUNK;
          },
        },
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

  const browserModules = {};
  for (const [file, entry] of Object.entries(BROWSER_BUILDS)) {
    await build({
      configFile: false,
      root: pkgDir,
      logLevel: quiet ? "error" : "info",
      mode: "production",
      resolve: { alias: { "@": join(repo, "src") } },
      build: {
        outDir: dist,
        emptyOutDir: false,
        target: "es2022",
        minify: true,
        sourcemap: false,
        copyPublicDir: false,
        reportCompressedSize: false,
        lib: { entry: { [file.replace(/\.js$/, "")]: ENTRIES[entry] }, formats: ["es"], fileName: () => file },
        rollupOptions: {
          // Nothing external, nothing split: one file.
          output: { inlineDynamicImports: true },
          plugins: [
            {
              name: "openmd-browser-manifest",
              generateBundle(_opts, bundle) {
                for (const chunk of Object.values(bundle)) {
                  if (chunk.type !== "chunk") continue;
                  for (const [id, m] of Object.entries(chunk.modules)) {
                    if (m.renderedLength === 0) continue;
                    (browserModules[chunk.fileName] ??= []).push({ id: id.startsWith("\0") ? id : relative(repo, id), bytes: m.renderedLength });
                  }
                }
              },
            },
          ],
        },
      },
    });
  }
  writeFileSync(join(meta, "browser-modules.json"), JSON.stringify(browserModules, null, 2) + "\n");
  // Vite leaves an ES library's whitespace in place; a browser build is
  // shipped as is, so it is minified here — and, since it carries other
  // people's code, it opens with their license notices.
  for (const file of Object.keys(BROWSER_BUILDS)) {
    const path = join(dist, file);
    const { code } = await transformWithEsbuild(readFileSync(path, "utf8"), path, { minify: true, format: "esm", target: "es2022", legalComments: "none" });
    writeFileSync(path, licenseBanner(browserModules[file] ?? []) + code);
  }

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
