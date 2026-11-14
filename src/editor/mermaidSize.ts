/**
 * How big a Mermaid diagram is, read off its source in one pass, without
 * Mermaid (change: mermaid-large-diagrams, design D2; spec: live-preview-editor
 * / Mermaid 图表渲染, 大图). The ONE definition of the size, the threshold above
 * which a diagram waits for the user, and the readable scale floor for wide
 * diagrams; `./mermaid.ts` re-exports them and every other module reads them
 * from there (gate: `mermaidSize.gate.test.ts`).
 *
 * A leaf with no imports on purpose: `scripts/measure-mermaid-render.mjs`
 * imports this file directly (node strips the types), so the numbers the
 * measurement reports are the editor's own.
 */

/**
 * Mermaid's link operators, one match per link: flowchart links (`-->`, `---`,
 * `-.->`, `==>`, `~~~`, with `x` / `o` / `<` ends and `|>`), and sequence arrows
 * (`->>`, `-->>`, `->`, `-x`, `-)`). Labels written `-- text -->` count twice:
 * the metric errs on the large side.
 */
const LINK = /<?(?:-{2,}|={2,}|~{3,}|-\.+-?|\.{2,})(?:>{1,2}|[xo)](?!\w)|\|>)?|-{1,2}(?:>{1,2}|x|\))/g;

/**
 * The diagram's size: its statements plus its links. The body is split on
 * newlines and `;`; blank pieces, `%%` comments (and `%%{init}%%` directives)
 * and the first remaining piece (the diagram header, `graph TD`) are dropped;
 * each piece left is one statement, plus one for every link in it, so
 * `A --> B --> C` is one statement and two links. Honest limit: an `&` fan-out
 * (`A & B --> C & D`, four edges) counts as one link.
 */
export function diagramSize(body: string): number {
  let size = 0;
  let header = true;
  for (const raw of body.split(/[\n;]/)) {
    const piece = raw.trim();
    if (!piece || piece.startsWith("%%")) continue;
    if (header) {
      header = false;
      continue;
    }
    size += 1 + (piece.match(LINK)?.length ?? 0);
  }
  return size;
}

/**
 * N: above this size a diagram is not rendered until the user asks (design D2,
 * D3). Chosen from `scripts/measure-mermaid-render.mjs` (2026-11-14, headless
 * Chrome 157, foreground and visible, background throttling off, Intel i9 Mac,
 * two runs): a flowchart costs about 2.5–3.5 ms of main-thread time per unit of
 * size, nearly linear and nearly independent of shape — size 200 → longest task
 * 0.42–0.70 s, size 400 → 0.84–1.30 s, size 800 → 1.8–2.7 s. The budget is a
 * 1 s longest task; 300 is the largest round size inside it for every measured
 * shape (sequence diagrams are about 4× cheaper and sit well inside it).
 */
export const LARGE_DIAGRAM_SIZE = 300;

/**
 * The readable floor for a WIDE diagram (design D5): it is scaled down to the
 * text column only this far — Mermaid's 16 px labels stay at 12 px — and
 * beyond that keeps this scale and scrolls sideways in its own box. Only a
 * diagram wider than tall gets the floor (`diagramFloorWidth`): a tall one
 * fitted to the column is as wide as the column and reads by scrolling the
 * page, so enlarging it would only make it taller (fixture (a), 6648 × 19664,
 * would become about 5000 × 14750 px).
 */
export const MIN_DIAGRAM_SCALE = 0.75;

/** A diagram's natural size, from its root SVG's viewBox; null without one. */
export function diagramViewBox(markup: string): { width: number; height: number } | null {
  const m = /viewBox="[-\d.e]+ [-\d.e]+ ([\d.e]+) ([\d.e]+)"/.exec(markup);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/**
 * The narrowest a diagram may be drawn: natural width × the floor for a wide
 * diagram (wider than tall), none for a tall or square one. The ONE place the
 * floor is applied; `MermaidWidget` writes it as the SVG's `min-width`.
 */
export function diagramFloorWidth(box: { width: number; height: number }): number | null {
  return box.width > box.height ? box.width * MIN_DIAGRAM_SCALE : null;
}

/**
 * The width a diagram of natural size `box` is shown at in a column of
 * `column` px: its own width when it fits; else the column, but never below
 * its floor (then it scrolls).
 */
export function shownDiagramWidth(box: { width: number; height: number }, column: number): number {
  if (box.width <= column) return box.width;
  return Math.max(column, diagramFloorWidth(box) ?? 0);
}
