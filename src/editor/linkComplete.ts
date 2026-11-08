import {
  acceptCompletion,
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { inImageTarget } from "./imageAlt";
import { opensAs } from "@/lib/opensAs";
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, type Command } from "@codemirror/view";
import { rankByScore } from "@/lib/fuzzy";
import { outlineOf } from "./outline";
import { segmentQuery } from "./headingIndex";
import { relativePath } from "./relativePath";
import { fileLabel } from "./imagePaste";

/**
 * Link-target autocompletion (spec: 链接目标自动补全). Two modes, entered only
 * when the cursor sits in a link URL span `[](…)`:
 *  - **file**: candidates are the workspace's linkable files, inserted as a path
 *    relative to the open document's directory;
 *  - **heading**: after `](#`, candidates are the current document's headings.
 *
 * The editor layer stays decoupled from the workspace store (like `openLink`):
 * `docDir` is a value rebuilt with the document's path (it rides the editor's
 * per-document compartment) and `getFolder` is a getter, so a home switch under
 * a live state stays fresh.
 */
export interface LinkCompleteDeps {
  /** Open document's directory (dirname of docPath); null = unsaved. */
  docDir: string | null;
  /** The current home's root; null before any home exists. Getter → always current. */
  getFolder: () => string | null;
  /**
   * The linkable files under `root`, root-relative — the host's (spec: editor-host);
   * null when the host lists none, and file completion then offers nothing.
   */
  listFiles: (root: string) => Promise<string[]> | null;
}

export interface LinkContext {
  mode: "file" | "heading";
  /** Text typed after `](` (file) or `](#` (heading), i.e. what to replace. */
  query: string;
}

/**
 * Classify the text before the cursor as a link-target completion context.
 * Pure (unit-tested). Looks only at the current line up to the cursor:
 *  - most recent `](` with no closing `)` after it → in a link URL span;
 *  - span starting with `#` → same-document heading;
 *  - span with a `#` mid-way (`path#frag`) → cross-document heading, out of
 *    scope this round → null;
 *  - otherwise → file path.
 * Anything else (plain text, a closed `](…)`) → null.
 */
export function parseLinkContext(before: string): LinkContext | null {
  const m = /\]\(([^)]*)$/.exec(before);
  if (!m) return null;
  const inner = m[1];
  if (inner.startsWith("#")) return { mode: "heading", query: inner.slice(1) };
  if (inner.includes("#")) return null; // path#frag: cross-doc heading (non-goal)
  return { mode: "file", query: inner };
}

/** A CodeMirror completion `apply` callback (writes into the doc on accept). */
type ApplyFn = (view: EditorView, completion: Completion, from: number, to: number) => void;

/**
 * Build a completion `apply` that writes `insert` and closes the link: the
 * editor has no bracket auto-close, so `[x](` is left open — accepting a target
 * appends `)` (unless one already sits at the cursor, e.g. the `[]()` skeleton
 * from `insertLink`) and lands the cursor just past it, ready to move on.
 *
 * `fillLabel` (file mode only) fixes the empty-name link: accepting a file
 * candidate into a `[]()` skeleton also drops the file name between the brackets
 * so the link never renders blank (spec: 补名) — matching the sidebar-drag rule.
 * A non-empty link text is never overwritten; heading candidates pass no label.
 */
function applyLinkTarget(insert: string, fillLabel?: string): ApplyFn {
  return (view, _c, from, to) => {
    const closed = view.state.sliceDoc(to, to + 1) === ")";
    const url = closed ? insert : `${insert})`;
    // Empty-text link: the `]` sits at from-2, the `[` at from-3 (`](` is always
    // adjacent in CommonMark). Fill the brackets with the file name too.
    if (fillLabel != null && from >= 3 && view.state.sliceDoc(from - 3, from - 1) === "[]") {
      view.dispatch({
        changes: [
          { from: from - 2, insert: fillLabel },
          { from, to, insert: url },
        ],
        selection: { anchor: from + fillLabel.length + insert.length + 1 },
        userEvent: "input",
      });
      return;
    }
    view.dispatch({
      changes: { from, to, insert: url },
      selection: { anchor: from + insert.length + 1 },
      userEvent: "input",
    });
  };
}

/**
 * Accept a file candidate opened by the `[[` / `【【` trigger: replace the whole
 * trigger span (`[[query`) with a standard CommonMark `[name](path)`. The
 * trigger is input sugar only — the document keeps portable markdown, never
 * `[[…]]` (design D2). Cursor lands past the closing `)`.
 */
function applyBracketLink(label: string, path: string): ApplyFn {
  return (view, _c, from, to) => {
    const insert = `[${label}](${path})`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: "input",
    });
  };
}

/**
 * Classify the text before the cursor as a `[[` link-insertion trigger. Pure
 * (unit-tested). Matches two consecutive open brackets — half-width `[[`, CJK
 * full-width `【【` (IME users get these without switching to half-width), or a
 * mix — followed by a query with no bracket chars. Returns the query (files are
 * fuzzy-matched against it), or null when there is no trigger. The caller checks
 * `parseLinkContext` FIRST, so a `[[` inside an existing `](…)` URL span never
 * hijacks the URL completion (design D6).
 */
export function parseBracketTrigger(before: string): { query: string } | null {
  const m = /[[【]{2}([^[\]【】]*)$/.exec(before);
  return m ? { query: m[1] } : null;
}

/**
 * Build a file-target completion result: rank workspace files against `query`,
 * each option applying via `makeApply(relPath)`. Shared by the `](` URL-span
 * completion and the `[[` trigger. Root is the current home's root (spec: 链接补全
 * 根 = 家根), falling back to the doc's own directory; no root → nothing to offer.
 */
async function fileCompletion(
  deps: LinkCompleteDeps,
  query: string,
  from: number,
  makeApply: (path: string) => ApplyFn,
  only?: (rel: string) => boolean,
): Promise<CompletionResult | null> {
  const root = deps.getFolder() ?? deps.docDir;
  if (!root) return null;
  const pending = deps.listFiles(root);
  if (!pending) return null;
  const listed = await pending;
  const files = only ? listed.filter(only) : listed;
  // Rank against the full root-relative path (fuzzy.ts already weights the
  // filename segment above directory segments), so typing either a name or a
  // `sub/` prefix narrows correctly.
  const ranked = rankByScore(files, query, (rel) => rel);
  if (ranked.length === 0) return null;
  return {
    from,
    options: ranked.map((rel) => {
      const slash = rel.lastIndexOf("/");
      // Insert relative to the document; root-relative == doc-relative when the
      // root IS the doc's directory (a passing home).
      const path = deps.docDir ? relativePath(deps.docDir, `${root}/${rel}`) : rel;
      return {
        label: slash >= 0 ? rel.slice(slash + 1) : rel,
        detail: slash >= 0 ? rel.slice(0, slash) : undefined,
        apply: makeApply(path),
        type: "file" as const,
      };
    }),
    filter: false,
  };
}

/** The completion source; async because a cold file index fetches over IPC. */
async function linkSource(
  context: CompletionContext,
  deps: LinkCompleteDeps,
): Promise<CompletionResult | null> {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);

  // `filter: false` + no `validFor` → CodeMirror re-queries this source on each
  // keystroke (verified in dist), so `rankByScore` (fuzzy.ts) owns the single
  // filter+rank pass — no double-filtering against CM's own matcher.

  // A `](…)` URL span wins over `[[` (design D6): a `[[` typed inside a URL span
  // never hijacks the URL completion.
  const ctx = parseLinkContext(before);
  if (ctx) {
    const from = context.pos - ctx.query.length;
    if (ctx.mode === "heading") {
      // Same-document headings; skip the heading line the cursor is on (a link to
      // its own heading is never what's wanted). No name-fill for anchors.
      // A heading with no text has nothing to link by. The stored target is
      // the heading model's one-segment query, so a `#` or `::` in the text
      // reads back literally (change: heading-anchors).
      const headings = outlineOf(context.state).filter((h) => h.from !== line.from && h.anchor !== null);
      const ranked = rankByScore(headings, ctx.query, (h) => h.text);
      if (ranked.length === 0) return null;
      return {
        from,
        options: ranked.map((h) => ({
          label: h.text,
          apply: applyLinkTarget(segmentQuery(h.text)),
          type: "text" as const,
        })),
        filter: false,
      };
    }
    // File mode: an empty-text link gets name-filled with the file name. The
    // model lists images too (what can be opened is listed); inside an image's
    // `![…](` only images are candidates — a picture of a markdown file is
    // never what is wanted. Everywhere else every listed file is offered.
    const picture = inImageTarget(before);
    return fileCompletion(
      deps,
      ctx.query,
      from,
      (path) => applyLinkTarget(path, fileLabel(path)),
      picture ? (rel) => opensAs(rel) === "image" : undefined,
    );
  }

  // `[[` / `【【` trigger → same file list, expands to a standard `[name](path)`.
  const bracket = parseBracketTrigger(before);
  if (bracket) {
    // Trigger span = the two brackets + the query typed after them.
    const from = context.pos - bracket.query.length - 2;
    return fileCompletion(deps, bracket.query, from, (path) =>
      applyBracketLink(fileLabel(path), path),
    );
  }

  return null;
}

/**
 * Insert a link skeleton and start completion (Cmd/Ctrl+K) — the low-friction
 * entry point so a user never types `](` by hand (which also sidesteps a
 * full-width IME `（`, an invalid markdown delimiter). A non-empty selection
 * becomes the link text `[sel]()`; the cursor lands inside the parens and the
 * file menu opens immediately.
 */
export const insertLink: Command = (view) => {
  if (view.state.readOnly) return false;
  const tr = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    return {
      changes: { from: range.from, to: range.to, insert: `[${text}]()` },
      // Cursor between the parens: `[` + text + `](` = text.length + 3 chars.
      range: EditorSelection.cursor(range.from + text.length + 3),
    };
  });
  view.dispatch(tr, { scrollIntoView: true, userEvent: "input" });
  startCompletion(view);
  return true;
};

/**
 * Open the file completion the moment a `[[` / `【【` trigger is typed (spec:
 * `[[` 触发器). Fires only at the transition (query still empty) so it doesn't
 * restart on every later keystroke — `activateOnTyping` keeps the open menu
 * fresh. Skips when the cursor is inside a `](…)` URL span (that completion
 * wins, design D6). `startCompletion` dispatches, so it is deferred out of the
 * update via a microtask (dispatching during an update is disallowed).
 */
const openOnBracketTrigger = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return;
  if (!update.transactions.some((tr) => tr.isUserEvent("input"))) return;
  if (update.state.selection.ranges.length !== 1) return;
  const pos = update.state.selection.main.head;
  const line = update.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  if (parseLinkContext(before)) return; // URL span wins
  if (parseBracketTrigger(before)?.query !== "") return;
  queueMicrotask(() => startCompletion(update.view));
});

/**
 * Editor extension: link-target autocompletion + its keys. `autocompletion()`
 * installs its own completion keymap at `Prec.highest` (Enter accepts, arrows
 * move) so it already outranks markdown()'s `Prec.high` Enter. We add, also at
 * `Prec.highest`: Tab to accept (parity with Enter; falls through to indent when
 * no completion is open). ⌘K (insert a link + open the menu) is the registry
 * command `edit.insertLink`. The
 * `[[` / `【【` trigger opens the same menu via `openOnBracketTrigger`.
 */
export function linkAutocomplete(deps: LinkCompleteDeps): Extension {
  return [
    // Each row is `.ome-state`: CodeMirror writes aria-selected on the row the
    // arrows moved to, and the one definition draws it (spec: app-chrome).
    autocompletion({ override: [(context) => linkSource(context, deps)], optionClass: () => "ome-state" }),
    openOnBracketTrigger,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptCompletion },
        // ⌘K is the registry command `edit.insertLink` (editor-scope keys),
        // dispatched by the editor keymap — not bound here.
      ]),
    ),
  ];
}
