import { describe, expect, it } from "vitest";
import { HSCROLL_STYLE, hscrollState } from "./hscroll";

describe("hscrollState — which edges have content past them", () => {
  it("no overflow: no cue", () => {
    expect(hscrollState(0, 300, 300)).toBe("");
    // sub-pixel layout rounding is not overflow
    expect(hscrollState(0, 300.8, 300)).toBe("");
  });

  it("at the start of a wide block: content past the end only", () => {
    expect(hscrollState(0, 600, 300)).toBe("end");
    expect(hscrollState(0.6, 600, 300)).toBe("end");
  });

  it("in the middle: both edges", () => {
    expect(hscrollState(150, 600, 300)).toBe("both");
  });

  it("scrolled to the end: content past the start only (1px tolerance)", () => {
    expect(hscrollState(300, 600, 300)).toBe("start");
    expect(hscrollState(299.4, 600, 300)).toBe("start");
  });

  it("negative scrollLeft (RTL hosts) reads as distance from the start", () => {
    expect(hscrollState(-150, 600, 300)).toBe("both");
    expect(hscrollState(-300, 600, 300)).toBe("start");
  });
});

describe("HSCROLL_STYLE — the one style for a sideways-scrolling block", () => {
  it("scrolls sideways only", () => {
    expect(HSCROLL_STYLE.overflowX).toBe("auto");
    expect(HSCROLL_STYLE).not.toHaveProperty("overflowY");
  });

  it("fades exactly the edges that have content past them, with a mask (no host colour assumed)", () => {
    const fade = (state: string) => (HSCROLL_STYLE as Record<string, unknown>)[`&[data-hscroll="${state}"]`] as Record<string, string>;
    expect(fade("end").maskImage).toMatch(/to right.*transparent\)$/);
    expect(fade("start").maskImage).toMatch(/to right, transparent/);
    expect(fade("both").maskImage).toMatch(/to right, transparent.*transparent\)$/);
    for (const s of ["start", "end", "both"]) {
      expect(fade(s).WebkitMaskImage).toBe(fade(s).maskImage);
      expect(JSON.stringify(fade(s))).not.toMatch(/background|pointer/i);
    }
  });
});
