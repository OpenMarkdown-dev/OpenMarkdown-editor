import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import type { Decoration } from "@codemirror/view";
import { dialectBase, dialectExtensions } from "../dialectParser";
import { livePreviewConfig } from "../previewConfig";
import { withCompleteTree } from "../syntax";
import { SelectableWidget } from "../selectionPaint";
import { blockDecorationField, blockRanges } from "./field";
import { MathLoadDriver, documentHasMath } from "./math";
import { PendingWidget, blockSizeKey, forgetSizes, rememberSize } from "./pending";
import { pending } from "./render";
import type { BlockEntry } from "./types";

/**
 * The block field turns a `pending` answer into the one placeholder through its
 * one `push` (spec: block-editing / 块在渲染前占住它的位置; change:
 * render-placeholder-size, design D2, D8, D9). A fake A entry (a blockquote,
 * which no real entry draws) answers `pending({ content })` so the slot is
 * covered without a real deferred block.
 */
const { content, fake } = vi.hoisted(() => {
  const content = { key: "fake-hint", build: () => ({}) as HTMLElement };
  const fake: BlockEntry = {
    id: "fake-deferred",
    mode: "A",
    node: "Blockquote",
    range: (state, node) => ({ from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.to).to }),
    // `pending` is imported lazily: this runs before the file's imports.
    widget: () => pendingRef.make({ content }),
  };
  return { content, fake };
});
const pendingRef = vi.hoisted(() => ({ make: (() => null) as unknown as typeof pending }));
pendingRef.make = pending;

vi.mock("./registry", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./registry")>();
  const BLOCKS = [...orig.BLOCKS, fake];
  return {
    BLOCKS,
    BLOCKS_BY_NODE: new Map(BLOCKS.filter((b) => b.node).map((b) => [b.node!, b])),
    blockEntry: (id: string) => BLOCKS.find((b) => b.id === id),
  };
});

function state(doc: string, selection: { anchor: number; head?: number }, reveal = true) {
  return withCompleteTree(
    EditorState.create({
      doc,
      selection,
      extensions: [
        markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }),
        livePreviewConfig.of({ revealOnSelection: reveal, resolveImage: (s: string) => s }),
        blockDecorationField,
      ],
    }),
  );
}

/** The block replacements the field made: range, spec, and the placeholder inside. */
function blocks(s: EditorState) {
  const out: { from: number; to: number; spec: Record<string, unknown>; host: SelectableWidget }[] = [];
  s.field(blockDecorationField).blocks.between(0, s.doc.length, (from, to, deco: Decoration) => {
    out.push({ from, to, spec: deco.spec, host: deco.spec.widget as SelectableWidget });
  });
  return out;
}

describe("the block field: pending → the one placeholder", () => {
  const doc = "intro\n\n> deferred\n\nend\n";
  const from = doc.indexOf(">");
  const to = doc.indexOf("\n\nend");

  it("a pending answer is a block replacement over its range, read back as that block", () => {
    const [b] = blocks(state(doc, { anchor: doc.length }));
    expect([b.from, b.to]).toEqual([from, to]);
    expect(b.host.inner).toBeInstanceOf(PendingWidget);
    expect(b.spec.block).toBe(true);
    expect(blockRanges(state(doc, { anchor: doc.length }))).toEqual([{ id: "fake-deferred", mode: "A", from, to }]);
  });

  it("carries the selected state like a rendered block (reading mode: a covered A block stays drawn)", () => {
    const [b] = blocks(state(doc, { anchor: 0, head: doc.length }, false));
    expect(b.host.covered).toBe(true);
    expect(blocks(state(doc, { anchor: doc.length }))[0].host.covered).toBe(false);
  });

  it("puts the entry's content inside the box (design D8)", () => {
    const p = blocks(state(doc, { anchor: doc.length }))[0].host.inner as PendingWidget;
    expect(p.content).toBe(content);
    expect(p.flow).toBe("block");
  });

  it("the caret inside reveals the source, as for a rendered A block", () => {
    expect(blocks(state(doc, { anchor: from + 3 }))).toEqual([]);
  });
});

describe("block math with the converter not loaded (this file never loads it)", () => {
  const doc = "# Title\n\nText.\n\n$$\n\\sum_{i=1}^n i\n$$\n\nafter\n";

  it("is a placeholder, not its source", () => {
    const [b] = blocks(state(doc, { anchor: 0 }));
    expect(b.spec.blockId).toBe("block-math");
    expect(b.host.inner).toBeInstanceOf(PendingWidget);
    expect((b.host.inner as PendingWidget).reserved.origin).toBe("minimum");
  });

  it("reserves the height it was last drawn at, for this source", () => {
    forgetSizes();
    const from = doc.indexOf("$$");
    const source = doc.slice(from, doc.indexOf("\n\nafter"));
    rememberSize(blockSizeKey("block-math", "light", source), { height: 87 });
    const p = blocks(state(doc, { anchor: 0 }))[0].host.inner as PendingWidget;
    expect(p.reserved).toEqual({ origin: "remembered", size: { height: 87 } });
    expect(p.estimatedHeight).toBe(87);
  });

  it("an edited block keeps the height it had before the edit (carried)", () => {
    forgetSizes();
    const from = doc.indexOf("$$");
    const source = doc.slice(from, doc.indexOf("\n\nafter"));
    rememberSize(blockSizeKey("block-math", "light", source), { height: 120 });
    // Caret enters (reveal), types inside, then leaves.
    let s = state(doc, { anchor: from + 4 });
    s = s.update({ changes: { from: from + 5, insert: "x + " }, selection: { anchor: from + 9 } }).state;
    s = s.update({ selection: { anchor: 0 } }).state;
    const p = blocks(withCompleteTree(s))[0].host.inner as PendingWidget;
    expect(p.reserved).toEqual({ origin: "carried", size: { height: 120 } });
  });
});

describe("the math load driver — loads when the document has math, not when it is seen", () => {
  const below = `${"filler line\n\n".repeat(400)}Inline $ax^2 + bx + c = 0$ far below.\n`;

  it("finds a formula anywhere in the tree, not only in a viewport", () => {
    expect(documentHasMath(state(below, { anchor: 0 }))).toBe(true);
    expect(documentHasMath(state("no math, $5 and $10\n", { anchor: 0 }))).toBe(false);
  });

  it("asks for the load once, however often it is checked", () => {
    const load = vi.fn();
    const driver = new MathLoadDriver(load);
    driver.check(state("plain\n", { anchor: 0 }));
    expect(load).not.toHaveBeenCalled();
    driver.check(state(below, { anchor: 0 }));
    driver.check(state(below, { anchor: 0 }));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("scheme is part of the remembered key", () => {
  it("a dark editor does not reserve the light drawing's height", () => {
    forgetSizes();
    const doc = "text\n\n$$x$$\n";
    rememberSize(blockSizeKey("block-math", "light", "$$x$$"), { height: 50 });
    const dark = withCompleteTree(
      EditorState.create({
        doc,
        selection: { anchor: 0 },
        extensions: [
          markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }),
          livePreviewConfig.of({ revealOnSelection: true, resolveImage: (s: string) => s }),
          EditorView.darkTheme.of(true),
          blockDecorationField,
        ],
      }),
    );
    expect((blocks(dark)[0].host.inner as PendingWidget).reserved.origin).toBe("minimum");
  });
});
