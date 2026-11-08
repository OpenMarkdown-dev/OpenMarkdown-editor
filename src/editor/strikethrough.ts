import { tags } from "@lezer/highlight";
import type { DelimiterType, MarkdownConfig } from "@lezer/markdown";

/**
 * Strikethrough is EXACTLY two tildes: `~~x~~`. Registry row
 * `strike-double-tilde` (spec: markdown-dialect / 删除线只认两个波浪号) — a
 * declared difference from GitHub, which also strikes a single `~x~`; the user
 * chose Obsidian's reading (change: strike-marks).
 *
 * This replaces the library's `Strikethrough` (removed in `dialectParser.ts`).
 * The library also reads only `~~`, but it looks at two characters ahead and
 * never at the one before, so inside a run of three it starts a fresh `~~` one
 * character later: `~~~not~~~` came out struck. Here a tilde run is read whole:
 * a run of exactly two may open or close, any other length is plain text and
 * consumed in full (stepping one character would land inside the run again).
 *
 * Open / close follow the same flanking rule as `*` (and as the library), judged
 * on the characters just outside the run. Node names and highlight tags are the
 * library's, so styling, live-preview concealment and plain copy are unchanged.
 */

const TILDE = 126;

const StrikeDelim: DelimiterType = { resolve: "Strikethrough", mark: "StrikethroughMark" };

const PUNCTUATION = /[\p{P}\p{S}]/u;
const SPACE = /\s|^$/;

export const strikethrough: MarkdownConfig = {
  // The library's names and tags. Assembled after GFM, these definitions are
  // skipped (lezer ignores a node redefinition), so the node types are GFM's
  // either way; they are here so this parser does not depend on GFM's being on.
  defineNodes: [
    { name: "Strikethrough", style: { "Strikethrough/...": tags.strikethrough } },
    { name: "StrikethroughMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Strikethrough",
      parse(cx, next, pos) {
        if (next !== TILDE) return -1;
        let end = pos + 1;
        while (cx.char(end) === TILDE) end++;
        if (end - pos !== 2) return end; // one tilde, or three and more: text
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(end, end + 1);
        const sBefore = SPACE.test(before);
        const sAfter = SPACE.test(after);
        const pBefore = PUNCTUATION.test(before);
        const pAfter = PUNCTUATION.test(after);
        return cx.addDelimiter(
          StrikeDelim,
          pos,
          end,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter),
        );
      },
      after: "Emphasis",
    },
  ],
};
