import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_DIAGRAM_SCALE, diagramFloorWidth, diagramSize, diagramViewBox, shownDiagramWidth } from "./mermaidSize";

/** Spec: live-preview-editor / Mermaid 图表渲染, 大图 and 宽图 (change: mermaid-large-diagrams). */
describe("diagramSize — statements plus links, one pass", () => {
  it("a chain on one line is one statement and one link per arrow", () => {
    expect(diagramSize("graph TD\n  A --> B --> C")).toBe(3);
  });

  it("`;` separates statements; the header is not one", () => {
    expect(diagramSize("graph TD; A-->B; B-->C")).toBe(4);
  });

  it("skips blank lines, %% comments and %%{init}%% directives", () => {
    expect(diagramSize('%%{init: {"theme": "dark"}}%%\ngraph LR\n\n  %% a comment\n  A --> B\n')).toBe(2);
  });

  it("counts every flowchart link form once", () => {
    for (const l of ["A -.-> B", "A ==> B", "A ~~~ B", "A --x B", "A --o B", "A <--> B", "my-node --> B", "A --- B", "A -->|label| B"]) {
      expect(diagramSize(`graph\n${l}`), l).toBe(2);
    }
  });

  it("counts sequence arrows", () => {
    expect(diagramSize("sequenceDiagram\n  participant A\n  A->>B: hi\n  B-->>A: yo\n  A-xB: no\n  A-)B: x\n  A->B: plain")).toBe(1 + 5 * 2);
  });

  it("an undercount it states: an & fan-out is one link", () => {
    expect(diagramSize("graph TD\n  A & B --> C & D")).toBe(2);
  });
});

describe("wide diagrams: shrink to the column down to the floor, then scroll (design D5)", () => {
  it("reads the natural size off the viewBox", () => {
    expect(diagramViewBox('<svg viewBox="-9.1 0 6647.9 19664" width="100%">')).toEqual({ width: 6647.9, height: 19664 });
    expect(diagramViewBox("<svg>")).toBeNull();
  });

  it("narrow → natural; wide → the column; very wide → the floor", () => {
    expect(shownDiagramWidth({ width: 400, height: 300 }, 656)).toBe(400);
    expect(shownDiagramWidth({ width: 800, height: 300 }, 656)).toBe(656);
    expect(shownDiagramWidth({ width: 20107, height: 362 }, 656)).toBeCloseTo(20107 * MIN_DIAGRAM_SCALE);
    // Exactly at the floor: the column.
    expect(shownDiagramWidth({ width: 656 / MIN_DIAGRAM_SCALE, height: 100 }, 656)).toBeCloseTo(656);
  });

  it("a tall diagram is fitted to the column, never enlarged by the floor (fixture (a): 6648 × 19664)", () => {
    const tall = { width: 6648, height: 19664 };
    expect(diagramFloorWidth(tall)).toBeNull();
    expect(shownDiagramWidth(tall, 656)).toBe(656);
    // Square counts as tall: the floor is for diagrams wider than tall.
    expect(diagramFloorWidth({ width: 2000, height: 2000 })).toBeNull();
    // The wide one (mermaid-wide.md's 120 leaves) keeps the floor.
    expect(diagramFloorWidth({ width: 19690, height: 260 })).toBeCloseTo(19690 * MIN_DIAGRAM_SCALE);
  });

  it("keeps Mermaid's 16 px labels readable (12 px at the floor)", () => {
    expect(16 * MIN_DIAGRAM_SCALE).toBe(12);
  });
});

describe("the fixtures sit on the side of the threshold they are named for", () => {
  const fences = (path: string) =>
    [...readFileSync(join(process.cwd(), path), "utf8").matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m) => m[1]);

  it("mermaid-wide.md: all small", () => {
    expect(fences("fixtures/rendering/mermaid-wide.md").map(diagramSize)).toEqual([241, 11, 4]);
  });
});
