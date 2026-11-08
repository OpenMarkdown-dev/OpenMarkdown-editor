import type { EditorMode } from "./index";
import { parseProps } from "./frontmatterProps";
import { frontmatterRange } from "./headingIndex";

/**
 * Frontmatter text helpers, the skill-skeleton command and the mode cycle (spec:
 * skill-editing, live-preview-editor). All PURE string helpers — no EditorView,
 * so they unit-test in node (CLAUDE.md: 编辑器逻辑抽纯 helper 测). A skill file is
 * not special anywhere else: its frontmatter is an ordinary Properties block.
 */

/**
 * Frontmatter as ordered key/value entries — the Properties block's own rows
 * (`parseProps`, the one property reading; change: missing-gates). Names are
 * whatever YAML allows (Chinese included); a value is what the row's value
 * column shows (between its quotes, no trailing comment); a read-only row
 * gives what `parseProps` gives it. Unparseable frontmatter — shown as source,
 * not as a Properties block — has no entries.
 */
export function frontmatterEntries(doc: string): Array<{ key: string; value: string }> {
  return parseProps(doc)?.props.map((p) => ({ key: p.key, value: p.value })) ?? [];
}

/**
 * The Properties block as one line, `key: value · key: value`, for the rendered
 * plain-text copy (spec: live-preview-editor / frontmatter 的属性只有一个读法):
 * key AND a truncated value per row. A value-less key shows the key alone; a
 * block with no rows falls back to a plain label. (Named after the retired
 * collapsed chip it once labelled.)
 */
export function frontmatterChipSummary(doc: string, maxValue = 40): string {
  const entries = frontmatterEntries(doc);
  if (entries.length === 0) return "frontmatter";
  return entries
    .map((e) => {
      if (!e.value) return e.key;
      const v = e.value.length > maxValue ? `${e.value.slice(0, maxValue - 1)}…` : e.value;
      return `${e.key}: ${v}`;
    })
    .join(" · ");
}

/** True when the document already has frontmatter (the one frontmatter rule). */
export function hasLeadingFrontmatter(doc: string): boolean {
  return frontmatterRange(doc) !== null;
}

/**
 * The skeleton inserted by the "insert skill frontmatter" command: a minimal
 * `name`/`description` YAML block + a trailing blank line. `caret` is the offset
 * to seat the cursor at (just after `name: `) for immediate typing.
 */
export function skillFrontmatterSkeleton(): { text: string; caret: number } {
  const head = "---\nname: ";
  return { text: `${head}\ndescription: \n---\n\n`, caret: head.length };
}

/**
 * The mode-cycle successor of `current` (spec: 编辑器三种模式). Every file —
 * skill files included — cycles live → source → reading; the skill mode retired
 * with change properties-block.
 */
export function nextEditorMode(current: EditorMode): EditorMode {
  const cycle: EditorMode[] = ["live", "source", "reading"];
  const i = cycle.indexOf(current);
  return i === -1 ? cycle[0] : cycle[(i + 1) % cycle.length];
}
