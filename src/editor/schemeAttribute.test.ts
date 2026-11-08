import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEditorState } from ".";
import { configureEditorEnvironment, type ColorScheme } from "./environment";
import { ROOT_PAINT_SELECTOR, SCHEME_ATTRIBUTE, schemeAttribute, schemeAttributes } from "./tokens";

/**
 * The root's scheme attribute (spec: editor-host / 根元素带稳定的明暗属性; change:
 * editor-integration-fixes, design D1) and the root paint (底色与前景色 token 涂
 * 编辑器根). Pure: the attribute is read off the `editorAttributes` facet — the
 * value CodeMirror writes onto `view.dom` — since node has no DOM. The
 * consumer smoke (`scripts/check-editor-consumer.mjs`) checks the real root in
 * real browsers, and applies the theming guide's selectors to it.
 */

/** The root attributes a state asks for (static records only; ours is one). */
const rootAttrs = (state: EditorState): Record<string, string> =>
  Object.assign({}, ...state.facet(EditorView.editorAttributes).filter((a) => typeof a !== "function"));

const env = (scheme: ColorScheme) =>
  configureEditorEnvironment({ colorScheme: { current: () => scheme, subscribe: () => () => {} } });

afterEach(() => env("light"));

describe("data-ome-scheme", () => {
  it("is light or dark", () => {
    expect(schemeAttributes(false)).toEqual({ [SCHEME_ATTRIBUTE]: "light" });
    expect(schemeAttributes(true)).toEqual({ [SCHEME_ATTRIBUTE]: "dark" });
  });

  it("follows the darkTheme facet as it is reconfigured", () => {
    const dark = new Compartment();
    let state = EditorState.create({ extensions: [schemeAttribute, dark.of(EditorView.darkTheme.of(false))] });
    expect(rootAttrs(state)[SCHEME_ATTRIBUTE]).toBe("light");
    state = state.update({ effects: dark.reconfigure(EditorView.darkTheme.of(true)) }).state;
    expect(rootAttrs(state)[SCHEME_ATTRIBUTE]).toBe("dark");
    state = state.update({ effects: dark.reconfigure(EditorView.darkTheme.of(false)) }).state;
    expect(rootAttrs(state)[SCHEME_ATTRIBUTE]).toBe("light");
  });

  it("an editor state carries the environment's scheme", () => {
    env("dark");
    expect(rootAttrs(createEditorState({ doc: "x" }))[SCHEME_ATTRIBUTE]).toBe("dark");
    env("light");
    expect(rootAttrs(createEditorState({ doc: "x" }))[SCHEME_ATTRIBUTE]).toBe("light");
  });
});

describe("root paint", () => {
  it("is the outermost root, at zero specificity", () => {
    expect(ROOT_PAINT_SELECTOR.startsWith(":where(&")).toBe(true);
    expect(ROOT_PAINT_SELECTOR).toContain(":not(.cm-editor .cm-editor)");
  });
});

describe("the theming guide", () => {
  // The app repo keeps the package's docs in packages/editor/docs/; the exported
  // public repo (where this test also runs, scripts/export-editor.mjs) at docs/.
  const root = join(__dirname, "../..");
  const at = ["packages/editor/docs/guides/theming.md", "docs/guides/theming.md"].map((p) => join(root, p)).find((p) => existsSync(p));
  if (!at) throw new Error("theming guide not found (packages/editor/docs/guides/ or docs/guides/)");
  const guide = readFileSync(at, "utf8");

  it("keys light and dark on data-ome-scheme, never on a class CodeMirror does not add", () => {
    expect(guide).not.toMatch(/cm-light|cm-dark/);
    expect(guide).toContain(`.cm-editor[${SCHEME_ATTRIBUTE}="light"]`);
    expect(guide).toContain(`.cm-editor[${SCHEME_ATTRIBUTE}="dark"]`);
  });
});
