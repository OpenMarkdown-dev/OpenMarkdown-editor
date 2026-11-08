import { describe, expect, it } from "vitest";
import { codeBlockBody } from "./codeblockCopy";

/**
 * Pure extraction of a fenced code block's copyable body from its source slice
 * (the whole `` ``` ``…`` ``` `` span). Editor logic lives in a pure helper so it
 * can be node-tested — EditorView can't be constructed in node (dev note).
 */
describe("codeBlockBody", () => {
  it("strips the opening fence + language id and the closing fence", () => {
    expect(codeBlockBody("```python\ndef f():\n    pass\n```")).toBe("def f():\n    pass");
  });

  it("handles a fence with no language id", () => {
    expect(codeBlockBody("```\nplain text\n```")).toBe("plain text");
  });

  it("preserves interior indentation (Python etc.)", () => {
    expect(codeBlockBody("```\n  two\n    four\n```")).toBe("  two\n    four");
  });

  it("returns empty string for an empty block", () => {
    expect(codeBlockBody("```\n```")).toBe("");
  });

  it("handles an unclosed fence (no trailing fence line to drop)", () => {
    expect(codeBlockBody("```js\nconst x = 1;")).toBe("const x = 1;");
  });

  it("drops trailing blank lines before the closing fence", () => {
    expect(codeBlockBody("```\ncode\n\n\n```")).toBe("code");
  });

  it("supports tilde fences", () => {
    expect(codeBlockBody("~~~\ncode\n~~~")).toBe("code");
  });

  it("supports fences longer than three chars", () => {
    expect(codeBlockBody("````\na ``` b\n````")).toBe("a ``` b");
  });

  it("preserves interior blank lines", () => {
    expect(codeBlockBody("```\na\n\nb\n```")).toBe("a\n\nb");
  });
});
