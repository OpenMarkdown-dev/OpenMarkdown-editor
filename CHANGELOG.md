# Changelog

All notable changes to `@openmarkdown-dev/editor`. Versions follow [semver](https://semver.org/);
while the version is 0.x, a minor version may change the public API
(`api/editor.api.d.ts`).

The top entry's version must equal `package.json`'s: the export and the release workflow
both refuse to publish otherwise.

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
