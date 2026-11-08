/**
 * How the renderer draws each row of the `markdown-dialect` register (spec:
 * markdown-render / 方言登记表每行都有渲染规则; change: render-export).
 *
 * One entry per register id. `shows` is what the row's own fixture
 * (`fixtures/dialect/<id>.md`) must contain once rendered — the gate
 * `render.gate.test.ts` renders every fixture and checks it, and fails when the
 * register gains a row this table does not have (or keeps a row the register
 * dropped). The rule itself lives in `./renderHtml.ts`; `where` names it.
 */
export interface DialectRender {
  /** Where in `renderHtml.ts` the rule is. */
  where: string;
  /** A pattern the rendered fixture must match. */
  shows: RegExp;
  /** A pattern the rendered fixture must NOT match (a narrower-than-GFM row). */
  never?: RegExp;
}

export const DIALECT_RENDER: Record<string, DialectRender> = {
  callout: { where: "Renderer.blockquote", shows: /<div class="om-callout om-callout-note">/ },
  "callout-fold": {
    where: "Renderer.blockquote (parseCallout reads the fold mark; nothing folds)",
    shows: /<div class="om-callout om-callout-tip">/,
    never: /<(?:blockquote|p)>\s*\[!tip\]\+/,
  },
  math: { where: "Renderer.inlineNode InlineMath / Renderer.blockMath", shows: /<span class="om-math"><math/ },
  "agent-mention": { where: "Renderer.textRun", shows: /<span class="om-agent">@agent\(reviewer\)<\/span>/ },
  frontmatter: { where: "Renderer.frontmatter", shows: /<table class="om-props">/ },
  "image-size": { where: "Renderer.link (image)", shows: /<img src="[^"]+" alt="方块" width="120" height="60">/ },
  "strike-double-tilde": {
    where: "Renderer.inlineNode Strikethrough (the dialect grammar strikes only `~~x~~`)",
    shows: /<del>划掉<\/del>/,
    never: /<del>there<\/del>|<del>2<\/del>|<del>not<\/del>/,
  },
  mermaid: { where: "Renderer.fenced (drawn by the caller's diagram renderer)", shows: /<figure class="om-mermaid">[^]*id="om-mermaid-1"/ },
};
