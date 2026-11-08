import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { withCompleteTree } from "./syntax";
import { history, undo } from "@codemirror/commands";
import { fenceCloseChange } from "./commands";

/**
 * Build a state with the cursor at `|` in `docWithCursor`. Forces a full parse
 * so `fenceCloseChange` sees the same tree the running editor would once parsed
 * (the tiny fixtures here parse eagerly anyway; this just removes any doubt).
 */
function stateAt(docWithCursor: string, extra: unknown[] = []): EditorState {
  const cursor = docWithCursor.indexOf("|");
  if (cursor < 0) throw new Error("test doc must contain a | cursor marker");
  const doc = docWithCursor.slice(0, cursor) + docWithCursor.slice(cursor + 1);
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: languages }), ...(extra as never[])],
  });
  return withCompleteTree(state);
}

/** Apply a spec and return the resulting doc + main cursor position. */
function apply(state: EditorState, spec: TransactionSpec) {
  const next = state.update(spec).state;
  return { doc: next.doc.toString(), cursor: next.selection.main.head, state: next };
}

describe("fenceCloseChange — auto-close unclosed code fence", () => {
  // Scenario: 未闭合 fence 回车补全 (+ cursor position + single undo)
  it("closes an unclosed ```python fence, cursor lands on the blank line", () => {
    const state = stateAt("```python|");
    const spec = fenceCloseChange(state)!;
    expect(spec).not.toBeNull();
    const { doc, cursor } = apply(state, spec);
    expect(doc).toBe("```python\n\n```");
    // Blank middle line is empty and the cursor sits on it.
    expect(cursor).toBe("```python\n".length);
    expect(doc.split("\n")).toEqual(["```python", "", "```"]);
  });

  it("the whole auto-close is a single undo step", () => {
    const start = stateAt("```python|", [history()]);
    const spec = fenceCloseChange(start)!;
    let state = start.update(spec).state;
    expect(state.doc.toString()).toBe("```python\n\n```");
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    });
    expect(state.doc.toString()).toBe("```python");
    // Cursor restored to the opener line end.
    expect(state.selection.main.head).toBe("```python".length);
  });

  // Scenario: 已闭合 fence 不重复插入
  it("does not insert when the fence is already closed", () => {
    const state = stateAt("```python|\ncode\n```");
    expect(fenceCloseChange(state)).toBeNull();
  });

  // Scenario: 波浪线与超长 fence 同型闭合
  it("closes a ~~~~ (4 tildes) fence with an identical ~~~~ line", () => {
    const state = stateAt("~~~~|");
    const spec = fenceCloseChange(state)!;
    const { doc } = apply(state, spec);
    expect(doc).toBe("~~~~\n\n~~~~");
  });

  it("closes a longer ```` (4 backticks) fence with matching length", () => {
    const state = stateAt("````|");
    const { doc } = apply(state, fenceCloseChange(state)!);
    expect(doc).toBe("````\n\n````");
  });

  // Scenario: 未闭合块内的新 fence 行不误触发
  it("does not trigger on a ``` line that is content of an unclosed ~~~ block", () => {
    // Cursor at the end of the inner ``` line; it belongs to the outer ~~~ block.
    const state = stateAt("~~~\nfoo\n```|\nbar");
    expect(fenceCloseChange(state)).toBeNull();
  });

  // Scenario: 容器内 fence 不触发 (blockquote)
  it("falls through for a fence opener inside a blockquote", () => {
    const state = stateAt("> ```py|");
    expect(fenceCloseChange(state)).toBeNull();
  });

  it("falls through for a fence opener indented inside a list item", () => {
    const state = stateAt("- item\n  ```py|");
    expect(fenceCloseChange(state)).toBeNull();
  });

  // Scenario: 行中回车不触发
  it("does not trigger when the cursor is mid-line (not at line end)", () => {
    const state = stateAt("```py|thon");
    expect(fenceCloseChange(state)).toBeNull();
  });

  // Guard: only a single collapsed selection triggers.
  it("does not trigger with a non-empty selection", () => {
    const base = stateAt("```python|");
    const state = base.update({
      selection: EditorSelection.range("```".length, "```python".length),
    }).state;
    expect(fenceCloseChange(state)).toBeNull();
  });

  it("does not trigger in a read-only (reading-mode) state", () => {
    const state = stateAt("```python|", [EditorState.readOnly.of(true)]);
    expect(fenceCloseChange(state)).toBeNull();
  });

  // Preserves the opener's ≤3-space indent on the closing line (design D4).
  it("reproduces up to 3 spaces of opener indent on the closing fence", () => {
    const state = stateAt("   ```js|");
    const { doc } = apply(state, fenceCloseChange(state)!);
    expect(doc).toBe("   ```js\n\n   ```");
  });
});
