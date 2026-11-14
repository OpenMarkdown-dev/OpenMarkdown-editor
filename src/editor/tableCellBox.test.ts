import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TABLE_CELL_BOX } from "./tokens";
import { renderStylesheet } from "./render/renderStyle";

/**
 * Gate (spec: live-preview-editor / 空单元格保有可点的最小尺寸; change:
 * render-placeholder-size, design D7). The cell box is ONE constant,
 * `TABLE_CELL_BOX`; the editor theme's and the exported stylesheet's cell rules
 * both carry it. A second hand-written cell padding, or a rule missing the
 * floor, fails. Limits: the theme is read as text (its rule object is inline in
 * `EditorView.theme`); the export is checked on its generated CSS.
 */
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe("the table cell box is defined once", () => {
  it("states a floor: about three characters wide, one line tall", () => {
    expect(TABLE_CELL_BOX.minWidth).toBe("3ch");
    expect(TABLE_CELL_BOX.height).toMatch(/1lh/);
  });

  it("is border-box itself, so the floor includes the padding in the export too", () => {
    // The editor gets border-box from its primitives; the exported document has
    // no such reset, so the box states it (the export rule test carries it).
    expect((TABLE_CELL_BOX as Record<string, string>).boxSizing).toBe("border-box");
  });

  it("the editor theme's cell rule spreads the constant and writes no padding of its own", () => {
    const theme = readFileSync(join(__dirname, "theme.ts"), "utf8");
    const at = theme.indexOf('".om-table th, .om-table td": {');
    expect(at).toBeGreaterThan(-1);
    const body = theme.slice(at, theme.indexOf("\n  },", at));
    expect(body).toContain("...TABLE_CELL_BOX");
    expect(body).not.toMatch(/\b(padding|minWidth|height)\s*:/);
  });

  it("the exported document's cell rule carries every value of the constant", () => {
    const css = renderStylesheet("light");
    const m = /\.[\w-]+ th, \.[\w-]+ td \{([^}]*)\}/.exec(css);
    expect(m).not.toBeNull();
    for (const [k, v] of Object.entries(TABLE_CELL_BOX)) expect(m![1]).toContain(`${kebab(k)}: ${v};`);
    expect(m![1].match(/padding:/g)).toHaveLength(1);
  });
});
