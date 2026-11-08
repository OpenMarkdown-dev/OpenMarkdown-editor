import { describe, expect, it } from "vitest";
import { parseCallout, parseCalloutType, calloutTitle, CALLOUT_TYPES } from "./callout";

describe("parseCalloutType", () => {
  it("recognizes all five GitHub types", () => {
    expect(parseCalloutType("[!NOTE]")).toBe("note");
    expect(parseCalloutType("[!TIP]")).toBe("tip");
    expect(parseCalloutType("[!IMPORTANT]")).toBe("important");
    expect(parseCalloutType("[!WARNING]")).toBe("warning");
    expect(parseCalloutType("[!CAUTION]")).toBe("caution");
  });

  it("is case-insensitive on the type keyword, returning canonical lowercase", () => {
    expect(parseCalloutType("[!note]")).toBe("note");
    expect(parseCalloutType("[!Note]")).toBe("note");
    expect(parseCalloutType("[!wArNiNg]")).toBe("warning");
  });

  it("tolerates surrounding whitespace but requires the marker alone on the line", () => {
    expect(parseCalloutType("  [!TIP]")).toBe("tip");
    expect(parseCalloutType("[!WARNING]   ")).toBe("warning");
    expect(parseCalloutType("\t[!NOTE]\t")).toBe("note");
  });

  it("rejects a marker with trailing content (GitHub: not an alert)", () => {
    expect(parseCalloutType("[!NOTE] extra title")).toBeNull();
    expect(parseCalloutType("[!TIP] here is a tip")).toBeNull();
  });

  it("rejects unknown types", () => {
    expect(parseCalloutType("[!FOOBAR]")).toBeNull();
    expect(parseCalloutType("[!INFO]")).toBeNull();
    expect(parseCalloutType("[!]")).toBeNull();
  });

  it("rejects plain blockquote text", () => {
    expect(parseCalloutType("just a quote")).toBeNull();
    expect(parseCalloutType("")).toBeNull();
    expect(parseCalloutType("NOTE: not bracketed")).toBeNull();
    expect(parseCalloutType("[NOTE]")).toBeNull(); // missing `!`
  });
});

describe("calloutTitle", () => {
  it("capitalizes the canonical keyword for each type", () => {
    expect(calloutTitle("note")).toBe("Note");
    expect(calloutTitle("tip")).toBe("Tip");
    expect(calloutTitle("important")).toBe("Important");
    expect(calloutTitle("warning")).toBe("Warning");
    expect(calloutTitle("caution")).toBe("Caution");
  });

  it("covers every declared type", () => {
    for (const t of CALLOUT_TYPES) {
      expect(calloutTitle(t)).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});

describe("parseCallout — the suffix (registry row callout-fold; recognised, never folded)", () => {
  it("reads a `-` or `+` glued to `]` as part of the marker", () => {
    expect(parseCallout("[!note]-")).toEqual({ type: "note", suffix: "-" });
    expect(parseCallout("[!NOTE]+")).toEqual({ type: "note", suffix: "+" });
    expect(parseCallout("  [!tip]-  ")).toEqual({ type: "tip", suffix: "-" });
    expect(parseCallout("[!warning]")).toEqual({ type: "warning", suffix: null });
  });

  it("requires the suffix glued to `]` and alone", () => {
    for (const t of ["[!note] -", "[!note]--", "[!note]- 标题", "[!note]+-", "[!note]-x"]) {
      expect(parseCallout(t), t).toBeNull();
      expect(parseCalloutType(t), t).toBeNull();
    }
  });
});
