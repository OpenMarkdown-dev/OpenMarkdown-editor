# Contributing

Thank you for helping. Bug reports with a small Markdown sample are the most useful
contribution of all, and need no paperwork.

## How this repository works

`@openmarkdown-dev/editor` is developed inside the OpenMarkdown app's source repository, which
is private. On each release, the editor's sources, tests and these documents are exported
here as **one commit** (the source repository's history is not published). So:

- Pull requests are reviewed and discussed **here**.
- A maintainer ports an accepted pull request into the source repository by hand. It comes
  back here with the next release commit, and you are credited in the CHANGELOG (and, where
  the port keeps your commits, as their author). Your pull request is then closed with a
  link to that release, not merged.
- Comments in the code sometimes cite specifications or files of the source repository
  (`spec: …`, `change: …`, `docs/…`). Those are not published; the tests are the contract
  you can read.

## Contributor License Agreement

**Every contributor must sign the [Contributor License Agreement](CLA.md) before a pull
request can be accepted.** The CLA bot asks on your first pull request; you sign by
replying with one sentence, once.

Why: the editor is MIT today, and the CLA lets the maintainers keep relicensing future
versions and include contributions in a future commercial layer built on the editor. You
keep the copyright in your work. If you contribute on behalf of an employer, check with
them first (CLA section 4).

## Development

```sh
npm ci
npm run typecheck
npm run build      # dist/index.js + dist/index.d.ts
npm test           # vitest, in node
```

Tests run in node without a DOM: editor behaviour is tested through `EditorState`
transactions and pure helpers, not a mounted view.

## Rules the code keeps

- **Bytes you did not edit do not change.** A change to what the editor writes back must
  come with a test that asserts the exact output. New normalisations are not accepted
  silently; see "Fidelity" in the README.
- **No new runtime dependencies** without discussion. CodeMirror and Lezer are peers;
  nothing may bundle a second copy of them.
- **Untrusted content never runs script.** Markup reaches the DOM only through
  `src/editor/markup.ts`; URLs go through `src/editor/safeUrl.ts`.
- **The public API is a snapshot** (`api/editor.api.d.ts`). If you change it on purpose,
  run `npm run update-api` and include the diff.

## Security

Report vulnerabilities privately through
[GitHub security advisories](https://github.com/OpenMarkdown-dev/OpenMarkdown-editor/security/advisories/new),
not in a public issue.

## Trademark

The code is MIT; the name and logo are not. See [TRADEMARK.md](TRADEMARK.md).
