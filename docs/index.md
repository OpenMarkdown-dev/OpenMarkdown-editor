# OpenMarkdown Editor

`@openmarkdown-dev/editor` is a live-preview Markdown editor built on [CodeMirror 6](https://codemirror.net/).
Headings, lists, tables, math, Mermaid diagrams, callouts and YAML properties render in place,
and the Markdown shows under the caret. It edits the Markdown source text itself, for a
lossless round-trip: open and save without editing, and the file is byte-for-byte what it was.
When you edit, only what you touched changes, with a few exceptions, each pinned by a test.

It is the editor inside the [OpenMarkdown](https://openmarkdown.dev) app, extracted as an MIT library.

## Start here

1. [Install](getting-started/install.md) the package and its CodeMirror peers.
2. [Mount your first editor](getting-started/first-editor.md) in plain JavaScript.
3. Use it [in React](getting-started/react.md) or [in any other framework](getting-started/any-framework.md).

## Guides

- [The host: `EditorHost`](guides/host.md): the per-document callbacks (changes, links, images, outline).
- [The environment: `EditorEnvironment`](guides/environment.md): the once-per-page capabilities (color scheme, clipboard, links, spelling, keys).
- [Theming](guides/theming.md): the `--ome-*` custom properties.
- [UI language](guides/language.md): English, Chinese, Japanese and Korean.
- [Images](guides/images.md): showing, pasting, dropping and resizing.
- [Untrusted content](guides/untrusted-content.md): what the editor does with a document written by someone else.
- [Server-side rendering](guides/ssr.md): importing on the server, mounting in the browser.
- [Self-hosting](guides/self-hosting.md): building the editor into static files, without a bundler or a CDN, under a strict CSP.

## Fidelity

- [What the editor changes in your file](fidelity.md), and what it never changes.
- [How we compared it with other editors](fidelity/method.md): method, an example diff, the run date and the caveats.

## Reference and examples

- The [API reference](https://openmarkdown.dev/editor/docs/api/) is generated from the package's type declarations.
- [Examples](https://openmarkdown.dev/editor/examples/): small projects you can run, one per task.
- [Live demo](https://openmarkdown.dev/editor/demo/): the editor with a showcase document.

## Code and app

The editor's source is in its public repository, and the same editor ships inside the
OpenMarkdown app for macOS, Windows and Linux. To see it with files, folders and an agent
around it, [get the app](https://openmarkdown.dev/#download) or
[try the whole app in your browser](https://openmarkdown.dev/demo).
