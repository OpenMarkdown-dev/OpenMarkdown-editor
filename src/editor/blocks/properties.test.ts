import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { dialectBase, dialectExtensions } from "../dialectParser";
import { blockDecorationField } from "./field";
import { livePreviewConfig } from "../previewConfig";
import { withCompleteTree } from "../syntax";
import { parseProps } from "../frontmatterProps";
import { partChange, parsePropsOf, propertiesState, setActiveProp } from "./properties";

/**
 * The Properties block's write-back, on an `EditorState` (spec: live-preview-editor
 * / Properties 块 「写回始终是合法的 YAML」; change: write-back-valid). The part
 * editor's `sync` calls `partChange` with the whole text typed so far on every
 * keystroke; these tests do the same, one prefix at a time, and read the file
 * back after each one.
 */

function live(doc: string): EditorState {
  return withCompleteTree(
    EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }),
        livePreviewConfig.of({ revealOnSelection: true, resolveImage: (s: string) => s }),
        history(),
        propertiesState,
        blockDecorationField,
      ],
    }),
  );
}

const apply = (s: EditorState, spec: TransactionSpec) => s.update(spec).state;

/** Type `text` one character at a time into the open part, as the part editor's sync does. */
function typeInto(s: EditorState, index: number, part: "key" | "value", text: string, each?: (s: EditorState, typed: string) => void) {
  for (let i = 1; i <= text.length; i++) {
    const change = partChange(s, index, part, text.slice(0, i));
    if (change) s = apply(s, { changes: change, userEvent: "input.type" });
    each?.(s, text.slice(0, i));
  }
  return s;
}

describe("write-back keeps the frontmatter valid on every keystroke", () => {
  it("the demo repro: name `key: x #[`, value `{oops: [1, \"` read back exactly", () => {
    let s = live("---\ntitle: x\n---\n\nbody");
    // "+ Add property" writes a name row and opens its name, selected.
    const p = parsePropsOf(s)!;
    s = apply(s, {
      changes: { from: p.closeFrom, insert: "新属性: \n" },
      effects: setActiveProp.of({ index: 1, part: "key", caret: "all" }),
      userEvent: "input",
    });
    s = typeInto(s, 1, "key", "key: x #[", (st, typed) => {
      expect(parseProps(st.doc.toString())?.props[1]?.key, `name after typing ${JSON.stringify(typed)}`).toBe(typed);
    });
    s = apply(s, { effects: setActiveProp.of({ index: 1, part: "value" }) });
    s = typeInto(s, 1, "value", '{oops: [1, "', (st, typed) => {
      const prop = parseProps(st.doc.toString())?.props[1];
      expect(prop?.value, `value after typing ${JSON.stringify(typed)}`).toBe(typed);
      expect(prop?.editable).toBe(true);
    });
    s = apply(s, { effects: setActiveProp.of(null) });
    expect(s.doc.toString()).toBe('---\ntitle: x\n"key: x #[": "{oops: [1, \\""\n---\n\nbody');
  });

  it('typing `"abc` into an empty value never drops the block to source', () => {
    let s = live("---\nempty:\n---\n");
    s = apply(s, { effects: setActiveProp.of({ index: 0, part: "value" }) });
    s = typeInto(s, 0, "value", '"abc', (st, typed) => {
      expect(parseProps(st.doc.toString())?.props[0]?.value, typed).toBe(typed);
    });
    expect(s.doc.toString()).toBe('---\nempty: "\\"abc"\n---\n');
  });
});

describe("the quote style comes from the start of the edit", () => {
  const DOC = "---\na: 1\nstatus: draft\nb: 2\n---\n\nbody";

  /** Set the open part to each text in turn (the part editor's sync after each edit). */
  function edits(s: EditorState, index: number, part: "key" | "value", texts: string[]) {
    for (const t of texts) {
      const change = partChange(s, index, part, t);
      if (change) s = apply(s, { changes: change, userEvent: "input.type" });
    }
    return s;
  }

  it("`draft` → `draft: x` → `draft` leaves the file byte-identical", () => {
    let s = apply(live(DOC), { effects: setActiveProp.of({ index: 1, part: "value" }) });
    s = edits(s, 1, "value", ["draft:"]);
    expect(s.doc.toString()).toContain('status: "draft:"\n');
    s = edits(s, 1, "value", ["draft: ", "draft: x"]);
    expect(s.doc.toString()).toContain('status: "draft: x"\n');
    s = edits(s, 1, "value", ["draft: ", "draft:", "draft"]);
    s = apply(s, { effects: setActiveProp.of(null) });
    expect(s.doc.toString()).toBe(DOC);
  });

  it("a value typed into `empty:` and deleted again gives back `empty:`", () => {
    const doc = "---\nempty:\n---\n";
    let s = apply(live(doc), { effects: setActiveProp.of({ index: 0, part: "value" }) });
    s = edits(s, 0, "value", ["a", "a:", ""]);
    expect(s.doc.toString()).toBe(doc);
  });

  it("an already quoted value keeps its quote style", () => {
    const doc = "---\ntitle: '旧标题'\n---\n";
    let s = apply(live(doc), { effects: setActiveProp.of({ index: 0, part: "value" }) });
    s = edits(s, 0, "value", ["it's"]);
    expect(s.doc.toString()).toBe("---\ntitle: 'it''s'\n---\n");
  });

  it("renaming `b` to `b: c` quotes only that name (editor-fidelity scenario)", () => {
    let s = apply(live(DOC), { effects: setActiveProp.of({ index: 2, part: "key" }) });
    s = edits(s, 2, "key", ["b:", "b: ", "b: c"]);
    expect(s.doc.toString()).toBe(DOC.replace("\nb: 2", '\n"b: c": 2'));
  });

  it("an empty name is not written", () => {
    const s = apply(live(DOC), { effects: setActiveProp.of({ index: 0, part: "key" }) });
    expect(partChange(s, 0, "key", "")).toBeNull();
  });

  it("entering and leaving without a change writes nothing", () => {
    let s = live(DOC);
    for (const part of ["key", "value"] as const) {
      s = apply(s, { effects: setActiveProp.of({ index: 1, part }) });
      expect(partChange(s, 1, part, part === "key" ? "status" : "draft")).toBeNull();
      s = apply(s, { effects: setActiveProp.of(null) });
    }
    expect(s.doc.toString()).toBe(DOC);
  });

  it("a burst of typing is one undo step, quotes and all", () => {
    let s = apply(live(DOC), { effects: setActiveProp.of({ index: 1, part: "value" }) });
    s = typeInto(s, 1, "value", "draft: 待审");
    expect(s.doc.toString()).toContain('status: "draft: 待审"\n');
    let undone: EditorState | null = null;
    undo({ state: s, dispatch: (tr) => (undone = tr.state) });
    expect(undone!.doc.toString()).toBe(DOC);
  });
});
