/**
 * CSS selector specificity, enough of it to compare two rules that target the
 * same element (change: editor-theme-parity, design D5).
 *
 * This exists for ONE failure mode: a theme rule that is written correctly but
 * silently loses the cascade to a third-party base stylesheet. That failure has
 * no alarm — nothing throws, and it can even look fine in one theme while being
 * unreadable in the other, which is exactly how CodeMirror's factory selection
 * color survived in this app until dark mode shipped (app-theme spec: 静默失效
 * 可被发现). Comparing specificity is the part of the cascade that is pure
 * arithmetic, so it is the part a node test can hold.
 *
 * Scope is deliberately narrow — the selectors being compared are theme rules
 * made of classes, combinators and the occasional attribute/pseudo. No `:not()`
 * / `:is()` argument recursion, no specificity-0 pseudo-element handling beyond
 * counting it as a type. Anything outside that shape should be compared by hand
 * rather than trusted to this.
 */

/** `[id, class, type]` — the standard三元组, most significant first. */
export type Specificity = [number, number, number];

/**
 * Count a selector's specificity.
 *
 * Attribute selectors, classes and pseudo-CLASSES all score in the class column;
 * element names and pseudo-ELEMENTS score in the type column; combinators
 * (`>`, `+`, `~`, descendant space) score nothing. Attribute values are stripped
 * first so a `[href="a.b"]` cannot be miscounted as a class.
 */
export function specificity(selector: string): Specificity {
  // Strip attribute VALUES (keep the brackets, they are what we count).
  const s = selector.replace(/\[([^\]=]+)(=[^\]]*)?\]/g, "[$1]");

  const ids = s.match(/#[\w-]+/g)?.length ?? 0;
  const classes = s.match(/\.[\w-]+/g)?.length ?? 0;
  const attrs = s.match(/\[[^\]]*\]/g)?.length ?? 0;
  // `::x` is a pseudo-element (type column); a single `:x` is a pseudo-class.
  // The pseudo-class pattern already skips `::x` (its second colon follows a
  // colon, its first is followed by one), so nothing is subtracted from it —
  // subtracting undercounted `.a:focus::before` as [0,1,1] (change:
  // selection-paint, design D5).
  const pseudoElements = s.match(/::[\w-]+/g)?.length ?? 0;
  const pseudoClasses = s.match(/(?<!:):[\w-]+/g)?.length ?? 0;

  // Type selectors: bare identifiers not preceded by . # : [ or -.
  const types =
    s
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[.#:][\w-]+/g, " ")
      .match(/(?<![\w-])[a-zA-Z][\w-]*/g)?.length ?? 0;

  return [ids, classes + attrs + pseudoClasses, types + pseudoElements];
}

/** `a >= b`? Compares the三元组 left to right, as the cascade does. */
export function atLeastAsSpecific(a: Specificity, b: Specificity): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}
