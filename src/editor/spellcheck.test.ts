import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { missField, missRanges, setMisses, textsToAsk, touches } from "./spellcheck";

/** The squiggles of a state, as [from, to, text]. */
function squiggles(state: EditorState): [number, number, string][] {
  const out: [number, number, string][] = [];
  state.field(missField).between(0, state.doc.length, (from, to) => {
    out.push([from, to, state.sliceDoc(from, to)]);
  });
  return out;
}

function drawn(doc: string, words: string[]): EditorState {
  const state = EditorState.create({ doc, extensions: [missField] });
  const misses = words.map((w) => ({ from: doc.indexOf(w), to: doc.indexOf(w) + w.length }));
  return state.update({ effects: setMisses.of(misses) }).state;
}

describe("spellcheck — 红线随改动平移,被改到即撤(spec: 红线由编辑器画,增量检查)", () => {
  const doc = "This sentense has anothr one.";

  it("draws what the checker answered", () => {
    expect(squiggles(drawn(doc, ["sentense", "anothr"]))).toEqual([
      [5, 13, "sentense"],
      [18, 24, "anothr"],
    ]);
  });

  it("an edit elsewhere moves the squiggles with the text", () => {
    const s = drawn(doc, ["sentense", "anothr"]);
    const next = s.update({ changes: { from: 0, insert: "Yes. " } }).state;
    expect(squiggles(next).map((m) => m[2])).toEqual(["sentense", "anothr"]);
  });

  it("the word being typed loses its squiggle at once — inside it, or at its end", () => {
    const s = drawn(doc, ["sentense", "anothr"]);
    const inside = s.update({ changes: { from: 20, insert: "e" } }).state;
    expect(squiggles(inside).map((m) => m[2])).toEqual(["sentense"]);
    const atEnd = s.update({ changes: { from: 13, insert: "s" } }).state;
    expect(squiggles(atEnd).map((m) => m[2])).toEqual(["anothr"]);
  });

  it("an empty answer clears them", () => {
    const s = drawn(doc, ["sentense"]);
    expect(squiggles(s.update({ effects: setMisses.of([]) }).state)).toEqual([]);
  });
});

describe("spellcheck — 成批且不重查", () => {
  const units = [
    { from: 0, text: "alpha" },
    { from: 10, text: "beta" },
    { from: 20, text: "alpha" },
  ];

  it("asks once per unknown paragraph text, never for a known one", () => {
    expect(textsToAsk(units, () => false)).toEqual(["alpha", "beta"]);
    expect(textsToAsk(units, (t) => t === "alpha")).toEqual(["beta"]);
    expect(textsToAsk(units, () => true)).toEqual([]);
  });

  it("answers become absolute ranges, in document order", () => {
    const answers = new Map([
      ["alpha", [{ from: 1, to: 3 }]],
      ["beta", [{ from: 0, to: 2 }]],
    ]);
    expect(missRanges(units, (t) => answers.get(t))).toEqual([
      { from: 1, to: 3 },
      { from: 10, to: 12 },
      { from: 21, to: 23 },
    ]);
  });

  it("touches: overlap or a shared edge", () => {
    expect(touches([[5, 5]], 0, 5)).toBe(true);
    expect(touches([[5, 5]], 5, 9)).toBe(true);
    expect(touches([[6, 6]], 0, 5)).toBe(false);
  });
});
