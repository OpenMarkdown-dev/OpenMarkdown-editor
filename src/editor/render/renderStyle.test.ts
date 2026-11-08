import { describe, expect, it } from "vitest";
import { DOC_CLASS, renderStylesheet } from "./renderStyle";
import { EDITOR_TOKENS, TYPE_SCALE, tokenDefault, tokenProperty, type EditorToken } from "../tokens";

/**
 * Gate (spec: render-style / 样式只有一个来源): outside the token declarations
 * on `.om-doc`, the stylesheet writes no colour and no font family of its own —
 * only `var(--ome-*)` — and every font size and line height is an entry of
 * TYPE_SCALE.
 */
const css = renderStylesheet("light");
const [declBlock, ...rest] = css.split(/\n(?=\.om-doc \{\n  background)/);
const rulesText = rest.join("\n");

describe("render stylesheet", () => {
  it("declares every token's light default once, on the document class", () => {
    for (const token of Object.keys(EDITOR_TOKENS) as EditorToken[]) {
      expect(declBlock).toContain(`${tokenProperty(token)}: ${tokenDefault(token, "light")};`);
    }
    expect(declBlock.startsWith(`/* Generated`)).toBe(true);
    expect(declBlock).toContain(`.${DOC_CLASS} {`);
  });

  it("writes no colour literal outside the token declarations", () => {
    expect(rulesText.length).toBeGreaterThan(0);
    expect(rulesText).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix)\(/);
    expect(rulesText).not.toMatch(/:\s*(?:white|black|red|blue|gray|grey)\b/);
  });

  it("writes no font family of its own", () => {
    for (const m of rulesText.matchAll(/font-family:\s*([^;]+);/g)) expect(m[1]).toMatch(/^var\(--ome-font(?:-mono)?\)$/);
  });

  it("takes every font size and line height from the type scale", () => {
    const scale = new Set<string>([
      TYPE_SCALE.body.fontSize,
      TYPE_SCALE.body.lineHeight,
      TYPE_SCALE.code.fontSize,
      ...TYPE_SCALE.headings.flatMap((h): string[] => [h.fontSize, h.lineHeight].filter((x): x is NonNullable<typeof x> => x !== null)),
    ]);
    for (const m of rulesText.matchAll(/(?:font-size|line-height):\s*([^;]+);/g)) expect(scale.has(m[1]), m[1]).toBe(true);
  });

  it("an auto sheet carries the dark half under prefers-color-scheme", () => {
    const auto = renderStylesheet("auto");
    expect(auto).toContain("@media (prefers-color-scheme: dark)");
    expect(auto).toContain(`${tokenProperty("bg")}: ${tokenDefault("bg", "dark")};`);
  });
});
