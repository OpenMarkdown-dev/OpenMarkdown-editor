/**
 * Following a rendered markdown link (spec: live-preview-editor / 链接点击导航).
 *
 * Two places can hit a link and they find the href in completely different ways:
 *
 *   - `livePreview.ts` — a Cmd/Ctrl+click anywhere in the document, located by
 *     `posAtCoords` + the syntax tree.
 *   - `widgets.ts` `TableWidget` — a click inside a rendered GFM table, whose
 *     cells are DETACHED DOM with no document offsets to resolve against. The
 *     widget also returns `true` from `ignoreEvent()`, so CodeMirror never hands
 *     those clicks to the handler above; the widget must route them itself.
 *
 * Only that "how do I get an href" half differs. Everything from the href
 * onward — classification and the four-way route — lives here, once, because two
 * copies of the routing WILL drift (and the drift shows up as "links behave
 * differently inside tables", which is the bug this module exists to end).
 *
 * Kept out of `livePreview.ts` to stay importable from `widgets.ts`:
 * `livePreview.ts` imports `./widgets`, so the reverse edge would be a cycle.
 */

import type { EditorView } from "@codemirror/view";
import { livePreviewConfig } from "./previewConfig";
import { resolveLinkTarget } from "./linkResolve";
import { findFragmentHeading } from "./outline";
import { navigateTo } from "./caret";
import { editorEnvironment } from "./environment";

/** Classify a link target and route by kind (spec: 链接点击导航). */
export function followLink(view: EditorView, href: string) {
  const config = view.state.facet(livePreviewConfig);
  const target = resolveLinkTarget(href, config.docDir ?? null);
  switch (target.kind) {
    case "external":
      // Scheme URL → the host's external open (spec: editor-host; the app's
      // is the one external-open funnel, whose scheme policy decides open /
      // confirm / refuse — spec: external-open). No host: nothing happens.
      void editorEnvironment().openExternal?.(target.url);
      break;
    case "anchor": {
      // Same-document heading (by text or GitHub-style slug) → a user
      // navigation: the caret goes to the heading's line start, in view (spec:
      // caret-rules R3).
      const found = findFragmentHeading(view.state, target.heading);
      if (found) navigateTo(view, found.from);
      break;
    }
    case "local":
      // In-app navigation to an existing file (the callback gates on
      // existence and never creates it). The `#frag` travels with it; what to
      // do with it is the host's call (the app opens the file at the top).
      config.openLink?.(target.absPath, target.heading || null);
      break;
    case "unresolvable":
      // Relative path with no docDir (unsaved) → graceful no-op.
      break;
    case "blocked":
      // Script-capable URL → never opened, never handed to `openExternal`
      // (spec: editor-host / 不可信内容渲染不执行脚本); the host may only say so.
      void editorEnvironment().refusedLink?.(target.url, target.scheme);
      break;
  }
}
