import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";
import { INLINE_RESET, INLINE_RESET_SELECTOR, PRIMITIVE_STYLES } from "./primitives";

/**
 * Gate (spec: live-preview-editor / 行内部件不继承行级排版; change:
 * editor-style-contract, design D2). An inline widget (math, a chip, an image
 * frame, the marker box: anything inline-block / inline-flex) is a block
 * container of its own, so a line's inherited `text-indent` — a list item's
 * hanging first row — indents it AGAIN inside itself: inline math in a list
 * item overlapped the text before it. The fix is ONE rule in the editor's
 * primitives that zeroes it on every element inside a line, so no widget can
 * forget it. This gate holds that shape:
 *
 *   - the rule exists, covers every descendant of a line, at zero specificity;
 *   - no other editor style writes `textIndent` except the line's own indent
 *     (`.cm-line.om-list-marker-line`, insets/decorate.ts) and the table reset
 *     beside the rule (primitives.ts) — a per-widget `textIndent: "0"` would be
 *     a second copy, the patch this rule replaces.
 *
 * HONEST LIMITS: lexical (a `text-indent` built at runtime is not seen). The
 * consumer smoke (`scripts/check-editor-consumer.mjs`) checks the rendered
 * result: every atomic inline in a list item computes `text-indent: 0px`.
 */

const SRC = join(process.cwd(), "src/editor");

/** Where a text-indent may be written, each with its reason. */
const ALLOWED: Record<string, string> = {
  "primitives.ts": "the inline reset itself (INLINE_RESET) and the table reset beside it",
  "insets/decorate.ts": "the list marker line's own hanging indent — the value the reset keeps out of widgets",
};

describe("the inline reset", () => {
  it("is one rule over every element inside a line, at zero specificity", () => {
    expect(INLINE_RESET_SELECTOR).toBe(":where(&) :where(.cm-line *)");
    expect(PRIMITIVE_STYLES[INLINE_RESET_SELECTOR]).toBe(INLINE_RESET);
    expect(INLINE_RESET).toEqual({ textIndent: "0" });
  });

  it("no other editor style writes a text-indent", () => {
    const stray: string[] = [];
    const used = new Set<string>();
    for (const abs of listFiles(SRC, { include: /\.ts$/, exclude: /\.test\.ts$/ })) {
      const rel = repoPath(SRC, abs);
      readFileSync(abs, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
          if (!/\btextIndent\s*:|text-indent\s*:/.test(line)) return;
          if (Object.hasOwn(ALLOWED, rel)) used.add(rel);
          else stray.push(`src/editor/${rel}:${i + 1}`);
        });
    }
    expect(stray).toEqual([]);
    // No dead entries.
    expect([...used].sort()).toEqual(Object.keys(ALLOWED).sort());
  });
});
