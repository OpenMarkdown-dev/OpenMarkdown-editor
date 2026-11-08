import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { StateEffect, StateField, type ChangeSet, type Extension } from "@codemirror/state";
import { editorEnvironment, type SpellMiss, type SpellService } from "./environment";
import { proseContextAt, proseUnits, type ProseUnit } from "./spellProse";
import { treeChanged } from "./syntax";

/**
 * The red lines (spec: spellcheck / 红线由编辑器画,增量检查; change `spellcheck`,
 * design D4). The editor draws them itself: WebKit's own checking is unusable
 * with CodeMirror (spike `spellcheck-spike`, docs/dev-notes.md), so the content
 * keeps CodeMirror's `spellcheck="false"`.
 *
 * - The squiggles are mark decorations in one field. They map through every
 *   change, and the ones an edit touches are dropped on the spot — the word
 *   being typed loses its line now, not after the next check.
 * - A plugin checks the VISIBLE prose (`spellProse.ts` decides what that is),
 *   400 ms after the last edit / scroll, one IPC for every paragraph without a
 *   cached answer. Typing never waits for it: a result that comes back to a
 *   changed document is cached and not drawn.
 * - The class `om-spell-miss` and the colour `--spelling` live here and nowhere
 *   else (`spellcheck.gate.test.ts`, S3).
 *
 * Installed once per editor: the body editor's base extensions and
 * `nestedEditorBase()`. A nested editor (a table cell being edited) checks only
 * while its outer editor does and its place in the outer document is prose.
 */

/** Milliseconds after the last edit / scroll before a check runs. */
export const CHECK_DELAY_MS = 400;
/** Paragraph texts remembered with their answer (oldest dropped first). */
export const CACHE_LIMIT = 4000;

const MISS_CLASS = "om-spell-miss";
const missMark = Decoration.mark({ class: MISS_CLASS });

/** Masked paragraph text → its misspellings. Shared by every editor; cleared when checking turns off. */
const cache = new Map<string, SpellMiss[]>();

function remember(text: string, misses: SpellMiss[]): void {
  cache.delete(text);
  cache.set(text, misses);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

/** The paragraph texts among `units` that still need asking, each once. Pure. */
export function textsToAsk(units: readonly ProseUnit[], known: (text: string) => boolean): string[] {
  const out = new Set<string>();
  for (const u of units) if (!known(u.text)) out.add(u.text);
  return [...out];
}

/** Absolute ranges of the misspellings in `units`, from the answers in `lookup`. Pure. */
export function missRanges(
  units: readonly ProseUnit[],
  lookup: (text: string) => readonly SpellMiss[] | undefined,
): SpellMiss[] {
  const out: SpellMiss[] = [];
  for (const u of units) for (const m of lookup(u.text) ?? []) out.push({ from: u.from + m.from, to: u.from + m.to });
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The new-document ranges `changes` touched (an insertion is a point). Pure. */
export function touchedRanges(changes: ChangeSet): [number, number][] {
  const out: [number, number][] = [];
  changes.iterChangedRanges((_fa, _ta, fromB, toB) => out.push([fromB, toB]));
  return out;
}

/** Does `[from, to)` touch any of `ranges` (overlap, or meet at an edge — typing at a word's end)? Pure. */
export function touches(ranges: readonly [number, number][], from: number, to: number): boolean {
  return ranges.some(([a, b]) => from <= b && to >= a);
}

/** Replace an editor's squiggles (the checker's answer). */
export const setMisses = StateEffect.define<SpellMiss[]>();

/** The squiggles of one editor. */
export const missField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    if (tr.docChanged) {
      set = set.map(tr.changes);
      const touched = touchedRanges(tr.changes);
      set = set.update({ filter: (from, to) => !touches(touched, from, to) });
    }
    for (const e of tr.effects) {
      if (e.is(setMisses)) set = Decoration.set(e.value.map((m) => missMark.range(m.from, m.to)), true);
    }
    return set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function currentMisses(view: EditorView): SpellMiss[] {
  const out: SpellMiss[] = [];
  view.state.field(missField, false)?.between(0, view.state.doc.length, (from, to) => {
    out.push({ from, to });
  });
  return out;
}

const sameMisses = (a: readonly SpellMiss[], b: readonly SpellMiss[]) =>
  a.length === b.length && a.every((m, i) => m.from === b[i].from && m.to === b[i].to);

/** The editor `view` is nested in, if it is a nested (part) editor. */
function outerOf(view: EditorView): EditorView | null {
  const host = view.dom.parentElement?.closest(".cm-editor");
  return host instanceof HTMLElement ? EditorView.findFromDOM(host) : null;
}

/** No spell service from the host: always off, so no squiggle is ever drawn (spec: editor-host). */
const SPELL_OFF: SpellService = {
  isOn: () => false,
  onChange: () => () => {},
  newDocument: () => 0,
  check: async () => null,
  suggestions: async () => [],
  closeDocument: () => {},
};

/** The host's spell service, read at call time. */
const spell = (): SpellService => editorEnvironment().spell ?? SPELL_OFF;

class SpellChecker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private gen = 0;
  private ownDoc: number | null = null;
  private destroyed = false;
  private readonly unsubscribe: () => void;

  constructor(readonly view: EditorView) {
    this.unsubscribe = spell().onChange((on) => {
      if (on) this.schedule(0);
      else {
        cache.clear();
        this.clear();
      }
    });
    if (spell().isOn()) this.schedule(0);
  }

  update(u: ViewUpdate): void {
    if (!spell().isOn()) return;
    if (u.docChanged || u.viewportChanged || treeChanged(u) || u.startState.readOnly !== u.state.readOnly) {
      this.schedule(CHECK_DELAY_MS);
    }
  }

  /** The spell document this editor's text is checked in (a nested editor uses its outer one's). */
  spellDocument(): number | null {
    const outer = outerOf(this.view);
    if (outer) return outer.plugin(spellPlugin)?.spellDocument() ?? null;
    return (this.ownDoc ??= spell().newDocument());
  }

  /** Should this editor check now? */
  active(): boolean {
    if (!spell().isOn() || this.view.state.readOnly) return false;
    const outer = outerOf(this.view);
    if (!outer) return true;
    const outerChecker = outer.plugin(spellPlugin);
    if (!outerChecker?.active()) return false;
    return proseContextAt(outer.state, outer.posAtDOM(this.view.dom));
  }

  schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  private clear(): void {
    this.gen++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.destroyed && currentMisses(this.view).length > 0) this.view.dispatch({ effects: setMisses.of([]) });
  }

  private visibleUnits(): ProseUnit[] {
    const seen = new Set<number>();
    const out: ProseUnit[] = [];
    for (const { from, to } of this.view.visibleRanges) {
      for (const u of proseUnits(this.view.state, from, to)) {
        if (seen.has(u.from)) continue;
        seen.add(u.from);
        out.push(u);
      }
    }
    return out;
  }

  private async run(): Promise<void> {
    const gen = ++this.gen;
    if (this.destroyed) return;
    if (!this.active()) {
      this.clear();
      return;
    }
    const { view } = this;
    const doc = view.state.doc;
    const units = this.visibleUnits();
    const ask = textsToAsk(units, (t) => cache.has(t));
    if (ask.length > 0) {
      const spellDoc = this.spellDocument();
      if (spellDoc === null) return;
      const answers = await spell().check(spellDoc, ask);
      if (!answers || answers.length !== ask.length) return; // logged; nothing cached, asked again next run
      if (!spell().isOn()) return; // turned off while asking: cache cleared, keep it so
      ask.forEach((text, i) => remember(text, answers[i]));
    }
    // A newer run, a changed document or a destroyed view: this answer is
    // cached, not drawn (typing never waits for the checker).
    if (gen !== this.gen || this.destroyed || view.state.doc !== doc || !this.active()) return;
    const next = missRanges(units, (t) => cache.get(t));
    if (!sameMisses(next, currentMisses(view))) view.dispatch({ effects: setMisses.of(next) });
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    if (this.timer) clearTimeout(this.timer);
    if (this.ownDoc !== null) spell().closeDocument(this.ownDoc);
  }
}

const spellPlugin = ViewPlugin.fromClass(SpellChecker);

const spellTheme = EditorView.baseTheme({
  // Longhands: this WebKit drops the `text-decoration` shorthand with a style
  // and a colour (computed stays `none`; spike, docs/dev-notes.md).
  [`.${MISS_CLASS}`]: {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: "var(--ome-spelling)",
    textDecorationThickness: "2px",
    textUnderlineOffset: "3px",
  },
});

/** The red lines for an editor. `false` (an editor with no editor menu, e.g. the feedback composer) installs nothing. */
export function spellChecking(enabled = true): Extension {
  return enabled ? [missField, spellPlugin, spellTheme] : [];
}

/** The class a squiggle carries — exported for the harness's style probe only. */
export const SPELL_MISS_CLASS = MISS_CLASS;

/** A misspelling under `pos` in `view`, if one is drawn there. */
export function misspellingAt(view: EditorView, pos: number): SpellMiss | null {
  let found: SpellMiss | null = null;
  view.state.field(missField, false)?.between(pos, pos, (from, to) => {
    if (pos >= from && pos <= to) {
      found = { from, to };
      return false;
    }
  });
  return found;
}

/** Up to five suggestions for a drawn misspelling (asked now: ~20 ms a word). */
export async function spellingSuggestions(view: EditorView, miss: SpellMiss): Promise<string[]> {
  const doc = view.plugin(spellPlugin)?.spellDocument();
  if (doc == null) return [];
  const unit = proseUnits(view.state, miss.from, miss.to).find((u) => u.from <= miss.from && miss.to <= u.from + u.text.length);
  if (!unit) return [];
  return spell().suggestions(doc, unit.text, miss.from - unit.from, miss.to - unit.from);
}

/**
 * Replace the misspelling that starts at `pos` with `word`, as one undoable
 * edit. If the document changed since the right-click and no squiggle starts
 * there any more, nothing happens — never a guess elsewhere.
 */
export function replaceMisspelling(view: EditorView, pos: number, word: string): boolean {
  const miss = misspellingAt(view, pos);
  if (!miss || miss.from !== pos) return false;
  view.dispatch({
    changes: { from: miss.from, to: miss.to, insert: word },
    selection: { anchor: miss.from + word.length },
    userEvent: "input.spellcheck",
  });
  return true;
}
