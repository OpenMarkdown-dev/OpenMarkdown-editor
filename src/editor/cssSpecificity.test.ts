import { describe, expect, it } from "vitest";
import { atLeastAsSpecific, specificity } from "./cssSpecificity";

describe("specificity", () => {
  it("counts classes and combinators", () => {
    expect(specificity(".a.b")).toEqual([0, 2, 0]);
    expect(specificity(".a > .b .c")).toEqual([0, 3, 0]);
    expect(specificity(".a.b > .c > .d .e")).toEqual([0, 5, 0]);
  });

  it("scores attribute selectors in the class column", () => {
    expect(specificity("li[aria-selected]")).toEqual([0, 1, 1]);
    // An attribute VALUE containing a dot must not be miscounted as a class.
    expect(specificity('a[href="x.y"]')).toEqual([0, 1, 1]);
  });

  it("separates pseudo-classes (class column) from pseudo-elements (type column)", () => {
    expect(specificity(".a:hover")).toEqual([0, 2, 0]);
    expect(specificity(".a::before")).toEqual([0, 1, 1]);
  });

  it("counts a pseudo-class that sits next to a pseudo-element (change: selection-paint)", () => {
    expect(specificity(".a:focus::selection")).toEqual([0, 2, 1]);
    expect(specificity(".a:hover::before")).toEqual([0, 2, 1]);
    expect(specificity(".a :focus ::selection")).toEqual([0, 2, 1]);
  });

  it("counts ids and element names", () => {
    expect(specificity("#root .a div")).toEqual([1, 1, 1]);
    expect(specificity("ul > li")).toEqual([0, 0, 2]);
  });

  it("scores the two selectors this change turns on", () => {
    // CodeMirror's baseTheme rule, once `&light` resolves to a class.
    expect(
      specificity(".cm-light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground"),
    ).toEqual([0, 5, 0]);
    // The naive app rule it used to beat.
    expect(specificity(".cm-theme.cm-focused .cm-selectionBackground")).toEqual([0, 3, 0]);
  });
});

describe("atLeastAsSpecific", () => {
  it("is true on a tie (the cascade then falls to mount order, which favours app themes)", () => {
    expect(atLeastAsSpecific([0, 5, 0], [0, 5, 0])).toBe(true);
  });

  it("compares左到右, most significant column first", () => {
    expect(atLeastAsSpecific([0, 5, 0], [0, 3, 0])).toBe(true);
    expect(atLeastAsSpecific([0, 3, 0], [0, 5, 0])).toBe(false);
    expect(atLeastAsSpecific([1, 0, 0], [0, 9, 9])).toBe(true);
    expect(atLeastAsSpecific([0, 2, 5], [0, 2, 3])).toBe(true);
  });
});
