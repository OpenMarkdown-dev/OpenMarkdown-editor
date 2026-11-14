import { beforeEach, describe, expect, it } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { blockDecorationField, blockRanges } from "./blocks/field";
import { isRevealed } from "./blocks/reveal";
import { MermaidRequests, drawnMermaidBodies } from "./blocks/mermaid";
import { attemptRenderAsync } from "./blocks/render";
import { dialectBase, dialectExtensions } from "./dialectParser";
import {
  CACHE_LIMIT,
  cachedMermaid,
  diagramRendering,
  mermaidConfig,
  mermaidFence,
  mermaidLoader,
  mermaidReason,
  type MermaidModule,
  rememberMermaid,
  renderWith,
  measureMermaidStep,
  MERMAID_MEASURES,
  requestMermaid,
  shownMermaid,
} from "./mermaid";
import { mermaidMarkup } from "./markup";
import { createEditorState } from ".";
import { createEditorState as createDiagramFreeState } from "./base";
import { importMermaid } from "./mermaidImport";
import { livePreviewConfig } from "./previewConfig";
import { PendingWidget } from "./blocks/pending";
import { SelectableWidget } from "./selectionPaint";
import { MermaidWidget } from "./widgets";
import { progressiveTree, withCompleteTree } from "./syntax";

function state(doc: string, opts: { reveal?: boolean; dark?: boolean; anchor?: number } = {}, extra: Extension = []) {
  return withCompleteTree(
    EditorState.create({
      doc,
      selection: { anchor: opts.anchor ?? doc.length },
      extensions: [
        markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }),
        livePreviewConfig.of({ revealOnSelection: opts.reveal ?? true, resolveImage: (s: string) => s }),
        EditorView.darkTheme.of(opts.dark ?? false),
        blockDecorationField,
        extra,
      ],
    }),
  );
}

/** Every fence the tree has, as mermaidFence sees it. */
function fences(doc: string) {
  const s = state(doc);
  const out: ({ from: number; to: number; body: string } | null)[] = [];
  progressiveTree(s).iterate({
    enter: (n) => {
      if (n.name === "FencedCode") out.push(mermaidFence(s, n));
    },
  });
  return out;
}

/** Ids of the blocks the field rendered, and the failure marks it laid. */
function rendered(s: EditorState) {
  const failed: [number, number][] = [];
  s.field(blockDecorationField).failed.between(0, s.doc.length, (f, t) => {
    failed.push([f, t]);
  });
  return { blocks: blockRanges(s).map((b) => `${b.id}:${b.mode}`), failed };
}

/** A minimal diagram that passes the sanitiser, tagged so tests can tell them apart. */
const svg = (tag: string) => mermaidMarkup(`<svg id="om-mermaid-0"><text>${tag}</text></svg>`);

describe("mermaidFence — which fences are diagrams", () => {
  it("a closed top-level ```mermaid fence, line-aligned, with its body", () => {
    const doc = "para\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
    const [f] = fences(doc);
    expect(f).toEqual({ from: 6, to: doc.length - 1, body: "flowchart LR\n  A --> B" });
  });

  it("tilde fences and info-string attributes count", () => {
    expect(fences("~~~mermaid\ngraph TD\n~~~\n")[0]?.body).toBe("graph TD");
    expect(fences("```mermaid title\ngraph TD\n```\n")[0]?.body).toBe("graph TD");
  });

  it("other info strings, unclosed, empty, or nested in a container stay code blocks", () => {
    expect(fences("```Mermaid\ngraph TD\n```\n")).toEqual([null]);
    expect(fences("```js\ngraph TD\n```\n")).toEqual([null]);
    expect(fences("```mermaid\ngraph TD\n")).toEqual([null]);
    expect(fences("```mermaid\n\n```\n")).toEqual([null]);
    expect(fences("> ```mermaid\n> graph TD\n> ```\n")).toEqual([null]);
    expect(fences("- item\n\n  ```mermaid\n  graph TD\n  ```\n")).toEqual([null]);
  });
});

describe("render cache", () => {
  it("keys by source and scheme", () => {
    rememberMermaid("graph cache-a", "light", { kind: "rendered", value: svg("L") });
    expect(cachedMermaid("graph cache-a", "light")).toEqual({ kind: "rendered", value: svg("L") });
    expect(cachedMermaid("graph cache-a", "dark")).toBeUndefined();
  });

  it("after a theme switch, shows the other scheme's render until its own arrives (no flash to source)", () => {
    rememberMermaid("graph cache-b", "light", { kind: "rendered", value: svg("L") });
    expect(shownMermaid("graph cache-b", "dark")).toEqual({ kind: "rendered", value: svg("L") });
    rememberMermaid("graph cache-b", "dark", { kind: "rendered", value: svg("D") });
    expect(shownMermaid("graph cache-b", "dark")).toEqual({ kind: "rendered", value: svg("D") });
  });

  it("a failure is not borrowed across schemes", () => {
    rememberMermaid("graph cache-c", "light", { kind: "failed", reason: "x" });
    expect(shownMermaid("graph cache-c", "dark")).toBeUndefined();
  });

  it("keeps at most CACHE_LIMIT results, dropping the oldest", () => {
    for (let i = 0; i <= CACHE_LIMIT; i++) rememberMermaid(`graph lru-${i}`, "light", { kind: "source" });
    expect(cachedMermaid("graph lru-0", "light")).toBeUndefined();
    expect(cachedMermaid(`graph lru-${CACHE_LIMIT}`, "light")).toBeDefined();
  });
});

describe("the block field draws what the cache says (spec: block-editing)", () => {
  const body = "flowchart LR\n  field --> test";
  const doc = `para\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\nend\n`;

  it("no loader and nothing cached (a test state) → no render can come: source, unmarked", () => {
    expect(rendered(state(doc.replace("field", "pending")))).toEqual({ blocks: [], failed: [] });
  });

  it("nothing yet, a loader there → the one placeholder over the fence (change: render-placeholder-size)", () => {
    const s = state(doc.replace("field", "waiting"), {}, mermaidLoader.of(() => new Promise<never>(() => {})));
    expect(rendered(s).blocks).toEqual(["mermaid:A"]);
    let inner: unknown;
    s.field(blockDecorationField).blocks.between(0, s.doc.length, (_f, _t, d) => {
      inner = (d.spec.widget as SelectableWidget).inner;
    });
    expect(inner).toBeInstanceOf(PendingWidget);
    expect((inner as PendingWidget).reserved).toEqual({ origin: "minimum", minHeight: "6em" });
    // Seeded: the diagram itself.
    rememberMermaid(body, "light", { kind: "rendered", value: svg("seeded") });
    const seeded = state(doc, {}, mermaidLoader.of(() => new Promise<never>(() => {})));
    seeded.field(blockDecorationField).blocks.between(0, seeded.doc.length, (_f, _t, d) => {
      inner = (d.spec.widget as SelectableWidget).inner;
    });
    expect(inner).toBeInstanceOf(MermaidWidget);
  });

  it("rendered → one A block named mermaid; the caret inside reveals it", () => {
    rememberMermaid(body, "light", { kind: "rendered", value: svg("") });
    expect(rendered(state(doc)).blocks).toEqual(["mermaid:A"]);
    expect(rendered(state(doc, { anchor: doc.indexOf("field") })).blocks).toEqual([]);
    // Reading mode: never revealed.
    expect(rendered(state(doc, { reveal: false, anchor: doc.indexOf("field") })).blocks).toEqual(["mermaid:A"]);
  });

  it("diagrams off (`diagrams: false`) → no fence is a diagram, a cached render is not drawn: a plain code block", () => {
    rememberMermaid(body, "light", { kind: "rendered", value: svg("") });
    const off = state(doc, {}, diagramRendering.of(false));
    expect(rendered(off).blocks).toEqual([]);
    const seen: unknown[] = [];
    progressiveTree(off).iterate({ enter: (n) => void (n.name === "FencedCode" && seen.push(mermaidFence(off, n))) });
    expect(seen).toEqual([null]);
    // The public option reaches the facet; unset is on.
    expect(createEditorState({ doc, diagrams: false }).facet(diagramRendering)).toBe(false);
    expect(createEditorState({ doc }).facet(diagramRendering)).toBe(true);
    expect(rendered(state(doc, {}, diagramRendering.of(true))).blocks).toEqual(["mermaid:A"]);
  });

  it("the diagram-free entry (`./base`, `@openmarkdown-dev/editor/no-diagrams`) has no loader and never renders, whatever `diagrams` says", () => {
    rememberMermaid(body, "light", { kind: "rendered", value: svg("") });
    for (const opts of [{ doc }, { doc, diagrams: true }]) {
      const s = createDiagramFreeState(opts);
      expect(s.facet(diagramRendering)).toBe(false);
      expect(s.facet(mermaidLoader)).toBeNull();
    }
    // The full entry installs the one loader.
    expect(createEditorState({ doc }).facet(mermaidLoader)).toBe(importMermaid);
  });

  it("failed → the source with the one failure mark over the whole fence", () => {
    const bad = "flowchart LR\n  broken -->> ";
    const d = `para\n\n\`\`\`mermaid\n${bad}\n\`\`\`\n`;
    rememberMermaid(bad, "light", { kind: "failed", reason: "Parse error on line 2: got 'EOF'" });
    const from = d.indexOf("```");
    expect(rendered(state(d))).toEqual({ blocks: [], failed: [[from, d.length - 1]] });
  });

  it("follows the editor's scheme (the environment's colorScheme, via the dark-theme facet)", () => {
    const b = "flowchart LR\n  scheme --> follows";
    const d = `\`\`\`mermaid\n${b}\n\`\`\`\n\nend\n`;
    rememberMermaid(b, "dark", { kind: "rendered", value: svg("dark") });
    rememberMermaid(b, "light", { kind: "failed", reason: "only light fails" });
    expect(rendered(state(d, { dark: true })).blocks).toEqual(["mermaid:A"]);
    expect(rendered(state(d, { dark: false })).failed).toHaveLength(1);
  });
});

describe("renderWith — mermaid's global config is borrowed, never kept", () => {
  it("times its steps as performance measures (change: mermaid-large-diagrams, D1)", async () => {
    performance.clearMeasures();
    await renderWith(fake().mod, "graph TD", "light");
    const names = performance.getEntriesByType("measure").map((m) => m.name);
    expect(names).toEqual(["om-mermaid:render", "om-mermaid:sanitize"]);
    // The insert step is `MermaidWidget.toDOM`'s (DOM, not in node): same helper.
    measureMermaidStep("insert", performance.now());
    expect(performance.getEntriesByType("measure").map((m) => m.name)).toEqual([...MERMAID_MEASURES]);
  });

  function fake(fail?: string) {
    let site: Record<string, unknown> = { theme: "forest", securityLevel: "loose" };
    const seen: Record<string, unknown>[] = [];
    const mod: MermaidModule = {
      initialize: (c) => {
        site = { ...c };
      },
      mermaidAPI: {
        getSiteConfig: () => ({ ...site }),
        render: async () => {
          seen.push({ ...site });
          if (fail) throw new Error(fail);
          return { svg: '<svg id="om-mermaid-1"/>' };
        },
      },
    };
    return { mod, seen, site: () => site };
  }

  it("renders strict with our theme, then restores the host's config", async () => {
    const f = fake();
    await expect(renderWith(f.mod, "graph TD", "dark")).resolves.toBe('<svg id="om-mermaid-1"/>');
    expect(f.seen[0]).toMatchObject({ securityLevel: "strict", theme: "dark", suppressErrorRendering: true, startOnLoad: false });
    expect(f.site()).toEqual({ theme: "forest", securityLevel: "loose" });
  });

  it("restores on failure too, and the failure reaches attemptRenderAsync as `failed`", async () => {
    const f = fake("Parse error on line 2:\n...A --> \n-----^\nExpecting 'NODE', got 'EOF'");
    const out = await attemptRenderAsync(() => renderWith(f.mod, "graph TD\nA -->", "light"));
    expect(out).toEqual({ kind: "failed", reason: "Parse error on line 2: Expecting 'NODE', got 'EOF'" });
    expect(f.site()).toEqual({ theme: "forest", securityLevel: "loose" });
  });

  it("light uses mermaid's default theme", () => {
    expect(mermaidConfig("light").theme).toBe("default");
  });
});

describe("mermaidReason", () => {
  it("keeps where and what of a multi-line parse error", () => {
    expect(mermaidReason(new Error("Parse error on line 3:\nx\n--^\nExpecting 'A', got 'B'"))).toBe(
      "Parse error on line 3: Expecting 'A', got 'B'",
    );
  });
  it("passes one-line errors through", () => {
    expect(mermaidReason(new Error("No diagram type detected"))).toBe("No diagram type detected");
    expect(mermaidReason("bad")).toBe("bad");
  });
});

describe("attemptRenderAsync — the async sibling of attemptRender", () => {
  it("rendered / source / failed, never rejecting", async () => {
    await expect(attemptRenderAsync(async () => "<svg/>")).resolves.toEqual({ kind: "rendered", value: "<svg/>" });
    await expect(attemptRenderAsync(async () => null)).resolves.toEqual({ kind: "source" });
    await expect(
      attemptRenderAsync(() => {
        throw new Error("sync throw\nmore");
      }),
    ).resolves.toEqual({ kind: "failed", reason: "sync throw" });
    await expect(attemptRenderAsync(() => Promise.reject(new Error("later")))).resolves.toEqual({
      kind: "failed",
      reason: "later",
    });
  });
});

// --- Only drawn blocks are rendered; stale sources are dropped (change: mermaid-render-drawn-only) ---

/**
 * One fake Mermaid for the whole file: the module-level loader caches the first
 * module it loads, so every request below shares this one. It records each body
 * it is asked to render.
 */
const renders: string[] = [];
const fakeMermaid: MermaidModule = {
  initialize: () => {},
  mermaidAPI: {
    getSiteConfig: () => ({}),
    render: async (_id, text) => {
      renders.push(text);
      return { svg: '<svg id="om-mermaid-1"/>' };
    },
  },
};
const fakeLoad = async () => fakeMermaid;
/** Let the render queue run dry: every step in it is a microtask. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("isRevealed — the one rule for which A blocks are drawn", () => {
  const d = "para\n\n```mermaid\ngraph TD\n  a --> b\n```\n\nend\n";
  const range = { from: d.indexOf("```"), to: d.indexOf("\n\nend") };

  it("the selection touching the range reveals it; elsewhere it does not", () => {
    expect(isRevealed(state(d, { anchor: d.indexOf("a -->") }), range)).toBe(true);
    expect(isRevealed(state(d, { anchor: d.length }), range)).toBe(false);
  });

  it("revealFrom narrows what the selection must touch; reading mode reveals nothing", () => {
    expect(isRevealed(state(d, { anchor: range.from }), { ...range, revealFrom: range.from + 4 })).toBe(false);
    expect(isRevealed(state(d, { reveal: false, anchor: d.indexOf("a -->") }), range)).toBe(false);
  });
});

describe("drawnMermaidBodies — the driver asks only for drawn diagrams", () => {
  const body = "graph TD\n  drawn --> only";
  const d = `para\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\nend\n`;
  const all = { from: 0, to: d.length };

  it("selection inside the fence → nothing to ask for; outside → its body", () => {
    expect(drawnMermaidBodies(state(d, { anchor: d.indexOf("drawn") }), all)).toEqual([]);
    expect(drawnMermaidBodies(state(d), all)).toEqual([body]);
  });

  it("reading mode draws every diagram, so it asks for every one (design D4)", () => {
    expect(drawnMermaidBodies(state(d, { reveal: false, anchor: d.indexOf("drawn") }), all)).toEqual([body]);
  });

  it("those in view first", () => {
    const two = `\`\`\`mermaid\ngraph TD\n  far --> one\n\`\`\`\n\nx\n\n\`\`\`mermaid\ngraph TD\n  near --> one\n\`\`\`\n\nend\n`;
    const near = two.indexOf("x\n");
    expect(drawnMermaidBodies(state(two), { from: near, to: two.length })).toEqual([
      "graph TD\n  near --> one",
      "graph TD\n  far --> one",
    ]);
  });
});

describe("requestMermaid — a queued render nobody still wants is dropped (design D2)", () => {
  beforeEach(() => {
    renders.length = 0;
  });

  it("three bodies in a row, only the last still wanted → one render, the last", async () => {
    let want = "";
    const bodies = ["graph TD\n  q --> 1", "graph TD\n  q --> 12", "graph TD\n  q --> 123"];
    for (const b of bodies) {
      want = b;
      requestMermaid(b, "light", fakeLoad, () => {}, () => want === b);
    }
    await settle();
    expect(renders).toEqual([bodies[2]]);
    expect(cachedMermaid(bodies[2], "light")?.kind).toBe("rendered");
    expect(cachedMermaid(bodies[0], "light")).toBeUndefined();
    // Dropped is not stuck: asked again (and wanted), it renders.
    requestMermaid(bodies[0], "light", fakeLoad, () => {}, () => true);
    await settle();
    expect(renders).toEqual([bodies[2], bodies[0]]);
  });

  it("any waiter still wanting it is enough (another view of the same document)", async () => {
    const b = "graph TD\n  two --> views";
    requestMermaid(b, "light", fakeLoad, () => {}, () => false);
    requestMermaid(b, "light", fakeLoad, () => {}, () => true);
    await settle();
    expect(renders).toEqual([b]);
  });
});

describe("the driver: typing in a revealed diagram renders nothing (spec: block-editing / 异步渲染的块)", () => {
  beforeEach(() => {
    renders.length = 0;
  });

  const loaded = mermaidLoader.of(fakeLoad);
  const type = (s: EditorState, text: string) => withCompleteTree(s.update({ changes: { from: s.selection.main.head, insert: text }, selection: { anchor: s.selection.main.head + text.length } }).state);
  const del = (s: EditorState, n: number) => withCompleteTree(s.update({ changes: { from: s.selection.main.head - n, to: s.selection.main.head }, selection: { anchor: s.selection.main.head - n } }).state);
  const leave = (s: EditorState) => s.update({ selection: { anchor: s.doc.length } }).state;
  const view = (s: EditorState) => ({ from: 0, to: s.doc.length });

  it("在展开的图里打字不渲染: 5 chars typed inside → 0 renders; leaving → exactly 1, of the final source", async () => {
    const d = "para\n\n```mermaid\ngraph TD\n  type --> here\n```\n\nend\n";
    let s = state(d, { anchor: d.indexOf(" here") + " here".length }, loaded);
    const driver = new MermaidRequests(() => {});
    driver.request(s, view(s));
    for (const ch of "abcde") {
      s = type(s, ch);
      driver.request(s, view(s));
    }
    await settle();
    expect(renders).toEqual([]);
    s = leave(s);
    driver.request(s, view(s));
    await settle();
    expect(renders).toEqual(["graph TD\n  type --> hereabcde"]);
  });

  it("离开前改回原样: typed then deleted inside a cached diagram, leaving → 0 renders", async () => {
    const body = "graph TD\n  back --> again";
    const d = `para\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\nend\n`;
    rememberMermaid(body, "light", { kind: "rendered", value: svg("again") });
    let s = state(d, { anchor: d.indexOf(" again") + " again".length }, loaded);
    const driver = new MermaidRequests(() => {});
    driver.request(s, view(s));
    s = type(s, "xyz");
    driver.request(s, view(s));
    s = del(s, 3);
    driver.request(s, view(s));
    s = leave(s);
    driver.request(s, view(s));
    await settle();
    expect(renders).toEqual([]);
    expect(rendered(s).blocks).toEqual(["mermaid:A"]);
  });

  it("a source edited past while its render was queued is not rendered (not revealed: e.g. an agent's edits)", async () => {
    const d = "```mermaid\ngraph TD\n  agent --> v0\n```\n\nend\n";
    let s = state(d, {}, loaded);
    const driver = new MermaidRequests(() => {});
    driver.request(s, view(s));
    for (const v of ["v1", "v2"]) {
      const at = s.doc.toString().indexOf("v");
      s = withCompleteTree(s.update({ changes: { from: at, to: at + 2, insert: v } }).state);
      driver.request(s, view(s));
    }
    await settle();
    expect(renders).toEqual(["graph TD\n  agent --> v2"]);
  });

  it("a destroyed driver wants nothing", async () => {
    const d = "```mermaid\ngraph TD\n  gone --> away\n```\n\nend\n";
    const s = state(d, {}, loaded);
    const driver = new MermaidRequests(() => {});
    driver.request(s, view(s));
    driver.destroy();
    await settle();
    expect(renders).toEqual([]);
  });
});

describe("MermaidWidget's height estimate follows the width it is shown at (change: mermaid-large-diagrams, D5)", () => {
  const w = (vb: string) => new MermaidWidget(mermaidMarkup(`<svg id="om-mermaid-0" viewBox="${vb}"><text>x</text></svg>`), 0);
  it("narrow: its own height; wide: scaled to the column; very wide: at the floor; tall: fitted", () => {
    expect(w("0 0 400 300").estimatedHeight).toBe(300);
    expect(w("0 0 800 400").estimatedHeight).toBe(328);
    expect(w("0 0 20000 400").estimatedHeight).toBe(300);
    // Tall (fixture (a)): fitted to the column, not enlarged by the floor.
    expect(w("0 0 6648 19664").estimatedHeight).toBe(Math.ceil((19664 * 656) / 6648));
    expect(new MermaidWidget(mermaidMarkup('<svg id="om-mermaid-0"><text>x</text></svg>'), 0).estimatedHeight).toBe(-1);
  });
});

