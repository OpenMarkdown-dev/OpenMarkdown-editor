import type { Text } from "@codemirror/state";
import type { BlockRange } from "./types";

/**
 * The A / B block a vertical caret move would jump over, or null.
 *
 * Rendered A / B blocks are atomic ranges, so CodeMirror's own vertical move
 * lands on the far side of one instead of inside it — the arrow skips the whole
 * table (spec: block-editing / 方向键进出块). `head` is where the caret is,
 * `target` where CodeMirror would put it. Crossing = the block lies strictly
 * between them in the direction of travel; the nearest such block wins.
 */
export function crossedBlock(
  blocks: readonly BlockRange[],
  head: number,
  target: number,
  forward: boolean,
): BlockRange | null {
  let best: BlockRange | null = null;
  for (const b of blocks) {
    if (b.mode === "C") continue;
    if (forward) {
      if (b.from > head && target >= b.from && (!best || b.from < best.from)) best = b;
    } else if (b.to < head && target <= b.to && (!best || b.to > best.to)) best = b;
  }
  return best;
}

/**
 * Index of the centre nearest to `x`, clamped to `[0, count)`. With no centres
 * (DOM not measurable) falls back to the first part.
 */
export function nearestIndex(centers: readonly number[], x: number, count: number): number {
  if (centers.length === 0 || count <= 0) return 0;
  let best = 0;
  for (let i = 1; i < centers.length; i++) {
    if (Math.abs(centers[i] - x) < Math.abs(centers[best] - x)) best = i;
  }
  return Math.min(best, count - 1);
}

/**
 * Where the caret goes when an edit leaves a B block by Esc (spec: caret-rules
 * R8a / R9): the start of the line after the block, or the block's end when the
 * block is the last thing in the document. `to` is the block's end. Pure.
 */
export function lineAfterBlock(doc: Text, to: number): number {
  const line = doc.lineAt(Math.min(to, doc.length));
  return line.number < doc.lines ? doc.line(line.number + 1).from : line.to;
}
