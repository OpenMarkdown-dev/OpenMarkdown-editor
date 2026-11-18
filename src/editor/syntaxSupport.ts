/**
 * The Markdown the editor supports, as data: one entry per syntax, each with
 * test vectors (change: editor-dialect; spec: markdown-dialect / 语法支持表由测试
 * 向量生成).
 *
 * This list is the ONE definition of "what the editor reads". Three things are
 * made from it and cannot drift from it:
 *   - the gate `syntaxSupport.gate.test.ts` renders every vector with the one
 *     renderer (`render/renderHtml.ts`, which reads the editor's own grammar,
 *     `dialectParser.ts`) and fails when the output is not the vector's `html`;
 *     the inline formula vectors are also read by the table cell renderer;
 *   - the syntax page of the editor docs (`packages/editor/docs/guides/syntax.md`)
 *     holds the tables `syntaxTables()` writes, between its two markers; the
 *     gate fails when they differ (rewrite them with
 *     `UPDATE_SYNTAX_TABLE=1 npx vitest run src/editor/syntaxSupport.gate.test.ts`);
 *   - every row of the `markdown-dialect` register (the writings that differ
 *     from CommonMark + GFM) is named by at least one entry's `dialect`, and
 *     no entry names a row the register does not have.
 *
 * `html` is the renderer's output with formulas drawn as `<math>TeX</math>`
 * (`<math display="block">` for block math), a single paragraph unwrapped and
 * the math wrappers dropped (`normalizeRendered` in the gate). What the live
 * preview shows follows the same tree: it hides the marks the renderer drops.
 */

export type Support = "rendered" | "source";

export interface SyntaxVector {
  /** The Markdown source. */
  md: string;
  /** What it renders as (see the module comment for the normal form). */
  html: string;
}

export interface SyntaxEntry {
  /** A stable id, unique. */
  id: string;
  /** The group the docs table puts it in. */
  group: "CommonMark" | "GFM" | "Extensions" | "Not supported";
  /** Its name in the docs table. */
  name: string;
  /** A one-line example for the docs table (a vector's source, usually). */
  example: string;
  /** Rendered in place, or shown as written. */
  support: Support;
  /** The `markdown-dialect` register row this entry is, when it differs from CommonMark + GFM. */
  dialect?: string;
  /** One line for the docs table. */
  note: string;
  vectors: SyntaxVector[];
  /** Vectors of this entry go in the docs' math delimiter table. */
  mathTable?: boolean;
}

export const SYNTAX: readonly SyntaxEntry[] = [
  // --- CommonMark -------------------------------------------------------------
  {
    id: "heading",
    group: "CommonMark",
    name: "Headings",
    example: "# Title",
    support: "rendered",
    note: "ATX (`#` to `######`) and setext (a line underlined with `=` or `-`). Headings get GitHub-style anchor ids.",
    vectors: [
      { md: "# Title", html: '<h1 id="title">Title</h1>' },
      { md: "Title\n=====", html: '<h1 id="title">Title</h1>' },
    ],
  },
  {
    id: "emphasis",
    group: "CommonMark",
    name: "Emphasis and strong",
    example: "*em* **strong**",
    support: "rendered",
    note: "`*` and `_`. The marks hide when the caret is elsewhere.",
    vectors: [{ md: "*em* **strong** _em_ __strong__", html: "<em>em</em> <strong>strong</strong> <em>em</em> <strong>strong</strong>" }],
  },
  {
    id: "code-span",
    group: "CommonMark",
    name: "Code spans",
    example: "`code`",
    support: "rendered",
    note: "Nothing inside a code span is Markdown, dollar signs included.",
    vectors: [{ md: "`$x$` and `**a**`", html: "<code>$x$</code> and <code>**a**</code>" }],
  },
  {
    id: "link",
    group: "CommonMark",
    name: "Links",
    example: "[text](https://example.com)",
    support: "rendered",
    note: "Inline, reference (`[text][ref]`) and autolinks (`<https://…>`). A `[label]` with no definition stays text, brackets visible.",
    vectors: [
      { md: "[text](https://example.com)", html: '<a href="https://example.com">text</a>' },
      { md: "[text][r]\n\n[r]: https://example.com", html: '<a href="https://example.com">text</a>' },
      { md: "see [foo] here", html: "see [foo] here" },
    ],
  },
  {
    id: "image",
    group: "CommonMark",
    name: "Images",
    example: "![alt](cat.png)",
    support: "rendered",
    note: "Local paths go through the host's `resolveImage`. See also image size below.",
    vectors: [{ md: "![alt](cat.png)", html: '<img src="cat.png" alt="alt">' }],
  },
  {
    id: "list",
    group: "CommonMark",
    name: "Lists",
    example: "- item / 1. item",
    support: "rendered",
    note: "Bullet (`-`, `*`, `+`) and ordered (`1.`, `1)`) lists, nested to any depth.",
    vectors: [
      { md: "- a\n- b", html: "<ul>\n<li>a</li>\n<li>b</li>\n</ul>" },
      { md: "3. a\n4. b", html: '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>' },
    ],
  },
  {
    id: "blockquote",
    group: "CommonMark",
    name: "Block quotes",
    example: "> quoted",
    support: "rendered",
    note: "",
    vectors: [{ md: "> quoted", html: "<blockquote>\n<p>quoted</p>\n</blockquote>" }],
  },
  {
    id: "code-block",
    group: "CommonMark",
    name: "Code blocks",
    example: "```ts … ```",
    support: "rendered",
    note: "Fenced (with syntax highlighting by info string) and indented.",
    vectors: [{ md: "```ts\nlet a = 1\n```", html: '<pre class="om-code"><code class="language-ts">let a = 1</code></pre>' }],
  },
  {
    id: "thematic-break",
    group: "CommonMark",
    name: "Thematic breaks",
    example: "***",
    support: "rendered",
    note: "Three or more `*`, `-` or `_` on a line of their own.",
    vectors: [{ md: "a\n\n***\n\nb", html: "<p>a</p>\n<hr>\n<p>b</p>" }],
  },
  {
    id: "escape",
    group: "CommonMark",
    name: "Backslash escapes",
    example: "\\*not emphasis\\*",
    support: "rendered",
    note: "The backslash hides when the caret is elsewhere and in reading mode, like other marks; the source keeps it.",
    vectors: [
      { md: "\\*not emphasis\\*", html: "*not emphasis*" },
      { md: "\\# not a heading", html: "# not a heading" },
    ],
  },
  {
    id: "entity",
    group: "CommonMark",
    name: "Entity references",
    example: "&amp; &copy;",
    support: "rendered",
    note: "",
    vectors: [{ md: "&amp; &copy;", html: "&amp; &copy;" }],
  },
  {
    id: "html",
    group: "CommonMark",
    name: "Raw HTML",
    example: "<b>hi</b>",
    support: "source",
    note: "Shown as source text, never interpreted (see Untrusted content).",
    vectors: [{ md: "<b>hi</b>", html: "&lt;b&gt;hi&lt;/b&gt;" }],
  },

  // --- GFM ----------------------------------------------------------------------
  {
    id: "table",
    group: "GFM",
    name: "Tables",
    example: "| a | b |",
    support: "rendered",
    note: "With column alignment. Cells render inline Markdown and edit in place.",
    vectors: [
      {
        md: "| a | b |\n|:--|--:|\n| 1 | 2 |",
        html: '<div class="om-table-wrap">\n<table>\n<thead>\n<tr><th class="om-align-left">a</th><th class="om-align-right">b</th></tr>\n</thead>\n<tbody>\n<tr><td class="om-align-left">1</td><td class="om-align-right">2</td></tr>\n</tbody>\n</table>\n</div>',
      },
    ],
  },
  {
    id: "task-list",
    group: "GFM",
    name: "Task lists",
    example: "- [ ] todo",
    support: "rendered",
    note: "Clicking a checkbox changes only `[ ]` / `[x]`.",
    vectors: [{ md: "- [x] done", html: '<ul>\n<li class="om-task om-task-done"><input type="checkbox" disabled checked> done</li>\n</ul>' }],
  },
  {
    id: "strikethrough",
    group: "GFM",
    name: "Strikethrough",
    example: "~~gone~~",
    support: "rendered",
    dialect: "strike-double-tilde",
    note: "Exactly two tildes. A single `~x~` is text (GitHub strikes it).",
    vectors: [
      { md: "~~gone~~", html: "<del>gone</del>" },
      { md: "~there~ and ~~~not~~~", html: "~there~ and ~~~not~~~" },
    ],
  },
  {
    id: "autolink-literal",
    group: "GFM",
    name: "Autolinks (bare URLs)",
    example: "www.example.com",
    support: "rendered",
    note: "",
    vectors: [{ md: "www.example.com", html: '<a href="http://www.example.com">www.example.com</a>' }],
  },
  {
    id: "callout",
    group: "GFM",
    name: "Alerts (callouts)",
    example: "> [!NOTE]",
    support: "rendered",
    dialect: "callout",
    note: "NOTE, TIP, IMPORTANT, WARNING, CAUTION, any case.",
    vectors: [
      {
        md: "> [!NOTE]\n> Read this.",
        html: '<div class="om-callout om-callout-note">\n<p class="om-callout-title">Note</p>\n<p>Read this.</p>\n</div>',
      },
    ],
  },
  {
    id: "callout-fold",
    group: "Extensions",
    name: "Callout fold marks",
    example: "> [!NOTE]-",
    support: "rendered",
    dialect: "callout-fold",
    note: "Obsidian's `-` / `+` after the type: rendered as the callout, nothing folds.",
    vectors: [
      {
        md: "> [!TIP]+\n> Read this.",
        html: '<div class="om-callout om-callout-tip">\n<p class="om-callout-title">Tip</p>\n<p>Read this.</p>\n</div>',
      },
    ],
  },

  // --- Extensions ---------------------------------------------------------------
  {
    id: "math-dollar",
    group: "Extensions",
    name: "Inline math `$…$`",
    example: "$E = mc^2$",
    support: "rendered",
    dialect: "math",
    mathTable: true,
    note: "Pandoc's rules: a non-space after the opening `$`, a non-space before the closing `$`, no digit after it. One line.",
    vectors: [
      { md: "$E = mc^2$", html: "<math>E = mc^2</math>" },
      { md: "$x$ and $y$", html: "<math>x</math> and <math>y</math>" },
      { md: "from $20-$30", html: "from $20-$30" },
      { md: "$1,000-$2,000", html: "$1,000-$2,000" },
      { md: "costs $5 and $10", html: "costs $5 and $10" },
      { md: "that is $5", html: "that is $5" },
      { md: "$ x$ and $x $", html: "$ x$ and $x $" },
      { md: "echo $HOME $PATH", html: "echo $HOME $PATH" },
      { md: "$HOME/$USER", html: "<math>HOME/</math>USER" },
      { md: "`$HOME/$USER`", html: "<code>$HOME/$USER</code>" },
      { md: "\\$5 and \\$10", html: "$5 and $10" },
      { md: "$a\\$b$", html: "<math>a\\$b</math>" },
      { md: "- $5 or $x^2$", html: "<ul>\n<li>$5 or <math>x^2</math></li>\n</ul>" },
      {
        md: "| price | formula |\n| - | - |\n| $5 | $x$ |",
        html: '<div class="om-table-wrap">\n<table>\n<thead>\n<tr><th>price</th><th>formula</th></tr>\n</thead>\n<tbody>\n<tr><td>$5</td><td><math>x</math></td></tr>\n</tbody>\n</table>\n</div>',
      },
    ],
  },
  {
    id: "math-double-dollar",
    group: "Extensions",
    name: "Math `$$…$$`",
    example: "$$\\int_0^1 x\\,dx$$",
    support: "rendered",
    dialect: "math",
    mathTable: true,
    note: "On lines of its own: block math (may span lines). Inside a line of text: inline math, as in remark-math, Obsidian and Typora.",
    vectors: [
      { md: "$$x^2$$", html: '<math display="block">x^2</math>' },
      { md: "$$\n\\int_0^1 x\\,dx\n$$", html: '<math display="block">\\int_0^1 x\\,dx</math>' },
      { md: "inline $$x^2$$ here", html: "inline <math>x^2</math> here" },
      { md: "$$x$$ then text", html: "<math>x</math> then text" },
      { md: "$$$x$$$", html: "$$$x$$$" },
    ],
  },
  {
    id: "math-tex",
    group: "Extensions",
    name: "Math `\\(…\\)` and `\\[…\\]`",
    example: "\\(x^2\\)",
    support: "rendered",
    dialect: "math-tex-delimiters",
    mathTable: true,
    note: "The delimiters LLMs write. `\\[ … \\]` is block math when it is a paragraph of its own; on one line it needs a space inside both brackets. Otherwise these stay CommonMark escapes: `\\[ … \\]` in the middle of a line (sharing its paragraph with other text) is never math, by design, and shows as its text `[ … ]`, the backslashes hidden off the caret. (Pandoc's `tex_math_single_backslash` reads it as display math; the editor keeps CommonMark's reading there.)",
    vectors: [
      { md: "\\(x^2\\) inline", html: "<math>x^2</math> inline" },
      { md: "a \\( x \\) b", html: "a <math>x</math> b" },
      { md: "\\(\\) and \\(a", html: "() and (a" },
      { md: "\\[ x^2 \\]", html: '<math display="block">x^2</math>' },
      { md: "\\[\nx = 1\n\\]", html: '<math display="block">x = 1</math>' },
      { md: "\\[x\\]", html: "[x]" },
      { md: "- \\[x\\] item", html: "<ul>\n<li>[x] item</li>\n</ul>" },
      { md: "\\[ a \\] b \\[ c \\]", html: "[ a ] b [ c ]" },
      { md: "Let \\[ x^2 \\] be the area.", html: "Let [ x^2 ] be the area." },
      { md: "text\n\\[\nx\n\\]", html: "text\n[\nx\n]" },
    ],
  },
  {
    id: "frontmatter",
    group: "Extensions",
    name: "YAML front matter",
    example: "---⏎title: x⏎---",
    support: "rendered",
    dialect: "frontmatter",
    note: "At the very start of the file; shown as an editable Properties block.",
    vectors: [
      {
        md: "---\na: 1\n---\n\nx",
        html: '<table class="om-props">\n<tbody>\n<tr><th scope="row">a</th><td>1</td></tr>\n</tbody>\n</table>\n<p>x</p>',
      },
    ],
  },
  {
    id: "image-size",
    group: "Extensions",
    name: "Image size",
    example: "![alt|300](cat.png)",
    support: "rendered",
    dialect: "image-size",
    note: "`|width` or `|widthxheight` at the end of the alt text, in pixels (Obsidian's form).",
    vectors: [
      { md: "![alt|120](p.png)", html: '<img src="p.png" alt="alt" width="120">' },
      { md: "![alt|120px](p.png)", html: '<img src="p.png" alt="alt|120px">' },
    ],
  },
  {
    id: "mermaid",
    group: "Extensions",
    name: "Mermaid diagrams",
    example: "```mermaid",
    support: "rendered",
    dialect: "mermaid",
    note: "A fence with info string `mermaid`. Off with `diagrams: false` and in the `no-diagrams` entry.",
    vectors: [{ md: "```mermaid\ngraph TD\n```", html: '<pre class="om-code"><code class="language-mermaid">graph TD</code></pre>' }],
  },
  {
    id: "agent-mention",
    group: "Extensions",
    name: "`@agent` mentions",
    example: "@agent(reviewer)",
    support: "rendered",
    dialect: "agent-mention",
    note: "Coloured with `--ome-agent`; the text is unchanged.",
    vectors: [{ md: "@agent(reviewer) look", html: '<span class="om-agent">@agent(reviewer)</span> look' }],
  },

  // --- Not supported --------------------------------------------------------------
  {
    id: "wikilink",
    group: "Not supported",
    name: "Wikilinks",
    example: "[[Page]]",
    support: "source",
    note: "A host can style them with its own CodeMirror extension (see below).",
    vectors: [{ md: "[[Page]]", html: "[[Page]]" }],
  },
  {
    id: "footnote",
    group: "Not supported",
    name: "Footnotes",
    example: "text[^1]",
    support: "source",
    note: "Both the reference and the note. A note with no space in it is a CommonMark link reference definition, so `[^1]` links to it.",
    vectors: [
      { md: "a[^1]\n\n[^1]: The note.", html: "<p>a[^1]</p>\n<p>[^1]: The note.</p>" },
      { md: "a[^1]\n\n[^1]: https://example.com", html: 'a<a href="https://example.com">^1</a>' },
    ],
  },
  {
    id: "highlight",
    group: "Not supported",
    name: "Highlight",
    example: "==mark==",
    support: "source",
    note: "",
    vectors: [{ md: "==mark==", html: "==mark==" }],
  },
  {
    id: "container",
    group: "Not supported",
    name: "Fenced containers / panels",
    example: "::: note",
    support: "source",
    note: "Read as a paragraph of text.",
    vectors: [{ md: "::: note\nhi\n:::", html: "::: note\nhi\n:::" }],
  },
  {
    id: "sub-superscript",
    group: "Not supported",
    name: "Subscript / superscript",
    example: "H~2~O x^2^",
    support: "source",
    note: "Use math instead: `$H_2O$`.",
    vectors: [{ md: "H~2~O x^2^", html: "H~2~O x^2^" }],
  },
  {
    id: "emoji-shortcode",
    group: "Not supported",
    name: "Emoji shortcodes",
    example: ":smile:",
    support: "source",
    note: "Emoji characters themselves are text and show as usual.",
    vectors: [{ md: ":smile:", html: ":smile:" }],
  },
  {
    id: "definition-list",
    group: "Not supported",
    name: "Definition lists",
    example: "Term⏎: definition",
    support: "source",
    note: "",
    vectors: [{ md: "Term\n: definition", html: "Term\n: definition" }],
  },
  {
    id: "math-fence",
    group: "Not supported",
    name: "Math fences",
    example: "```math",
    support: "source",
    note: "A code block (GitHub draws it as math). Use `$$…$$`.",
    vectors: [{ md: "```math\nx\n```", html: '<pre class="om-code"><code class="language-math">x</code></pre>' }],
  },
];

const BEGIN = "<!-- syntax-table:begin -->";
const END = "<!-- syntax-table:end -->";
export const SYNTAX_TABLE_MARKERS = { begin: BEGIN, end: END } as const;

/** A table cell: inline code, pipes escaped, line breaks shown as ⏎. */
function codeCell(text: string): string {
  const t = text.replace(/\n/g, "⏎").replace(/\|/g, "\\|");
  const ticks = t.includes("`") ? "``" : "`";
  const pad = t.startsWith("`") || t.endsWith("`") ? " " : "";
  return `${ticks}${pad}${t}${pad}${ticks}`;
}

const textCell = (text: string): string => text.replace(/\|/g, "\\|");

const SUPPORT_LABEL: Record<Support, string> = { rendered: "Rendered", source: "Shown as written" };

/**
 * The docs' tables, generated: the syntax table (by group) and the math
 * delimiter table (every vector of a `mathTable` entry). Ends with a newline.
 */
export function syntaxTables(): string {
  const out: string[] = [BEGIN, "<!-- Generated from src/editor/syntaxSupport.ts by its gate. Do not edit by hand. -->", ""];
  for (const group of ["CommonMark", "GFM", "Extensions", "Not supported"] as const) {
    out.push(`### ${group}`, "", "| Syntax | Example | Support | Notes |", "| --- | --- | --- | --- |");
    for (const e of SYNTAX.filter((s) => s.group === group)) {
      out.push(`| ${textCell(e.name)} | ${codeCell(e.example)} | ${SUPPORT_LABEL[e.support]} | ${textCell(e.note)} |`);
    }
    out.push("");
  }
  out.push("### How math delimiters are read", "", "Each row is a test vector: the source, and what the editor renders it as (formulas as `<math>`).", "", "| You write | It renders as |", "| --- | --- |");
  for (const e of SYNTAX.filter((s) => s.mathTable)) {
    for (const v of e.vectors) out.push(`| ${codeCell(v.md)} | ${codeCell(v.html)} |`);
  }
  out.push("", "⏎ marks a line break.", "", END);
  return out.join("\n") + "\n";
}
