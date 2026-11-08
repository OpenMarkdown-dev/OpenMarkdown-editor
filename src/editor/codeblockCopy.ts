/**
 * Extract a fenced code block's copyable body from its full source slice — the
 * opening `` ``` ``/language line through the closing fence. Kept pure so it can
 * be node-tested (dev note: editor logic lives in pure helpers — EditorView
 * isn't constructible in node). Used by the code block copy button (change:
 * codeblock-polish).
 */

const CLOSING_FENCE = /^\s*(`{3,}|~{3,})\s*$/;

export function codeBlockBody(source: string): string {
  const lines = source.split("\n");
  // First line is the opening fence (`` ```python ``); always dropped.
  lines.shift();
  // Last line is the closing fence when the block is closed; an unclosed fence
  // (fence-autoclose off / caret mid-edit) has none to drop.
  if (lines.length > 0 && CLOSING_FENCE.test(lines[lines.length - 1])) {
    lines.pop();
  }
  // Drop trailing blank lines so a copied block ends cleanly (interior blanks
  // and leading indentation are preserved).
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}
