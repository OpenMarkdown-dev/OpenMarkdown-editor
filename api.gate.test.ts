import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs build script, no declarations
import { API_SNAPSHOTS, rollTypes } from "./build.mjs";

/**
 * Gate (spec: editor-package / 公共 API 面有快照, 无图表的入口). The package's
 * public surface is exactly `api/editor.api.d.ts` (the main entry,
 * `src/index.ts`) and `api/editor-no-diagrams.api.d.ts` (the diagram-free one,
 * `src/no-diagrams.ts`): the declarations the build rolls from each entry,
 * compared byte for byte. The two entries export the same names. Adding, removing or reshaping an
 * export — including a field of an exported interface reached through
 * `src/editor/**` — fails here until the snapshot is regenerated on purpose:
 *
 *     npm run build:editor -- --update-api
 *
 * and the diff of `api/editor.api.d.ts` is reviewed with the change.
 */
const snapshotPath = join(__dirname, "api/editor.api.d.ts");
const snapshots = Object.entries(API_SNAPSHOTS as Record<string, string>);

describe.each(snapshots)("editor package API surface (%s entry)", (name, snapshot) => {
  it("matches the committed snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openmd-editor-api-"));
    try {
      const out = join(dir, `${name}.d.ts`);
      await rollTypes(out, name);
      const now = readFileSync(out, "utf8");
      const committed = readFileSync(join(__dirname, snapshot), "utf8");
      expect(
        now === committed,
        `the public API of @openmarkdown-dev/editor changed. If on purpose: \`npm run build:editor -- --update-api\` and review the diff of packages/editor/${snapshot}`,
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("says nothing internal (spec: editor-package / 公共 API 面有快照)", () => {
    // The declarations are the package's reference docs: no notes that point
    // into this repository (spec / gate / change names, source paths) and no
    // Chinese working notes. Keep such notes in `//` comments, which the build
    // drops.
    const committed = readFileSync(join(__dirname, snapshot), "utf8");
    const internal = committed
      .split("\n")
      .filter((line) => /[\u4e00-\u9fff]|\b(spec|gate|change|design) ?[:D]|\bsrc\/|\blib\/|\.test\.ts|openspec/.test(line));
    expect(internal, "internal notes in the published declarations").toEqual([]);
  });

  it("exports exactly the public names", () => {
    const committed = readFileSync(join(__dirname, snapshot), "utf8");
    const values = /^export \{ ([^}]*) \};$/m.exec(committed)?.[1].split(", ") ?? [];
    const types = /^export type \{ ([^}]*) \};$/m.exec(committed)?.[1].split(", ") ?? [];
    expect(values).toEqual(["InvalidUtf8Error", "configureEditorEnvironment", "createEditorState", "mountEditor", "openMarkdownFile", "saveMarkdownFile"]);
    expect(types).toEqual([
      "ColorScheme",
      "EditorEnvironment",
      "EditorHost",
      "EditorLang",
      "EditorMode",
      "EditorStateOptions",
      "LineEnding",
      "MarkdownEditor",
      "MarkdownFile",
      "OutlineItem",
      "SpellMiss",
      "SpellService",
    ]);
  });

  it("every exported name carries TSDoc", () => {
    const committed = readFileSync(join(__dirname, snapshot), "utf8");
    const declared = [...committed.matchAll(/^(?:declare function|interface|type) (\w+)/gm)].map((m) => m[1]);
    const exported = new Set(
      [...committed.matchAll(/^export (?:type )?\{ ([^}]*) \};$/gm)].flatMap((m) => m[1].split(", ")),
    );
    const undocumented = declared.filter((name) => {
      if (!exported.has(name)) return false;
      const at = committed.search(new RegExp(`^(?:declare function|interface|type) ${name}\\b`, "m"));
      return !/\*\/\s*$/.test(committed.slice(0, at));
    });
    expect(undocumented, `public declarations without a TSDoc comment: ${undocumented.join(", ")}`).toEqual([]);
  });
});

describe("the diagram-free entry", () => {
  it("is the main entry's surface with only createEditorState's doc comment different", () => {
    const strip = (t: string) =>
      t
        .replace(/\/\*\*(?:(?!\*\/)[\s\S])*?\*\/\s*declare function createEditorState/g, "declare function createEditorState")
        .split("\n")
        .filter((l) => l.trim())
        .sort()
        .join("\n");
    const full = readFileSync(snapshotPath, "utf8");
    const free = readFileSync(join(__dirname, API_SNAPSHOTS["no-diagrams"]), "utf8");
    expect(strip(free)).toBe(strip(full));
  });
});
