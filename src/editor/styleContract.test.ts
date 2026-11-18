import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEditorState } from ".";
import { nestedEditorBase } from "./blocks/nested";
import { AUTO_HEIGHT_CLASS, EDITOR_CLASSES, EDITOR_TOKENS, SCHEME_ATTRIBUTE } from "./tokens";

/**
 * Gate (spec: editor-host / 宿主选择器只有两个稳定的类, 编辑器可随内容长高;
 * change: editor-style-contract, design D1 / D4). The editor's public styling
 * hooks are EDITOR_CLASSES (tokens.ts), one definition:
 *
 *   - every state `createEditorState` builds puts `.ome-root` on its root and
 *     never `.ome-nested`; every nested editor (`nestedEditorBase()`, what a
 *     table cell or a property value is edited in) puts `.ome-nested` and
 *     NEVER `.ome-root` — so a host rule on `.ome-root` cannot land in a cell;
 *   - `height: "auto"` adds the auto-height class to the root, the default
 *     does not;
 *   - the theming guide and the README name exactly these hooks, and no CSS
 *     they show a host selects `.cm-editor` (which every nested editor is too).
 *
 * Read off the `editorAttributes` facet — what CodeMirror writes onto
 * `view.dom` — since node has no DOM. The consumer smoke
 * (`scripts/check-editor-consumer.mjs`) checks the real DOM in three browsers.
 */

const classesOf = (state: EditorState): string[] =>
  state
    .facet(EditorView.editorAttributes)
    .filter((a) => typeof a !== "function")
    .flatMap((a) => (a.class ?? "").split(/\s+/))
    .filter(Boolean);

describe("the public classes", () => {
  it("a created state's root is .ome-root, never .ome-nested", () => {
    const c = classesOf(createEditorState({ doc: "x" }));
    expect(c).toContain(EDITOR_CLASSES.root);
    expect(c).not.toContain(EDITOR_CLASSES.nested);
  });

  it("a nested editor's root is .ome-nested, never .ome-root", () => {
    const c = classesOf(EditorState.create({ doc: "cell", extensions: [nestedEditorBase()] }));
    expect(c).toContain(EDITOR_CLASSES.nested);
    expect(c).not.toContain(EDITOR_CLASSES.root);
  });

  it("are in the editor's public namespace and distinct", () => {
    expect(EDITOR_CLASSES.root).toMatch(/^ome-/);
    expect(EDITOR_CLASSES.nested).toMatch(/^ome-/);
    expect(EDITOR_CLASSES.root).not.toBe(EDITOR_CLASSES.nested);
  });
});

describe("height", () => {
  it('"auto" marks the root; the default and "fill" do not', () => {
    expect(classesOf(createEditorState({ doc: "x", height: "auto" }))).toContain(AUTO_HEIGHT_CLASS);
    expect(classesOf(createEditorState({ doc: "x" }))).not.toContain(AUTO_HEIGHT_CLASS);
    expect(classesOf(createEditorState({ doc: "x", height: "fill" }))).not.toContain(AUTO_HEIGHT_CLASS);
  });
});

describe("the docs", () => {
  // The app repo keeps the package's docs in packages/editor/; the exported
  // public repo (where this test also runs) at its root.
  const root = join(__dirname, "../..");
  const read = (...candidates: string[]) => {
    const at = candidates.map((p) => join(root, p)).find((p) => existsSync(p));
    if (!at) throw new Error(`not found: ${candidates.join(" / ")}`);
    return readFileSync(at, "utf8");
  };
  const guide = read("packages/editor/docs/guides/theming.md", "docs/guides/theming.md");
  const readme = read("packages/editor/README.md", "README.md");
  const cssBlocks = (md: string) => [...md.matchAll(/```css\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");

  for (const [name, text] of [["theming guide", guide], ["README", readme]] as const) {
    it(`the ${name} tells hosts to target .ome-root, and no CSS it shows selects .cm-editor`, () => {
      expect(text).toContain(`.${EDITOR_CLASSES.root}`);
      expect(cssBlocks(text)).not.toMatch(/\.cm-editor/);
    });
  }

  it("the theming guide names both classes, the scheme attribute and the height option", () => {
    expect(guide).toContain(`.${EDITOR_CLASSES.nested}`);
    expect(guide).toContain(SCHEME_ATTRIBUTE);
    expect(guide).toContain('height: "auto"');
  });

  it("the theming guide's fit-the-host recipe sets only real tokens", () => {
    const section = guide.split(/^## /m).find((s) => s.startsWith("Fit the host page")) ?? "";
    const set = [...cssBlocks(section).matchAll(/(--ome-[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(set.length).toBeGreaterThan(5);
    const tokens = Object.keys(EDITOR_TOKENS).map((t) => `--ome-${t}`);
    for (const t of set) expect(tokens, t).toContain(t);
  });
});
