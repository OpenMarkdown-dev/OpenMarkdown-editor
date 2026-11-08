import { countColumn } from "@codemirror/state";

/**
 * Column arithmetic for list and quote structure: tab stops as CommonMark
 * counts them, where an item's content starts, how much of a lead fits in a
 * column. A leaf — it imports nothing from `structure/` — because both the
 * list tree (`listTree.ts`) and the container prefix (`prefix.ts`) measure with
 * it, and the list tree also reads the prefix (spec: module-graph / 运行时
 * import 不成环).
 */

/** Tab stops every 4 columns, as CommonMark counts them. */
export const TAB_SIZE = 4;

export function columnOf(text: string): number {
  return countColumn(text, TAB_SIZE);
}

/**
 * Column where a list item's content starts, given its marker line and the
 * marker's end offset in it. Content starts after the whitespace following the
 * marker; a marker with nothing after it, or more than four columns of space
 * (an indented code block inside the item), puts it one column past the marker.
 */
export function contentColumn(lineText: string, markEnd: number): number {
  const space = /^[ \t]*/.exec(lineText.slice(markEnd))![0];
  const markEndCol = columnOf(lineText.slice(0, markEnd));
  const spaceCols = columnOf(lineText.slice(0, markEnd) + space) - markEndCol;
  const empty = markEnd + space.length === lineText.length;
  return empty || spaceCols > 4 ? markEndCol + 1 : markEndCol + spaceCols;
}

/** Length of the prefix of `lead` (leading whitespace) that stays within `col` columns. */
export function leadWithin(lead: string, col: number): number {
  let n = 0;
  while (n < lead.length && columnOf(lead.slice(0, n + 1)) <= col) n++;
  return n;
}
