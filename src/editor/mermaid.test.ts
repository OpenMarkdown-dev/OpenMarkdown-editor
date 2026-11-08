import { describe, expect, it } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { blockDecorationField, blockRanges } from "./blocks/field";
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
  shownMermaid,
} from "./mermaid";
import { mermaidMarkup } from "./markup";
import { createEditorState } from ".";
import { createEditorState as createDiagramFreeState } from "./base";
import { importMermaid } from "./mermaidImport";
import { livePreviewConfig } from "./previewConfig";
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

  it("nothing yet → source, unmarked (not now)", () => {
    expect(rendered(state(doc.replace("field", "pending")))).toEqual({ blocks: [], failed: [] });
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
