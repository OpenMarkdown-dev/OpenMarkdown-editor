# Changelog

All notable changes to `@openmarkdown-dev/editor`. Versions follow [semver](https://semver.org/);
while the version is 0.x, a minor version may change the public API
(`api/editor.api.d.ts`).

The top entry's version must equal `package.json`'s: the export and the release workflow
both refuse to publish otherwise.

## 0.2.0 — 2026-11-18

What five integrations of 0.1.3 (a git CMS, a wiki, two agent UIs and a document editor) asked
for: per-editor options and a fuller handle, a styling contract, renderers you can replace,
lighter dependencies, table edits that change only the edited cell, and a documented Markdown
dialect. 0.x minor: two changes below need a line of code from you.

### Breaking

- **Fenced code is unhighlighted unless you pass `codeLanguages`.** The editor no longer
  imports or declares `@codemirror/language-data`, so its twenty-odd `@codemirror/lang-*`
  packages leave your lockfile unless you want them. HTML inside Markdown is still highlighted.
  To keep 0.1.x's highlighting, install the list and pass it:

  ```sh
  npm install @codemirror/language-data
  ```

  ```ts
  import { languages } from "@codemirror/language-data";
  import { createEditorState, mountEditor } from "@openmarkdown-dev/editor";

  mountEditor(document.getElementById("editor")!, createEditorState({ doc, codeLanguages: languages }));
  ```

  In React, pass it where you create the state, inside the mount effect:

  ```tsx
  import { languages } from "@codemirror/language-data";

  useEffect(() => {
    const state = createEditorState({ doc: value, codeLanguages: languages, host: { onChange } });
    editor.current = mountEditor(parent.current!, state);
    return () => editor.current?.destroy();
  }, []);
  ```

  Each language still loads the first time a fence uses it. To bundle only a few, pass your own
  `LanguageDescription`s ([bundling](docs/guides/bundling.md)).
- **`/no-diagrams` now draws diagrams when the environment has a `renderDiagram`.** In 0.1.x it
  ignored the `diagrams` option and always showed `mermaid` fences as code. Without a
  `renderDiagram`, it still does, so upgrading needs no change. Once you give one page-wide
  (`configureEditorEnvironment`), every `/no-diagrams` editor draws diagrams; pass
  `diagrams: false` to an editor that should keep showing the code. See
  [renderers](docs/guides/renderers.md).

### Added

- **Per-editor options.** `createEditorState({ environment })` gives one editor its own color
  scheme, clipboard, link handlers, spelling and host keys; `configureEditorEnvironment` is now
  the page's defaults (same signature; the UI `language` stays page-wide). `colorScheme` also
  accepts a fixed `"light"` or `"dark"`. `editor.setEnvironment(...)` changes it later.
- **Read-only:** `editable: false` (and `editor.setEditable` / `editor.editable()`) forbids
  every change in every mode, including checkboxes and properties, and draws no editing
  controls.
- **Handle commands,** so a toolbar needs no CodeMirror import: `undo`, `redo`, `openSearch`,
  `closeSearch`, `isSearchOpen`, `revealText`, `focus`, and `isUnedited(file)` for an
  unsaved-changes indicator.
- **Forms and CMS fields:** `id`, `ariaLabel` and `ariaLabelledBy` on the editable text (a
  `<label for>` focuses the editor); `EditorHost.uploadImage(bytes, hint)` for image paste and
  drop without a document path; `height: "auto"` for an editor as tall as its content. Guide:
  [embed in a form](docs/guides/embed-in-a-form.md).
- **`fromState`:** take over an existing CodeMirror state with its document, selection and undo
  history.
- **Text codec** `openMarkdownText` / `saveMarkdownText` (type `MarkdownText`), for hosts that
  hold the file as a string; it keeps the BOM and line endings as the bytes codec does.
- **Pluggable renderers:** `renderMath(tex, displayMode)` (returns MathML) and
  `renderDiagram(source, scheme)` (returns SVG) in the environment, used in place of the
  built-in ones in every entry and passed through the same sanitiser. Bring your page's MathJax,
  KaTeX or Mermaid. Types `MathRenderer`, `DiagramRenderer`, `ColorSchemeSource`,
  `EditorOwnEnvironment`.
- **`./no-renderers` entry:** no built-in formula or diagram renderer; nothing it imports
  reaches Temml or Mermaid, so a one-file (IIFE) bundle inlines neither
  ([bundling into one file](docs/guides/bundling.md)).
- **`./browser`:** a prebuilt, minified single-file build (the `/no-diagrams` entry with
  CodeMirror, Lezer and Temml inside) for pages with no bundler.
- **Styling contract:** the mounted editor's root has the class `.ome-root`; editors nested in a
  table cell or property value have `.ome-nested`. New layout tokens `--ome-font-size`,
  `--ome-line-height`, `--ome-content-width`, `--ome-padding-x`, `--ome-padding-y`, and a "fit
  the host page" recipe ([theming](docs/guides/theming.md)).
- **`\(…\)` inline and `\[ … \]` block math,** as language models write it.
- **Syntax guide** ([syntax](docs/guides/syntax.md)): every syntax the editor reads, and the
  ones it shows as written, generated from the tests; it also says what `extensions` can add
  for host syntax (decorations such as wikilinks; not new grammar or block renderers).

### Changed

- **Style `.ome-root`, not `.cm-editor`.** A cell being edited holds its own `.cm-editor`, so a
  rule like `.field .cm-editor { min-height: 320px }` also stretched table rows. Move such rules
  to `.ome-root`. Token defaults are now set on `.ome-root`; the look is unchanged.
- **Table cell edits change only the edited cell.** Leaving a cell no longer re-aligns the whole
  table. A cell edit that changed nothing writes nothing; an aligned table re-pads the edited
  cell and widens only that column when the text no longer fits; a compact table changes only by
  what you typed. Row, column and alignment commands write in the table's own style. Format
  table is the one command that rewrites a whole table. README "Fidelity" lists the exact rules.
- **Math delimiters follow Pandoc and remark-math.** `$…$` needs a non-space after the opening
  `$` and before the closing one, and no digit right after it, so `$20-$30` is text. `$$…$$`
  inside a line is inline math. `\$` inside a formula is a dollar.
- **Escape backslashes** (`\*not\*`) are hidden off the caret and in reading mode, like other
  marks; the source keeps them and plain-text copy drops them.
- **Dependencies:** `mermaid` is the range `^11.17.2` (was pinned to 11.17.2), so a host on
  another 11.x shares one copy. `@codemirror/lang-html` and `@lezer/common` are now declared
  peers (lang-html was already installed with lang-markdown); `@codemirror/language-data` is no
  longer a peer.
- **Smaller first load:** the HTML grammar loads the first time a document holds HTML, and
  Mermaid's drawing code with the first diagram.
- `extensions` accepts an array (`Extension | readonly Extension[]`).
- Install docs: entries table, `codeLanguages`, and what to do under a release-age gate (bun's
  or pnpm's `minimumReleaseAge`).
- `@openmarkdown-dev/css`: body size, line height, column width and padding are the layout
  tokens above, with the same defaults, so they can be overridden on `.om-doc`.
- Examples and the home page's script snippet use 0.2.0.

### Fixed

- Inline math in a list item no longer overlaps the text before it.
- While a table cell is edited, the table is no longer tinted as if selected.
- Typing into an empty cell puts the text one space in from the left pipe (`| x  |`).
- Reading mode opens no cell editor, and its properties block no longer shows "+ Add property"
  or "Edit as source" after a mode switch.
- Temml's "doesn't work in quirks mode" warning is no longer printed (under happy-dom, for
  example).

## 0.1.3 — 2026-11-14

- Properties: every name and value is written as valid YAML. A name or value that needs
  quotes gets them (`"key: x #[": "{oops: [1, \""`), and a bracketed list stays bare only
  when every item is plain, so the block no longer falls back to source after an edit.
- Links: brackets are a link only when they have a destination or name a reference defined
  in the document, the same rule in live, reading, plain-text copy and HTML. `[foo]` with no
  definition is plain text with its brackets, no longer coloured as a link; `[a]()` is a
  link. `[!FOOBAR]` and other unknown callout types keep their brackets.
- Placeholders: math, Mermaid diagrams, formulas in table cells and images show one
  placeholder box until they render, never their source, and keep their size: the written
  size, then what was drawn this session, then the height before an edit. A formula that
  fails shows its source, underlined.
- Tables: empty cells keep a usable minimum size (one line high, about three characters
  wide), in the editor and in HTML export.
- Find: matches inside table cells are highlighted, the current one as current, in live and
  reading mode. Opening Find with a cell open closes the cell so the table shows every match;
  Cmd+F in a cell opens the document's Find; closing Find reopens the cell. A match in hidden
  source (a long link's URL, a list marker) is shown when it is the current one.
- Caret: Tab or Find moving to a cell below the fold scrolls that cell into view. Reading
  mode draws no caret.
- Mermaid: a diagram larger than a size threshold shows a hint and a Render button instead of
  rendering on its own, so opening or typing in a document with one does not freeze. A wide
  diagram scales down only to a readable size, then scrolls sideways in its own box; pressing
  its scrollbar does not open the source. A failed Mermaid load is not retried in a loop.
- Lists: a task item's checkbox replaces its bullet (• ☐ → ☐), and nested items under task
  and plain items line up.
- Narrow layouts: properties stack their name above the value when the block is narrow, and
  sideways-scrolling blocks (tables, block math, wide diagrams) show an edge fade on the side
  that has more.
- `@openmarkdown-dev/css`: the empty-cell minimum size, with `box-sizing: border-box` on
  cells.
- Examples and the home page's script snippet use 0.1.3.

## 0.1.2 — 2026-11-13

- Tables: typing on the lone blank line between a table and the paragraph below no longer
  pulls that paragraph into the table. The typed line becomes the table's new last row, a
  line break is added after it, and the paragraph below stays separate. The same holds
  between any two top-level blocks. This is a registered rewrite (README "Fidelity").
- Tables: keys typed right after that new row appears go into its cell instead of landing
  one per line below the table.
- Mermaid: a diagram whose source is open is no longer re-rendered on each keystroke; it
  renders once when the caret leaves. A queued render for source nobody shows any more is
  skipped. Large diagrams no longer freeze typing.
- Examples and the home page's script snippet use 0.1.2.

## 0.1.1 — 2026-11-13

- Tables: typing on the line right under a table no longer leaves the caret inside the
  rendered table. The typed line becomes the table's new last row (as GFM reads it), and the
  whole line goes into that row's cell.
- Tables: a `|` typed or pasted into a cell is written as `\|`, so the table keeps its
  columns.
- Tables and properties: keys typed right after clicking into a cell or a value land in it;
  the first few were sometimes dropped.
- README: the lossless round-trip definition is now the first feature, linked to the fidelity page.
- Examples and the home page's script snippet use 0.1.1.

## 0.1.0 — 2026-11-12

First public release, extracted from the [OpenMarkdown](https://openmarkdown.dev) app.

- Live preview on CodeMirror 6: headings, emphasis, lists and task lists, links, images,
  tables with in-cell editing, code blocks, math (Temml), Mermaid diagrams, callouts,
  YAML properties; the source shows under the caret. Plus source and reading modes.
- Edits the Markdown source text itself; open and save without editing returns the same
  bytes. The rewrites an edit may cause are listed in the README ("Fidelity").
- File-bytes adapter: `openMarkdownFile` decodes strict UTF-8 and records the BOM and line
  endings; `saveMarkdownFile` returns the original bytes when nothing changed and otherwise
  writes the BOM and dominant line ending back.
- The entry: `createEditorState`, `mountEditor`, `configureEditorEnvironment`, with
  host callbacks (`EditorHost`) and window-wide capabilities (`EditorEnvironment`).
- `@openmarkdown-dev/editor/no-diagrams`: the same editor and API without diagram support;
  nothing it imports reaches Mermaid, so a bundle built from it holds no Mermaid chunk.
- `EditorHost.onUnsupportedPaste(reason, count)`: an optional notice when pasted or dropped
  images cannot be stored (no `saveAttachment`, or no document path). The editor itself stays
  silent, as before.
- Styled by `--ome-*` custom properties with light and dark defaults; no CSS file to import.
  `--ome-bg` / `--ome-fg` paint the editor root, and the root carries
  `data-ome-scheme="light|dark"` for host selectors.
- Strict Content Security Policy: with `EditorView.cspNonce`, the editor and math run under
  `script-src 'self'; style-src 'self' 'nonce-…'` with no violation (no inline `style`
  attributes). Mermaid's own drawing needs inline styles; see the self-hosting guide.
- `diagrams: false` keeps ```` ```mermaid ```` blocks as code and never loads Mermaid.
- Links: in reading mode a plain click follows a link (Cmd/Ctrl+click in live and source);
  `#fragment` links also find a heading by its GitHub-style slug (`#second-part`); a local
  link's fragment reaches the host as `openLink(absPath, fragment)`.
- `setDoc` replaces only the part that differs, so the reader's scroll position and selection
  stay; it is not an undo step. `refreshImages()` asks `resolveImage` again for every image.
- UI strings in English, Chinese, Japanese and Korean.
- Untrusted documents never run script: one sanitised markup path, one URL policy.
- CodeMirror and Lezer are peer dependencies; Temml and Mermaid load lazily.
