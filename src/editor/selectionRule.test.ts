import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { atLeastAsSpecific, specificity } from "./cssSpecificity";
import {
  NATIVE_SELECTION_OFF,
  NATIVE_SELECTION_SELECTORS,
  SELECTION_SELECTOR_FOCUSED,
  SELECTION_SELECTOR_UNFOCUSED,
} from "./theme";

/**
 * Guards the cascade relationship this app got wrong (change: editor-theme-parity).
 *
 * CodeMirror ships its own selection colors in a baseTheme. If our rule is less
 * specific than CM's, ours never paints and CM's factory color does — silently,
 * with no error, and (as shipped) looking perfectly fine in light mode while
 * rendering near-white text on near-white lavender at 1.03:1 in dark mode.
 *
 * The selectors are read from the INSTALLED @codemirror/view rather than
 * hardcoded, so a CM upgrade that raises its own specificity re-fails this test
 * instead of silently taking the paint back.
 */

const require = createRequire(import.meta.url);
const cmSource = readFileSync(require.resolve("@codemirror/view"), "utf8");

/** CM resolves `&light` / `&dark` to a single generated class; `&` to the theme's. */
function resolveAmpersand(selector: string): string {
  return selector.replace(/&light|&dark/g, ".cm-themescope").replace(/&/g, ".cm-themescope");
}

/**
 * Pull CM's own selection-background rules out of its bundled baseTheme. Returns
 * the raw selector strings so a structural change upstream shows up as a count
 * mismatch rather than a quietly-skipped assertion.
 */
function cmSelectionSelectors(): string[] {
  const found = [...cmSource.matchAll(/"(&(?:light|dark)[^"]*\.cm-selectionBackground)"\s*:/g)].map(
    (m) => m[1],
  );
  if (found.length === 0) {
    throw new Error(
      "Could not find CodeMirror's .cm-selectionBackground baseTheme selectors — " +
        "the upstream shape changed; re-derive this guard before trusting it.",
    );
  }
  return found;
}

describe("selection rule vs CodeMirror's baseTheme", () => {
  it("finds CM's focused and unfocused selection rules", () => {
    const selectors = cmSelectionSelectors();
    // light/dark × focused/unfocused.
    expect(selectors).toHaveLength(4);
    expect(selectors.some((s) => s.includes(".cm-focused"))).toBe(true);
  });

  it("our focused rule is at least as specific as CM's, in every CM variant", () => {
    const ours = specificity(resolveAmpersand(SELECTION_SELECTOR_FOCUSED));

    for (const cm of cmSelectionSelectors()) {
      const theirs = specificity(resolveAmpersand(cm));
      expect(
        atLeastAsSpecific(ours, theirs),
        `ours ${JSON.stringify(ours)} must be >= CM's ${JSON.stringify(theirs)} for "${cm}" — ` +
          "app themes mount last, so a tie is enough, but losing means CM paints the selection.",
      ).toBe(true);
    }
  });

  it("our unfocused rule is at least as specific as CM's unfocused rules", () => {
    const ours = specificity(resolveAmpersand(`&${SELECTION_SELECTOR_UNFOCUSED}`));

    for (const cm of cmSelectionSelectors().filter((s) => !s.includes(".cm-focused"))) {
      expect(atLeastAsSpecific(ours, specificity(resolveAmpersand(cm)))).toBe(true);
    }
  });
});

/**
 * The native-selection half (change: selection-paint, design D1 / D4-5).
 *
 * `drawSelection()` ships `hideNativeSelection`: native selection transparent
 * inside `.cm-line` only, and FORCED to the system `Highlight` on any focused
 * descendant of `.cm-content`. Both `!important`. Everything in the content that
 * is not a line (block widgets, the gaps between lines, a focused part editor)
 * therefore painted in the OS accent colour. Our one rule must out-rank the
 * `Highlight` pair, read from the INSTALLED package so an upgrade that changes
 * the shape re-fails here instead of quietly painting orange again.
 */
function cmNativeSelectionBlock(): string {
  const m = cmSource.match(/const hideNativeSelection = [\s\S]*?\}\)\);/);
  if (!m) {
    throw new Error(
      "Could not find CodeMirror's hideNativeSelection theme — the upstream shape " +
        "changed; re-derive the native-selection guard before trusting it.",
    );
  }
  return m[0];
}

/** CM's `Highlight` selectors, resolved the way StyleModule nests them. */
const CM_FORCED_HIGHLIGHT = [
  ".cm-themescope .cm-content :focus::selection",
  ".cm-themescope .cm-content :focus ::selection",
];

describe("native selection rule vs CodeMirror's hideNativeSelection", () => {
  it("CM's hideNativeSelection still has the shape this guard knows", () => {
    const block = cmNativeSelectionBlock();
    expect(block).toContain('".cm-line"');
    expect(block).toContain('"& ::selection, &::selection": { backgroundColor: "transparent !important" }');
    expect(block).toContain('".cm-content"');
    expect(block).toContain('"& :focus"');
    expect(block).toContain('"&::selection, & ::selection"');
    expect(block).toContain('backgroundColor: "Highlight !important"');
    // No other native-selection rule anywhere in the package: the two selector
    // strings above, two `::selection` each.
    expect(cmSource.match(/::selection/g)).toHaveLength(4);
  });

  it("ours is !important (theirs is, and a normal declaration never beats that)", () => {
    expect(NATIVE_SELECTION_OFF.backgroundColor).toMatch(/^transparent !important$/);
  });

  it("covers the content element itself and everything inside it, focused or not", () => {
    const tails = NATIVE_SELECTION_SELECTORS.map((s) => s.replace(/^&\.cm-editor \.cm-content/, ""));
    expect(tails.sort()).toEqual(["::selection", " ::selection", " :focus::selection", " :focus ::selection"].sort());
  });

  it("each of CM's forced-Highlight selectors loses to ours on the same elements", () => {
    for (const cm of CM_FORCED_HIGHLIGHT) {
      const tail = cm.slice(".cm-themescope .cm-content".length);
      const ours = NATIVE_SELECTION_SELECTORS.find((s) => s.endsWith(`.cm-content${tail}`));
      expect(ours, `no selector of ours ends in "${tail}"`).toBeDefined();
      const a = specificity(resolveAmpersand(ours!));
      const b = specificity(cm);
      expect(
        atLeastAsSpecific(a, b) && a.join() !== b.join(),
        `ours ${JSON.stringify(a)} must be strictly above CM's ${JSON.stringify(b)} for "${cm}" — ` +
          "both are !important, and a tie would leave the winner to mount order.",
      ).toBe(true);
    }
  });
});
