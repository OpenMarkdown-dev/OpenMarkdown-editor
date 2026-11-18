import { afterEach, describe, expect, it } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { history, redo, undo } from "@codemirror/commands";
import { createEditorState } from ".";
import { reconfigure, type Reconfigure } from "./base";
import { configureEditorEnvironment, environmentOf, ownEnvironment, type ColorScheme } from "./environment";
import { editorConfig } from "./host";
import { livePreviewConfig } from "./previewConfig";
import { blockDecorationField } from "./blocks/field";
import { withCompleteTree } from "./syntax";
import { findTextRange } from "./caret";
import { isUnedited, openMarkdownText } from "./fileBytes";
import { SCHEME_ATTRIBUTE } from "./tokens";

/**
 * Every editor configured on its own (spec: editor-host / 每个编辑器各自配置,
 * 编辑器可设为不可编辑; change: editor-per-instance). Pure: on editor states, as
 * a mounted view sees them (node has no DOM). The handle's commands, the scheme
 * subscription and the label focus run in real browsers in the consumer smoke
 * (`scripts/check-editor-consumer.mjs`).
 */

const step = (state: EditorState, change: Reconfigure) => state.update(reconfigure(state, change)).state;

const rootAttrs = (state: EditorState): Record<string, string> =>
  Object.assign({}, ...state.facet(EditorView.editorAttributes).filter((a) => typeof a !== "function"));
const contentAttrs = (state: EditorState): Record<string, string> =>
  Object.assign({}, ...state.facet(EditorView.contentAttributes).filter((a) => typeof a !== "function"));

const fixed = (scheme: ColorScheme) => ({ current: () => scheme, subscribe: () => () => {} });

afterEach(() => configureEditorEnvironment({}));

describe("the environment: the page's defaults, each editor's own over them", () => {
  it("an editor's own member wins; a member it leaves out is the page's", () => {
    const pageOpen = () => "page";
    const ownOpen = () => "own";
    const pageCopy = () => "copy";
    configureEditorEnvironment({ openExternal: pageOpen, copyText: pageCopy, language: "ko" });
    const plain = createEditorState({ doc: "x" });
    const own = createEditorState({ doc: "x", environment: { openExternal: ownOpen } });
    expect(environmentOf(plain).openExternal).toBe(pageOpen);
    expect(environmentOf(own).openExternal).toBe(ownOpen);
    expect(environmentOf(own).copyText).toBe(pageCopy);
    expect(environmentOf(own).language).toBe("ko");
  });

  it("a member given as undefined switches the page's off for that editor", () => {
    configureEditorEnvironment({ handleKey: () => true });
    expect(environmentOf(createEditorState({ environment: { handleKey: undefined } })).handleKey).toBeUndefined();
  });

  it("the language stays the page's, whatever an editor is given", () => {
    configureEditorEnvironment({ language: "ja" });
    const sneaky = { language: "zh" } as unknown as Parameters<typeof createEditorState>[0]["environment"];
    expect(environmentOf(createEditorState({ environment: sneaky })).language).toBe("ja");
  });

  it("two editors on one page each start in their own scheme", () => {
    configureEditorEnvironment({ colorScheme: fixed("light") });
    const light = createEditorState({ doc: "a" });
    const dark = createEditorState({ doc: "b", environment: { colorScheme: "dark" } });
    const live = createEditorState({ doc: "c", environment: { colorScheme: fixed("dark") } });
    expect(rootAttrs(light)[SCHEME_ATTRIBUTE]).toBe("light");
    expect(rootAttrs(dark)[SCHEME_ATTRIBUTE]).toBe("dark");
    expect(rootAttrs(live)[SCHEME_ATTRIBUTE]).toBe("dark");
  });

  it("setEnvironment replaces the editor's own and applies its scheme at once", () => {
    const opened: string[] = [];
    let s = createEditorState({ doc: "x", environment: { colorScheme: "light", openExternal: (u) => opened.push(`a:${u}`) } });
    s = step(s, { environment: { colorScheme: "dark", openExternal: (u) => opened.push(`b:${u}`) } });
    expect(rootAttrs(s)[SCHEME_ATTRIBUTE]).toBe("dark");
    environmentOf(s).openExternal?.("u");
    expect(opened).toEqual(["b:u"]);
    // Replaced, not merged: a member not given any more falls back to the page's.
    s = step(s, { environment: {} });
    expect(rootAttrs(s)[SCHEME_ATTRIBUTE]).toBe("light");
    expect(environmentOf(s).openExternal).toBeUndefined();
  });

  it("the editor's host keys run before CodeMirror's defaults, per editor", () => {
    const seen: string[] = [];
    const a = createEditorState({ environment: { handleKey: (_v, e) => (seen.push(`a:${e.key}`), true) } });
    const b = createEditorState({ environment: { handleKey: (_v, e) => (seen.push(`b:${e.key}`), true) } });
    // The editor's `any` bindings, the host's among them, read the state they run in.
    const press = (s: EditorState) => {
      for (const k of s.facet(keymap).flat()) {
        try {
          k.any?.({ state: s } as EditorView, { key: "s" } as KeyboardEvent);
        } catch {
          // another `any` binding that needs a real view
        }
      }
    };
    press(a);
    press(b);
    expect(seen).toEqual(["a:s", "b:s"]);
  });

  it("a nested editor is handed its outer editor's own environment", () => {
    const own = { openExternal: () => "x" };
    const outer = createEditorState({ environment: own });
    const part = EditorState.create({ extensions: ownEnvironment.of(outer.facet(ownEnvironment)) });
    expect(environmentOf(part).openExternal).toBe(own.openExternal);
  });
});

describe("editable: false", () => {
  const locked = (s: EditorState) => ({
    readOnly: s.readOnly,
    editable: s.facet(EditorView.editable),
    locked: s.facet(livePreviewConfig).locked === true,
    reveal: s.facet(livePreviewConfig).revealOnSelection,
  });

  it("is read-only in every mode, the mode unchanged", () => {
    for (const mode of ["live", "source", "reading"] as const) {
      const s = createEditorState({ doc: "x", mode, editable: false });
      expect(s.readOnly, mode).toBe(true);
      expect(s.facet(EditorView.editable), mode).toBe(false);
      expect(s.field(editorConfig).mode).toBe(mode);
    }
    // Live renders as reading does: no source revealed under the caret.
    expect(locked(createEditorState({ editable: false }))).toEqual({ readOnly: true, editable: false, locked: true, reveal: false });
  });

  it("reading mode alone is read-only but not locked (its checkboxes toggle)", () => {
    expect(locked(createEditorState({ mode: "reading" }))).toEqual({ readOnly: true, editable: false, locked: false, reveal: false });
  });

  it("setEditable switches it either way, document, selection and history kept", () => {
    let s = createEditorState({ doc: "abc", selection: { anchor: 2 } });
    s = s.update({ changes: { from: 3, insert: "d" }, userEvent: "input" }).state;
    s = step(s, { editable: false });
    expect(locked(s)).toEqual({ readOnly: true, editable: false, locked: true, reveal: false });
    s = step(s, { editable: true });
    expect(locked(s)).toEqual({ readOnly: false, editable: true, locked: false, reveal: true });
    expect([s.doc.toString(), s.selection.main.head]).toEqual(["abcd", 2]);
    let undone: EditorState = s;
    undo({ state: s, dispatch: (tr) => (undone = tr.state) });
    expect(undone.doc.toString()).toBe("abc");
  });

  it("undo does nothing while it is locked", () => {
    let s = createEditorState({ doc: "abc" });
    s = s.update({ changes: { from: 3, insert: "d" }, userEvent: "input" }).state;
    s = step(s, { editable: false });
    expect(undo({ state: s, dispatch: () => {} })).toBe(false);
  });

  // Finding #5: reading mode showed "+ Add property" / "Edit as source" after a
  // switch, because the redrawn block compared equal to the editable one.
  it("the properties block redraws without its editing controls", () => {
    const widgetOf = (s: EditorState) => {
      let w: { editable?: boolean } | undefined;
      withCompleteTree(s).field(blockDecorationField).blocks.between(0, s.doc.length, (_f, _t, d) => {
        // The block's widget, inside its selectable wrapper.
        w ??= d.spec.widget?.inner ?? d.spec.widget;
      });
      return w;
    };
    let s = createEditorState({ doc: "---\ntitle: x\n---\n\nbody", selection: { anchor: 20 } });
    const editableWidget = widgetOf(s) as { editable: boolean; eq(o: unknown): boolean };
    expect(editableWidget.editable).toBe(true);
    s = step(s, { mode: "reading" });
    const readingWidget = widgetOf(s) as { editable: boolean };
    expect(readingWidget.editable).toBe(false);
    expect(editableWidget.eq(readingWidget)).toBe(false);
    s = step(s, { mode: "live", editable: false });
    expect((widgetOf(s) as { editable: boolean }).editable).toBe(false);
  });
});

describe("labels and screen readers", () => {
  it("id / ariaLabel / ariaLabelledBy land on the editable text", () => {
    const s = createEditorState({ id: "body", ariaLabel: "Body", ariaLabelledBy: "body-label" });
    expect(contentAttrs(s)).toMatchObject({ id: "body", "aria-label": "Body", "aria-labelledby": "body-label" });
  });

  it("none given, none set", () => {
    const attrs = contentAttrs(createEditorState({}));
    expect(attrs.id).toBeUndefined();
    expect(attrs["aria-label"]).toBeUndefined();
  });
});

describe("extensions: one or an array", () => {
  it("accepts a readonly array as it is", () => {
    const seen: string[] = [];
    const exts: readonly Extension[] = [EditorState.transactionExtender.of(() => (seen.push("ext"), null))];
    const s = createEditorState({ doc: "x", extensions: exts });
    s.update({ changes: { from: 1, insert: "y" } });
    expect(seen).toEqual(["ext"]);
  });
});

// Finding #15: take over a host's CodeMirror editor with its undo history.
describe("fromState: taking over an existing CodeMirror state", () => {
  const hostState = () => {
    let s = EditorState.create({ doc: "one", selection: { anchor: 1 }, extensions: [history()] });
    s = s.update({ changes: { from: 3, insert: " two" }, userEvent: "input" }).state;
    s = s.update({ changes: { from: 7, insert: " three" }, userEvent: "input" }).state;
    return s.update({ selection: { anchor: 2, head: 4 } }).state;
  };
  const run = (cmd: typeof undo, s: EditorState) => {
    let out = s;
    const ok = cmd({ state: s, dispatch: (tr) => (out = tr.state) });
    return { ok, out };
  };

  it("keeps the document, selection and undo history", () => {
    const s = createEditorState({ fromState: hostState(), doc: "ignored", selection: { anchor: 0 } });
    expect(s.doc.toString()).toBe("one two three");
    expect([s.selection.main.anchor, s.selection.main.head]).toEqual([2, 4]);
    const once = run(undo, s);
    expect(once.ok).toBe(true);
    expect(once.out.doc.toString()).toBe("one two");
    const twice = run(undo, once.out);
    expect(twice.out.doc.toString()).toBe("one");
    expect(run(redo, twice.out).out.doc.toString()).toBe("one two");
  });

  it("is the whole editor afterwards (its options apply)", () => {
    const s = createEditorState({ fromState: hostState(), mode: "source", editable: false });
    expect(s.field(editorConfig).mode).toBe("source");
    expect(s.readOnly).toBe(true);
  });

  it("a state without history is taken over without one", () => {
    const s = createEditorState({ fromState: EditorState.create({ doc: "plain" }) });
    expect(s.doc.toString()).toBe("plain");
    expect(run(undo, s).ok).toBe(false);
  });
});

describe("revealText and isUnedited (pure parts)", () => {
  it("finds the first occurrence, CRLF in the needle read as a line break", () => {
    expect(findTextRange("a b\nc b", "b")).toEqual({ from: 2, to: 3 });
    expect(findTextRange("a b\nc", "b\r\nc")).toEqual({ from: 2, to: 5 });
    expect(findTextRange("abc", "")).toBeNull();
    expect(findTextRange("abc", "x")).toBeNull();
  });

  it("isUnedited is the codec's own test", () => {
    const file = openMarkdownText("﻿a\r\nb\r\n");
    expect(isUnedited("a\nb\n", file)).toBe(true);
    expect(isUnedited("a\nb!\n", file)).toBe(false);
  });
});
