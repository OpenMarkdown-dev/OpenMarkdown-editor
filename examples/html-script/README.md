# Plain HTML

One HTML file that loads the editor from a CDN with `<script type="module">` and mounts it: no framework and no bundler, but the package must be on the CDN.

Framework-free is not build-free. This page needs `@openmarkdown-dev/editor` published to npm, so that esm.sh can serve it. Before that, with a package file from `npm pack`, or on a site whose policy rules out a CDN, build the editor once and serve the files yourself: **[Self-hosting](https://openmarkdown.dev/editor/docs/guides/self-hosting/)** ([in this repository](../../docs/guides/self-hosting.md)) gives the build script, the files to deploy and a strict Content Security Policy that works.

Open `index.html` through any static server (`npm run dev` starts one).
