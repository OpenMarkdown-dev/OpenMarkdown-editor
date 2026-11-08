import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { linkTextIsEmpty, matchAgentTokens } from "./livePreview";
import { REVEAL_ON_TOUCH_NODES } from "./previewConceal";

describe("linkTextIsEmpty", () => {
  // `[](url)` — link node starts at `[` (index 0), the URL child at index 3.
  // The empty-text fallback (spec: 空文本链接不渲染为空白) fires exactly here.
  it("is true for an empty-text link `[](url)`", () => {
    // "[](url)": [ ] ( u ...  → linkFrom = 0, urlFrom = 3
    expect(linkTextIsEmpty(0, 3)).toBe(true);
  });

  it("is true regardless of the link's absolute offset", () => {
    // A `[](x)` starting at column 10: linkFrom = 10, urlFrom = 13.
    expect(linkTextIsEmpty(10, 13)).toBe(true);
  });

  it("is false for a one-char link text `[x](url)`", () => {
    // "[x](url)": [ x ] ( u ... → linkFrom = 0, urlFrom = 4
    expect(linkTextIsEmpty(0, 4)).toBe(false);
  });

  it("is false for a longer link text", () => {
    // "[note](url)": urlFrom = 7 → text span [1,5) is non-empty
    expect(linkTextIsEmpty(0, 7)).toBe(false);
  });
});

describe("matchAgentTokens", () => {
  it("matches a bare @agent followed by whitespace", () => {
    // "- [ ] " is 6 chars → `@agent` spans [6, 12).
    expect(matchAgentTokens("- [ ] @agent do the thing")).toEqual([{ from: 6, to: 12 }]);
  });

  it("matches a bare @agent at end of line", () => {
    expect(matchAgentTokens("ping @agent")).toEqual([{ from: 5, to: 11 }]);
  });

  it("matches the named form @agent(claude)", () => {
    // `@agent(claude)` spans [6, 20).
    expect(matchAgentTokens("- [ ] @agent(claude) draft")).toEqual([{ from: 6, to: 20 }]);
  });

  it("misses an email like @agent@x.com (followed by @)", () => {
    expect(matchAgentTokens("@agent@x.com")).toEqual([]);
  });

  it("misses @agentfoo (glued to a word run)", () => {
    expect(matchAgentTokens("@agentfoo")).toEqual([]);
  });

  it("misses a bare @", () => {
    expect(matchAgentTokens("@ is not a mention")).toEqual([]);
  });

  it("misses @agent glued to a preceding word (email local part)", () => {
    expect(matchAgentTokens("mail bob@agent")).toEqual([]);
  });

  it("misses the named form glued to a following word", () => {
    expect(matchAgentTokens("@agent(claude)draft")).toEqual([]);
  });

  it("finds multiple tokens on one line", () => {
    expect(matchAgentTokens("@agent and @agent(bo) too")).toEqual([
      { from: 0, to: 6 },
      { from: 11, to: 21 },
    ]);
  });
});

describe("REVEAL_ON_TOUCH_NODES", () => {
  // The undo landing (caret-rules R2a) steps past these; each must really be a
  // touch-revealed widget case in the renderer, or the landing reads a stale list.
  it("names only nodes the renderer replaces with a touch-revealed widget", () => {
    const src = readFileSync(join(__dirname, "livePreview.ts"), "utf8");
    for (const name of REVEAL_ON_TOUCH_NODES) {
      const at = src.indexOf(`case "${name}": {`);
      expect(at, name).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf("case ", at + 6));
      expect(body, name).toMatch(/touches\(node\.from, node\.to\)/);
      expect(body, name).toMatch(/Decoration\.replace/);
    }
  });
});
