import { describe, expect, it } from "vitest";
import { changedRange } from "./docDiff";

function apply(current: string, next: string): string {
  const r = changedRange(current, next);
  return r ? current.slice(0, r.from) + r.insert + current.slice(r.to) : current;
}

describe("changedRange", () => {
  it("is null for equal documents", () => {
    expect(changedRange("a\nb", "a\nb")).toBeNull();
  });

  it("an appended line touches only the end", () => {
    expect(changedRange("# T\n\none\n", "# T\n\none\ntwo\n")).toEqual({ from: 9, to: 9, insert: "two\n" });
  });

  it("a changed word touches only that word", () => {
    expect(changedRange("the quick fox", "the slow fox")).toEqual({ from: 4, to: 9, insert: "slow" });
  });

  it("handles deletion, prefix-only and suffix-only overlaps", () => {
    expect(changedRange("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
    expect(changedRange("abcabc", "abc")).toEqual({ from: 3, to: 6, insert: "" });
    expect(changedRange("", "x")).toEqual({ from: 0, to: 0, insert: "x" });
    expect(changedRange("x", "")).toEqual({ from: 0, to: 1, insert: "" });
  });

  it("never splits a surrogate pair", () => {
    // 😀 = D83D DE00, 😁 = D83D DE01: they share the high half.
    const r = changedRange("a😀b", "a😁b");
    expect(r).toEqual({ from: 1, to: 3, insert: "😁" });
  });

  it("always reproduces the new document", () => {
    const docs = ["", "a", "ab", "ba", "aaa", "a😀", "😀a", "😀😁", "line\nline\n", "x\ny\nz"];
    for (const a of docs) for (const b of docs) expect(apply(a, b)).toBe(b);
  });
});
