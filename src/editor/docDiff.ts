/**
 * The one range two documents differ in: their common prefix and suffix kept,
 * the middle replaced. `setDoc` dispatches only this, so an agent appending a
 * line leaves the reader's scroll position, selection and folds where they
 * were — a whole-document replace would throw them back to the top.
 *
 * Offsets are UTF-16, as CodeMirror's are; a range edge never splits a
 * surrogate pair. Null when the two are equal.
 */
export function changedRange(
  current: string,
  next: string,
): { from: number; to: number; insert: string } | null {
  if (current === next) return null;
  const max = Math.min(current.length, next.length);
  let start = 0;
  while (start < max && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  if (start > 0 && isHighSurrogate(current.charCodeAt(start - 1))) start--;
  let end = 0;
  while (
    end < max - start &&
    current.charCodeAt(current.length - 1 - end) === next.charCodeAt(next.length - 1 - end)
  ) {
    end++;
  }
  if (end > 0 && isLowSurrogate(current.charCodeAt(current.length - end))) end--;
  return { from: start, to: current.length - end, insert: next.slice(start, next.length - end) };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
