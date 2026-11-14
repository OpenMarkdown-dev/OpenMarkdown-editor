import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { blockDecorationField } from "./blocks/field";
import { MermaidRequests, askedDiagrams, driverShouldRequest, pressRender, waitsForUser } from "./blocks/mermaid";
import { PendingWidget } from "./blocks/pending";
import { asyncRenderDone } from "./blocks/render";
import { dialectBase, dialectExtensions } from "./dialectParser";
import {
  CACHE_LIMIT,
  LARGE_DIAGRAM_SIZE,
  diagramSize,
  mermaidLoader,
  type MermaidModule,
  requestMermaid,
  setFrameScheduler,
} from "./mermaid";
import { livePreviewConfig } from "./previewConfig";
import { SelectableWidget } from "./selectionPaint";
import { withCompleteTree } from "./syntax";

/**
 * Large diagrams wait for the user (spec: block-editing / 异步渲染的块, 超过阈值的块
 * 等用户点「渲染」; change: mermaid-large-diagrams, design D3, D4). Bodies come
 * from `fixtures/perf/mermaid-large.md`, so the fixture and the threshold stay
 * on the sides they are named for.
 */
const FIXTURE = readFileSync(join(process.cwd(), "fixtures/perf/mermaid-large.md"), "utf8");
const sections = Object.fromEntries(
  FIXTURE.split(/^## /m)
    .slice(1)
    .map((part) => [part[1], /```mermaid\n([\s\S]*?)\n```/.exec(part)?.[1] ?? ""]),
);
const LARGE = sections.a;
const UNDER = sections.d;

const renders: string[] = [];
const fakeMermaid: MermaidModule = {
  initialize: () => {},
  mermaidAPI: {
    getSiteConfig: () => ({}),
    render: async (_id, body) => {
      renders.push(body);
      return { svg: '<svg id="om-mermaid-1" viewBox="0 0 10 10"></svg>' };
    },
  },
};
const fakeLoad = async () => fakeMermaid;
const settle = () => new Promise((r) => setTimeout(r, 0));

function state(doc: string, opts: { anchor?: number; dark?: boolean } = {}, extra: Extension = []) {
  return withCompleteTree(
    EditorState.create({
      doc,
      selection: { anchor: opts.anchor ?? doc.length },
      extensions: [
        markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }),
        livePreviewConfig.of({ revealOnSelection: true, resolveImage: (s: string) => s }),
        EditorView.darkTheme.of(opts.dark ?? false),
        mermaidLoader.of(fakeLoad),
        blockDecorationField,
        extra,
      ],
    }),
  );
}
/** The same diagram as a source no earlier test rendered (a comment: same size, new cache key). */
let freshCount = 0;
const fresh = (body: string) => `${body}\n%% fresh ${++freshCount}`;
const fenced = (body: string) => `intro\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\nend\n`;
/** The fence's start in a document made by `fenced` (or the n-th fence). */
const fenceAt = (s: EditorState, n = 0) => {
  let i = -1;
  for (let k = 0; k <= n; k++) i = s.doc.toString().indexOf("```mermaid", i + 1);
  return i;
};
/** Press "Render" on the n-th fence, as the button does. */
function press(s: EditorState, n = 0): EditorState {
  let next = s;
  pressRender(fenceAt(s, n), (spec) => {
    next = s.update(spec).state;
  });
  return next;
}
const fenceOf = (s: EditorState, n = 0) => {
  const from = fenceAt(s, n);
  const body = /```mermaid\n([\s\S]*?)\n```/.exec(s.doc.toString().slice(from))![1];
  return { from, body };
};
const viewport = (s: EditorState) => ({ from: 0, to: s.doc.length });
/** The placeholder (if any) the block field drew over the fence. */
function placeholder(s: EditorState): PendingWidget | null {
  let found: PendingWidget | null = null;
  s.field(blockDecorationField).blocks.between(0, s.doc.length, (_f, _t, d) => {
    const inner = (d.spec.widget as SelectableWidget).inner;
    if (inner instanceof PendingWidget) found = inner;
  });
  return found;
}

beforeEach(() => {
  renders.length = 0;
  setFrameScheduler((go) => go());
});
afterEach(() => setFrameScheduler());

describe("the fixture sections sit on the side of N they are named for", () => {
  it("(a)(b)(c) above, (d) just under", () => {
    for (const k of ["a", "b", "c"]) expect(diagramSize(sections[k]), k).toBeGreaterThan(LARGE_DIAGRAM_SIZE);
    expect(diagramSize(UNDER)).toBeLessThanOrEqual(LARGE_DIAGRAM_SIZE);
    expect(diagramSize(UNDER)).toBeGreaterThan(LARGE_DIAGRAM_SIZE * 0.9);
  });
});

describe("waitsForUser — the one predicate, keyed by the block (settled 2026-11-14)", () => {
  it("over N and not asked → waits; asked → does not; under N never waits", () => {
    let s = state(fenced(LARGE));
    expect(waitsForUser(s, fenceOf(s))).toBe(true);
    s = press(s);
    expect(waitsForUser(s, fenceOf(s))).toBe(false);
    const small = state(fenced(UNDER));
    expect(waitsForUser(small, fenceOf(small))).toBe(false);
  });

  it("the approval survives the block's own edits and text added above it", () => {
    let s = press(state(fenced(LARGE)));
    const inside = s.doc.toString().indexOf("N0[");
    s = s.update({ changes: { from: inside, insert: "Z" } }).state;
    expect(waitsForUser(s, fenceOf(s))).toBe(false);
    s = s.update({ changes: { from: 0, insert: "a new first line\n\n" } }).state;
    expect(waitsForUser(s, fenceOf(s))).toBe(false);
    // A block pasted right at its start pushes it down; the pasted one waits.
    s = s.update({ changes: { from: fenceAt(s), insert: `\`\`\`mermaid\n${LARGE}\n\`\`\`\n\n` } }).state;
    expect(waitsForUser(s, fenceOf(s, 0))).toBe(true);
    expect(waitsForUser(s, fenceOf(s, 1))).toBe(false);
  });

  it("is not shared with a different block, even one with the same source", () => {
    const doc = `${fenced(LARGE)}\n\`\`\`mermaid\n${LARGE}\n\`\`\`\n`;
    const s = press(state(doc), 0);
    expect(waitsForUser(s, fenceOf(s, 0))).toBe(false);
    expect(waitsForUser(s, fenceOf(s, 1))).toBe(true);
  });

  it("deleting the block drops its approval", () => {
    let s = press(state(fenced(LARGE)));
    const from = fenceAt(s);
    s = s.update({ changes: { from: from - 1, to: s.doc.length - 5 } }).state;
    expect(s.field(askedDiagrams)).toEqual([]);
  });

  it("the bound drops the oldest asked", () => {
    let s = state(fenced(LARGE));
    for (let i = 0; i <= CACHE_LIMIT; i++) pressRender(i, (spec) => void (s = s.update(spec).state));
    expect(s.field(askedDiagrams)).toHaveLength(CACHE_LIMIT);
    expect(s.field(askedDiagrams)[0]).toBe(1);
  });
});

describe("the driver never asks for a waiting diagram (design D3)", () => {
  it("open, selection in / out, scheme flip → 0 renders; after Render → exactly 1; edited and left → exactly 1 more, of the new source", async () => {
    const body = fresh(LARGE);
    const doc = fenced(body);
    const inside = doc.indexOf("N0[");
    const driver = new MermaidRequests(() => {});
    let s = state(doc);
    driver.request(s, viewport(s));
    s = s.update({ selection: { anchor: inside } }).state;
    driver.request(s, viewport(s));
    s = s.update({ selection: { anchor: s.doc.length } }).state;
    driver.request(s, viewport(s));
    const dark = state(doc, { dark: true });
    driver.request(dark, viewport(dark));
    await settle();
    expect(renders).toEqual([]);

    // Asked: renders once.
    s = press(s);
    driver.request(s, viewport(s));
    await settle();
    expect(renders).toEqual([body]);

    // Edit inside and leave: still asked (the same block), renders the new source once.
    s = s.update({ selection: { anchor: inside } }).state;
    s = withCompleteTree(s.update({ changes: { from: inside, insert: "Z" } }).state);
    driver.request(s, viewport(s));
    await settle();
    expect(renders).toEqual([body]);
    s = s.update({ selection: { anchor: s.doc.length } }).state;
    driver.request(s, viewport(s));
    await settle();
    expect(renders).toEqual([body, body.replace("N0[", "ZN0[")]);
  });

  it("a diagram just under N (fixture (d)) renders on open, once", async () => {
    const s = state(fenced(UNDER));
    new MermaidRequests(() => {}).request(s, viewport(s));
    await settle();
    expect(renders).toEqual([UNDER]);
  });
});

describe("the widget: the placeholder with the hint, then 'Rendering…' (design D4)", () => {
  it("waiting → D's placeholder carrying the content key mermaid-large:<size>", () => {
    const p = placeholder(state(fenced(fresh(LARGE))));
    expect(p).toBeInstanceOf(PendingWidget);
    expect(p!.content?.key).toBe(`mermaid-large:${diagramSize(LARGE)}`);
  });

  it("the Render press asks for exactly that block and rebuilds", () => {
    const doc = `${fenced(LARGE)}\n\`\`\`mermaid\n${sections.b}\n\`\`\`\n`;
    const s0 = state(doc);
    const sent: { effects: { is: (t: unknown) => boolean }[] }[] = [];
    pressRender(fenceAt(s0, 0), (spec) => sent.push(spec as never));
    expect(sent).toHaveLength(1);
    expect(sent[0].effects.some((e) => e.is(asyncRenderDone))).toBe(true);
    const s = s0.update(sent[0] as never).state;
    expect(waitsForUser(s, fenceOf(s, 0))).toBe(false);
    expect(waitsForUser(s, fenceOf(s, 1))).toBe(true);
  });

  it("asked and not cached yet → the same box with 'Rendering…'", () => {
    const s = press(state(fenced(fresh(LARGE))));
    expect(placeholder(withCompleteTree(s))!.content?.key).toBe("mermaid-large:rendering");
  });

  it("under N, not cached → the plain placeholder (no content)", () => {
    expect(placeholder(state(fenced(fresh(UNDER))))!.content).toBeUndefined();
  });
});

describe("a large render waits one frame, so 'Rendering…' paints first (design D4)", () => {
  it("the render is not called before the frame callback runs", async () => {
    const frames: (() => void)[] = [];
    setFrameScheduler((go) => frames.push(go));
    requestMermaid(LARGE, "light", fakeLoad, () => {}, () => true);
    await settle();
    await settle();
    expect(frames).toHaveLength(1);
    expect(renders).toEqual([]);
    frames[0]();
    await settle();
    expect(renders).toEqual([LARGE]);
  });

  it("a source moved past during that frame is dropped unrun, and nobody is called", async () => {
    const frames: (() => void)[] = [];
    setFrameScheduler((go) => frames.push(go));
    const body = fresh(LARGE);
    let still = true;
    let heard = 0;
    requestMermaid(body, "light", fakeLoad, () => heard++, () => still);
    await settle();
    await settle();
    expect(frames).toHaveLength(1);
    still = false;
    frames[0]();
    await settle();
    expect(renders).toEqual([]);
    expect(heard).toBe(0);
  });

  it("a diagram under N does not wait for a frame", async () => {
    const frames: (() => void)[] = [];
    setFrameScheduler((go) => frames.push(go));
    requestMermaid(UNDER, "dark", fakeLoad, () => {}, () => true);
    await settle();
    await settle();
    expect(frames).toHaveLength(0);
    expect(renders).toEqual([UNDER]);
  });
});

describe("the driver asks again after a Render press, not after every rebuild", () => {
  it("the press (askedDiagrams changed) makes the driver request; a bare asyncRenderDone does not", () => {
    const s = state(fenced(fresh(LARGE)));
    const base = { docChanged: false, selectionSet: false, startState: s };
    expect(driverShouldRequest({ ...base, state: press(s) })).toBe(true);
    // A render ending dispatches this; asking again on it would loop a failed load.
    const rebuilt = s.update({ effects: asyncRenderDone.of(null) });
    expect(driverShouldRequest({ ...base, state: rebuilt.state })).toBe(false);
    expect(driverShouldRequest({ ...base, state: s.update({}).state })).toBe(false);
  });
});
