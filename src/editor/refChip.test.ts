import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  shouldConcealUrl,
  chipLabel,
  isRefExpanded,
  expandedRefField,
  setExpandedRef,
} from "./refChip";

describe("shouldConcealUrl", () => {
  it("chips URLs longer than the threshold", () => {
    expect(shouldConcealUrl("https://a.co")).toBe(false); // short
    expect(
      shouldConcealUrl("https://github.com/org/repo/releases/latest/download/x.json"),
    ).toBe(true);
  });
  it("honours a custom threshold", () => {
    expect(shouldConcealUrl("abcdef", 3)).toBe(true);
    expect(shouldConcealUrl("ab", 3)).toBe(false);
  });
});

describe("chipLabel", () => {
  it("uses host + first path segment for http(s) URLs", () => {
    expect(
      chipLabel(
        "https://github.com/OpenMarkdown-dev/OpenMarkdown-releases/releases/latest/download/latest.json",
      ),
    ).toBe("github.com/OpenMarkdown-dev/…");
    expect(chipLabel("https://github.com/org/repo/blob/main/x.md")).toBe("github.com/org/…");
  });
  it("shows the single path segment with no trailing ellipsis", () => {
    expect(chipLabel("http://example.com:8080/path")).toBe("example.com:8080/path");
  });
  it("falls back to the host when there is no path", () => {
    expect(chipLabel("https://github.com")).toBe("github.com");
    expect(chipLabel("https://github.com/")).toBe("github.com");
  });
  it("bounds an over-long first path segment", () => {
    const label = chipLabel("https://x.com/thisissomeverylongfirstsegmentindeed/more");
    expect(label.startsWith("x.com/")).toBe(true);
    expect(label.includes("…")).toBe(true);
    // host + "/" + (≤18-char first seg) + "/…"
    expect(label.length).toBeLessThanOrEqual("x.com/".length + 18 + "/…".length);
  });
  it("labels data URLs compactly", () => {
    expect(chipLabel("data:image/png;base64,AAonglongbase64")).toBe("data:…");
  });
  it("uses the trailing segment for local paths", () => {
    expect(chipLabel("attachments/pic.png")).toBe("pic.png");
    expect(chipLabel("./a/b/c.png")).toBe("c.png");
  });
  it("truncates very long local labels", () => {
    const label = chipLabel("a-very-very-very-long-file-name-indeed.png");
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBe(24);
  });
});

describe("isRefExpanded", () => {
  it("matches by the reference start", () => {
    expect(isRefExpanded({ from: 4, to: 12 }, 4)).toBe(true);
    expect(isRefExpanded({ from: 4, to: 12 }, 5)).toBe(false);
    expect(isRefExpanded(null, 4)).toBe(false);
    expect(isRefExpanded(undefined, 4)).toBe(false);
  });
});

describe("expandedRefField", () => {
  const base = EditorState.create({
    doc: "abc [x](url) def",
    extensions: [expandedRefField],
  });

  it("stores the expanded ref set via effect", () => {
    const s = base.update({
      effects: setExpandedRef.of({ from: 4, to: 12 }),
      selection: { anchor: 8 },
    }).state;
    expect(s.field(expandedRefField)).toEqual({ from: 4, to: 12 });
  });

  it("collapses when the selection leaves the ref range", () => {
    const expanded = base.update({
      effects: setExpandedRef.of({ from: 4, to: 12 }),
      selection: { anchor: 8 },
    }).state;
    const collapsed = expanded.update({ selection: { anchor: 0 } }).state;
    expect(collapsed.field(expandedRefField)).toBeNull();
  });

  it("remaps positions through doc changes while staying expanded", () => {
    const expanded = base.update({
      effects: setExpandedRef.of({ from: 4, to: 12 }),
      selection: { anchor: 8 },
    }).state;
    const shifted = expanded.update({
      changes: { from: 0, insert: "XX" },
      selection: { anchor: 10 },
    }).state;
    expect(shifted.field(expandedRefField)).toEqual({ from: 6, to: 14 });
  });
});
