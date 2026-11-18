import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { treeUpTo } from "./syntax";
import { createEditorState as createFull } from ".";
import { createEditorState as createDiagramFree } from "./noDiagrams";
import { createEditorState as createBare, reconfigure } from "./base";
import { configureEditorEnvironment, type DiagramRenderer, type MathRenderer } from "./environment";
import { mathReadyEffect, mathState, renderFormula } from "./math";
import { diagramDrawerOf, requestMermaid, shownMermaid } from "./mermaid";
import { asyncRenderDone, attemptRender } from "./blocks/render";
import { loadHtml, markdownSupport } from "./markdownSupport";
import { loadWithoutWarning } from "@/lib/log";
import { TEMML_QUIRKS_WARNING } from "./mathImport";

/**
 * Formulas and diagrams through replaceable renderers (change: editor-lean-deps;
 * spec: live-preview-editor / 公式与图表经可替换的渲染器, editor-package /
 * 入口与内置渲染器): which renderer a state draws with, the host's output going
 * through the same sanitiser, a new renderer redrawing, and the language
 * support that keeps HTML and code grammars out of the first load.
 */

const mathml: MathRenderer = (tex, display) => `<math${display ? ' display="block"' : ""}><mi>${tex}</mi></math>`;

afterEach(() => configureEditorEnvironment({}));

describe("which formula renderer a state draws with", () => {
  it("the host's renderMath, in every entry, through the MathML sanitiser", () => {
    for (const create of [createFull, createDiagramFree, createBare]) {
      const s = create({ doc: "$x$", environment: { renderMath: mathml } });
      expect(mathState(s)).toBe("ready");
      expect(renderFormula(s, "x", false)).toBe("<math><mi>x</mi></math>");
    }
  });

  it("a host renderer's non-MathML output is refused: the source with the failure mark", () => {
    const s = createBare({ environment: { renderMath: () => '<div class="katex"><math><mi>x</mi></math></div>' } });
    expect(attemptRender(() => renderFormula(s, "x", false)).kind).toBe("failed");
  });

  it("with no host renderer: the built-in one where the entry has it (pending until loaded), the source where it has none", () => {
    expect(mathState(createFull({}))).toBe("loading");
    expect(mathState(createDiagramFree({}))).toBe("loading");
    expect(mathState(createBare({}))).toBe("failed");
    expect(renderFormula(createBare({}), "x", false)).toBeNull();
  });

  it("the page's default (configureEditorEnvironment) applies to every editor that gives none", () => {
    configureEditorEnvironment({ renderMath: mathml });
    expect(renderFormula(createBare({}), "y", true)).toBe('<math display="block"><mi>y</mi></math>');
  });
});

describe("which diagram renderer a state draws with", () => {
  it("the host's renderDiagram in every entry; the built-in Mermaid only in the full one; none otherwise", () => {
    const renderDiagram: DiagramRenderer = () => "<svg></svg>";
    expect(diagramDrawerOf(createBare({ environment: { renderDiagram } }))?.id).toMatch(/^host-/);
    // The same renderer, the same drawer (one cache).
    expect(diagramDrawerOf(createBare({ environment: { renderDiagram } }))).toBe(diagramDrawerOf(createDiagramFree({ environment: { renderDiagram } })));
    expect(diagramDrawerOf(createFull({}))?.id).toBe("");
    expect(diagramDrawerOf(createDiagramFree({}))).toBeNull();
    expect(diagramDrawerOf(createBare({}))).toBeNull();
  });

  it("a host's SVG is drawn through the diagram sanitiser; HTML labels are refused", async () => {
    // As a host's Mermaid writes it: its own root id, a style and a gradient scoped by it.
    const svg =
      '<svg id="mermaid-7" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>#mermaid-7 rect{fill:#eee;}</style>' +
      '<defs><linearGradient id="mermaid-7-g"/></defs><rect width="10" height="10" fill="url(#mermaid-7-g)"/></svg>';
    const html = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>';
    const renderDiagram: DiagramRenderer = async (source) => (source.includes("html") ? html : svg);
    const drawer = diagramDrawerOf(createBare({ environment: { renderDiagram } }))!;
    for (const body of ["graph TD\n  ok", "graph TD\n  html"]) {
      await new Promise<void>((done) => requestMermaid(body, "light", drawer, done, () => true));
    }
    const ok = shownMermaid("graph TD\n  ok", "light", drawer.id);
    expect(ok).toMatchObject({ kind: "rendered" });
    // The diagram is renamed into the editor's id scheme, references and all.
    const drawn = (ok as { value: string }).value;
    expect(drawn).not.toContain("mermaid-7");
    expect(drawn).toMatch(/<svg id="om-mermaid-\d+"/);
    expect(drawn).toMatch(/url\(#om-mermaid-\d+-g\)/);
    // An SVG with no id gets one.
    const bare = diagramDrawerOf(createBare({ environment: { renderDiagram: () => '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' } }))!;
    await new Promise<void>((done) => requestMermaid("graph TD\n  bare", "dark", bare, done, () => true));
    expect(shownMermaid("graph TD\n  bare", "dark", bare.id)).toMatchObject({ kind: "rendered" });
    expect(shownMermaid("graph TD\n  html", "light", drawer.id)).toMatchObject({ kind: "failed" });
    // Not the built-in Mermaid's cache.
    expect(shownMermaid("graph TD\n  ok", "light")).toBeUndefined();
  });
});

describe("a host's flowchart with arrowheads (markers named <root id>_…)", () => {
  it("draws through renderDiagram, its markers renamed with the root", async () => {
    const svg =
      '<svg id="d" xmlns="http://www.w3.org/2000/svg"><defs><marker id="d_end"><path d="M0 0L1 1"/></marker></defs>' +
      '<path d="M0 0" marker-end="url(#d_end)"/></svg>';
    const drawer = diagramDrawerOf(createBare({ environment: { renderDiagram: async () => svg } }))!;
    await new Promise<void>((done) => requestMermaid("graph LR\n  a --> b", "light", drawer, done, () => true));
    const shown = shownMermaid("graph LR\n  a --> b", "light", drawer.id);
    expect(shown).toMatchObject({ kind: "rendered" });
    expect((shown as { value: string }).value).toMatch(/marker-end="url\(#om-mermaid-\d+_end\)"/);
  });
});

describe("a new environment redraws formulas and diagrams", () => {
  it("reconfigure with an environment carries the redraw effects", () => {
    const s = createBare({});
    const { effects } = reconfigure(s, { environment: { renderMath: mathml } });
    expect(effects.some((e) => e.is(mathReadyEffect))).toBe(true);
    expect(effects.some((e) => e.is(asyncRenderDone))).toBe(true);
    const next = s.update({ effects }).state;
    expect(renderFormula(next, "z", false)).toBe("<math><mi>z</mi></math>");
  });
});

describe("the Markdown language support (markdownSupport)", () => {
  const tree = (s: EditorState) => treeUpTo(s, s.doc.length);

  it("fenced code is plain without codeLanguages, and nested in the language given", () => {
    const doc = "```shout\nhello\n```\n";
    const shout = StreamLanguage.define({ name: "shout", token: (stream) => (stream.skipToEnd(), "keyword") });
    const desc = LanguageDescription.of({ name: "shout", support: new LanguageSupport(shout) });
    const plain = EditorState.create({ doc, extensions: markdownSupport() });
    const nested = EditorState.create({ doc, extensions: markdownSupport([desc]) });
    expect(tree(plain).resolveInner(doc.indexOf("hello") + 1).name).toBe("CodeText");
    expect(tree(nested).resolveInner(doc.indexOf("hello") + 1).name).not.toBe("CodeText");
  });

  it("HTML is parsed as HTML once lang-html has loaded", async () => {
    const doc = "<div class=\"x\">hi</div>\n";
    await loadHtml();
    const s = EditorState.create({ doc, extensions: markdownSupport() });
    // The nested HTML tree is mounted inside the HTMLBlock: resolveInner enters it.
    expect(tree(s).resolveInner(doc.indexOf("div") + 1, 1).name).toBe("TagName");
    expect(tree(s).resolveInner(doc.indexOf("class") + 1, 1).name).toBe("AttributeName");
  });
});

describe("the built-in converter's load stays quiet about quirks mode", () => {
  it("drops exactly Temml's quirks-mode notice, passes every other warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await loadWithoutWarning(TEMML_QUIRKS_WARNING, async () => {
        console.warn(TEMML_QUIRKS_WARNING);
        console.warn("something else");
      });
      expect(warn.mock.calls).toEqual([["something else"]]);
      // Restored after the load.
      console.warn(TEMML_QUIRKS_WARNING);
      expect(warn.mock.calls.at(-1)).toEqual([TEMML_QUIRKS_WARNING]);
    } finally {
      warn.mockRestore();
    }
  });

  it("the notice matches Temml's own text", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "../../node_modules/temml/dist/temml.mjs"), "utf8").replace(/"\s*\+\s*"/g, "");
    expect(src).toContain(TEMML_QUIRKS_WARNING);
  });
});
