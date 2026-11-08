import { describe, expect, it } from "vitest";
import { parseBracketTrigger, parseLinkContext } from "./linkComplete";

describe("parseLinkContext", () => {
  it("file mode right after ](", () => {
    expect(parseLinkContext("see [note](")).toEqual({ mode: "file", query: "" });
  });

  it("file mode with a partial path typed", () => {
    expect(parseLinkContext("see [note](sub/fo")).toEqual({ mode: "file", query: "sub/fo" });
  });

  it("heading mode after ](#", () => {
    expect(parseLinkContext("[go](#")).toEqual({ mode: "heading", query: "" });
  });

  it("heading mode with a partial heading typed", () => {
    expect(parseLinkContext("[go](#Summ")).toEqual({ mode: "heading", query: "Summ" });
  });

  it("plain text does not trigger", () => {
    expect(parseLinkContext("just some prose")).toBeNull();
  });

  it("bare bracket without ( does not trigger", () => {
    expect(parseLinkContext("[label]")).toBeNull();
  });

  it("a closed link target does not trigger", () => {
    // Cursor sits after the closing ) — no open span.
    expect(parseLinkContext("[a](x.md)")).toBeNull();
  });

  it("cross-document path#frag is out of scope (null)", () => {
    expect(parseLinkContext("[a](plan.md#dec")).toBeNull();
  });

  it("uses only the most recent open span on the line", () => {
    // Earlier completed link, then a fresh open one.
    expect(parseLinkContext("[a](x.md) and [b](y")).toEqual({ mode: "file", query: "y" });
  });
});

describe("parseBracketTrigger", () => {
  it("half-width [[ triggers with an empty query", () => {
    expect(parseBracketTrigger("some prose [[")).toEqual({ query: "" });
  });

  it("captures the query typed after [[", () => {
    expect(parseBracketTrigger("[[oth")).toEqual({ query: "oth" });
  });

  it("full-width 【【 triggers the same (IME users)", () => {
    expect(parseBracketTrigger("正文 【【")).toEqual({ query: "" });
    expect(parseBracketTrigger("【【笔记")).toEqual({ query: "笔记" });
  });

  it("mixed half/full brackets also trigger", () => {
    expect(parseBracketTrigger("[【")).toEqual({ query: "" });
    expect(parseBracketTrigger("【[a")).toEqual({ query: "a" });
  });

  it("a single open bracket does not trigger", () => {
    expect(parseBracketTrigger("just [one")).toBeNull();
    expect(parseBracketTrigger("【half")).toBeNull();
  });

  it("plain prose does not trigger", () => {
    expect(parseBracketTrigger("no brackets here")).toBeNull();
  });

  it("a closing bracket in the query ends the trigger", () => {
    // `[[a]` — the query stops at `]`, so the cursor is no longer in a trigger.
    expect(parseBracketTrigger("[[a]")).toBeNull();
  });
});
