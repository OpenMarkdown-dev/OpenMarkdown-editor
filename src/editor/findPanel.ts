import { EditorView, runScopeHandlers } from "@codemirror/view";
import type { Panel, ViewUpdate } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import { editorString } from "./strings";
import { matchTotal, matchOrdinal } from "./findCount";
import { perfProbeEnabled, logFindCount } from "@/lib/perfProbe";
import { editorFieldClasses, editorIconButton, editorTextButton, type EditorGlyph } from "./controls";

/**
 * Custom find/replace panel (change: find-ui, design D1). Plain-DOM CM Panel —
 * the editor layer stays React-free. Only the panel UI is ours: the query
 * engine (SearchQuery, decorations, findNext/replaceNext/...) is entirely
 * @codemirror/search, wired through `search({ createPanel })` in index.ts.
 */

/** Programmatic entry for the `edit.find` command (appCommands / palette). */
export function openFindPanel(view: EditorView): void {
  openSearchPanel(view);
}

/**
 * The panel's buttons come from the editor's one control factory (change:
 * editor-controls, D5): md ghost icon buttons (‹ › ✕) and md text buttons (Aa,
 * Replace, Replace all), on the ruler like the app's own — the same classes as
 * IconButton / Button. Hover and the case toggle's aria-pressed are `.ome-state`.
 */
function iconButton(glyph: EditorGlyph, label: string, onClick: () => void): HTMLButtonElement {
  const b = editorIconButton({ glyph, size: "md", title: label, className: "om-find-button" });
  b.addEventListener("click", onClick);
  return b;
}

function textButton(text: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = editorTextButton({ label: text, size: "md", title: label, className: "om-find-button" });
  b.addEventListener("click", onClick);
  return b;
}

export function createFindPanel(view: EditorView): Panel {
  // Query state persists in the search field across open/close; the panel is
  // recreated each open, so seed the controls from the current query.
  const initial = getSearchQuery(view.state);
  let caseSensitive = initial.caseSensitive;
  // IME composition freeze (design D7, CommandPalette precedent): while
  // composing, never dispatch setSearchQuery — highlights and the count must
  // not churn on uncommitted pinyin. compositionend commits once.
  let composing = false;

  const dom = document.createElement("div");
  // Chrome type (the label tier) for the count; the controls bring their own.
  dom.className = "om-find-panel ome-type-label";

  // Single close path, shared by the Esc key and the visible [Esc] keycap
  // (design D1): close the panel, clear match highlights, and hand focus back
  // explicitly — CM never focuses a non-editable content DOM by itself, so the
  // keyboard would go dead in reading mode otherwise.
  function closePanel(): void {
    closeSearchPanel(view);
    view.contentDOM.focus({ preventScroll: true });
  }

  // ——— Find row: input, count, prev/next, case toggle ———
  const findRow = document.createElement("div");
  findRow.className = "om-find-row";

  const input = document.createElement("input");
  input.type = "text";
  // `.ome-field`: --ome-border at rest, the accent while focused; the
  // md ruler's height, inset and type size, so it lines up with the buttons.
  input.className = `om-find-input ${editorFieldClasses("md")}`;
  input.placeholder = editorString("find.placeholder");
  input.value = initial.search;
  // The search extension focuses+selects `[main-field]` when openSearchPanel
  // runs on an already-open panel (repeat Cmd+F).
  input.setAttribute("main-field", "true");

  const count = document.createElement("span");
  count.className = "om-find-count";

  const prevButton = iconButton("chevronUp", editorString("find.previous"), () => {
    findPrevious(view);
    input.focus();
  });
  const nextButton = iconButton("chevronDown", editorString("find.next"), () => {
    findNext(view);
    input.focus();
  });

  const caseButton = textButton("Aa", editorString("find.matchCase"), () => {
    caseSensitive = !caseSensitive;
    caseButton.setAttribute("aria-pressed", String(caseSensitive));
    commit();
    input.focus();
  });
  caseButton.setAttribute("aria-pressed", String(caseSensitive));

  // Visible × close button at the row's right end (design D1): a mouse way out of
  // the panel. Same ghost-icon-button style as the prev/next chevrons; clicking it
  // runs the SAME close path as the Esc key (closePanel above) — no second close
  // semantic. The tooltip carries the "(Esc)" hint so the keyboard way stays
  // discoverable without a heavy always-visible keycap (find.close).
  const closeButton = iconButton("close", editorString("find.close"), closePanel);
  // Don't let the mousedown steal focus/selection before the click closes.
  closeButton.addEventListener("mousedown", (e) => e.preventDefault());

  findRow.append(input, count, prevButton, nextButton, caseButton, closeButton);

  // ——— Replace row: gated on readOnly (design D2) ———
  const replaceRow = document.createElement("div");
  replaceRow.className = "om-find-row om-find-replace-row";

  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.className = `om-find-input ${editorFieldClasses("md")}`;
  replaceInput.placeholder = editorString("find.replacePlaceholder");
  replaceInput.value = initial.replace;

  const replaceButton = textButton(editorString("find.replace"), editorString("find.replace"), () => replaceNext(view));
  const replaceAllButton = textButton(editorString("find.replaceAll"), editorString("find.replaceAll"), () => replaceAll(view));

  replaceRow.append(replaceInput, replaceButton, replaceAllButton);

  dom.append(findRow, replaceRow);

  function currentQuery(): SearchQuery {
    return new SearchQuery({
      search: input.value,
      caseSensitive,
      // Literal string matching only — regexp/wholeWord stay off (spec
      // non-goal); literal also keeps "\n" in a query a literal backslash-n.
      literal: true,
      replace: replaceInput.value,
    });
  }

  function commit(): void {
    const query = currentQuery();
    if (!query.eq(getSearchQuery(view.state))) {
      view.dispatch({ effects: setSearchQuery.of(query) });
    }
  }

  // Match-count cache (change: find-count-perf). The total is O(document) to
  // compute, so cache it and recompute only when the query or document changes
  // (totalDirty) — never on a plain cursor move, which just refreshes the cheap
  // bounded ordinal against the cached total (design D1/D2). Recounts off the
  // update() churn are trailing-edge debounced (scheduleRecount); the panel
  // still opens with an immediate first count (renderCount called directly at
  // creation), so only the churn is coalesced, not the first paint (D3).
  let cachedTotal = 0;
  let totalDirty = true;
  let recountTimer: ReturnType<typeof setTimeout> | null = null;
  const RECOUNT_DEBOUNCE_MS = 120;

  function renderCount(): void {
    const query = getSearchQuery(view.state);
    if (!query.valid) {
      cachedTotal = 0;
      count.textContent = "";
      input.classList.remove("om-find-no-match");
      return;
    }
    if (totalDirty) {
      const t0 = perfProbeEnabled ? performance.now() : 0;
      cachedTotal = matchTotal(view.state, query);
      if (perfProbeEnabled) logFindCount(cachedTotal, performance.now() - t0);
      totalDirty = false;
    }
    const sel = view.state.selection.main;
    const current = matchOrdinal(view.state, query, sel.from, sel.to);
    count.textContent = editorString("find.count", {
      current: String(current),
      total: String(cachedTotal),
    });
    // 0/0 turns the input to the error color; no dialog, typing recovers.
    input.classList.toggle("om-find-no-match", cachedTotal === 0);
  }

  /**
   * Trailing-edge debounce: reset the timer on each call so a burst of
   * doc/selection/query changes collapses to one recount after activity settles
   * (design D3). The final scan reads live view.state, so the settled count is
   * always consistent with the query/doc/selection.
   */
  function scheduleRecount(): void {
    if (recountTimer !== null) clearTimeout(recountTimer);
    recountTimer = setTimeout(() => {
      recountTimer = null;
      renderCount();
    }, RECOUNT_DEBOUNCE_MS);
  }

  function syncReadOnly(): void {
    replaceRow.style.display = view.state.readOnly ? "none" : "";
  }

  for (const field of [input, replaceInput]) {
    field.addEventListener("compositionstart", () => {
      composing = true;
    });
    field.addEventListener("compositionend", () => {
      composing = false;
      commit();
    });
    field.addEventListener("input", () => {
      if (!composing) commit();
    });
  }

  dom.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key === "Enter" && event.target === input) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(view);
      return;
    }
    if (event.key === "Enter" && event.target === replaceInput) {
      event.preventDefault();
      replaceNext(view);
      return;
    }
    // Route the rest through searchKeymap's "search-panel" scope (Mod-f
    // reselects the input, Mod-g/F3 navigate).
    if (runScopeHandlers(view, event, "search-panel")) event.preventDefault();
  });

  syncReadOnly();
  renderCount();

  return {
    dom,
    mount() {
      input.focus();
      input.select();
    },
    update(update: ViewUpdate) {
      let recount = update.docChanged || update.selectionSet;
      // The total only changes with the document or the query; a plain
      // selection change reuses the cached total (design D1). Mark it dirty here
      // and the debounced renderCount rescans once.
      if (update.docChanged) totalDirty = true;
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (!effect.is(setSearchQuery)) continue;
          recount = true;
          totalDirty = true;
          const query = effect.value;
          caseSensitive = query.caseSensitive;
          caseButton.setAttribute("aria-pressed", String(caseSensitive));
          // External query updates (selection prefill on repeat Cmd+F) sync
          // into the fields; guarded so our own commits and live IME
          // composition never clobber the caret.
          if (!composing && input.value !== query.search) input.value = query.search;
          if (!composing && replaceInput.value !== query.replace) {
            replaceInput.value = query.replace;
          }
        }
      }
      // Mode switches reconfigure readOnly through the compartment — follow.
      if (update.startState.readOnly !== update.state.readOnly) syncReadOnly();
      if (recount) scheduleRecount();
    },
    destroy() {
      // Panel is recreated each open — drop any pending debounced recount so its
      // timer can't fire against a torn-down panel/view (design D3).
      if (recountTimer !== null) clearTimeout(recountTimer);
    },
  };
}
