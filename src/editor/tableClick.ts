/**
 * Pure click routing for a rendered GFM table widget (change: table-cell-link-navigation).
 *
 * `TableWidget` returns `true` from `ignoreEvent()`, so CodeMirror never routes
 * clicks inside a rendered table — not even to the editor's own Cmd/Ctrl+click
 * link handler. The widget therefore has to decide for itself what a click means,
 * and that decision is pure branch ORDER. It lives here, away from the DOM, so it
 * can be unit-tested (`EditorView` is not constructible in node, and there is no
 * jsdom — see CLAUDE.md); the widget's listener stays a thin adapter that reads
 * these inputs off the event and performs the returned action.
 */

import { clickFollowsLink } from "./linkGesture";

export type TableClickAction =
  /** Follow a link rendered inside a cell (routing: `linkResolve` + `followLink`). */
  | { kind: "navigate"; href: string }
  /** Enter in-place editing of this cell (spec: 单元格原位编辑). */
  | { kind: "edit"; row: number; col: number }
  /** Do nothing and DON'T preventDefault — native scrolling / caret must survive. */
  | { kind: "none" };

export interface TableClickInput {
  /** Cmd (macOS) or Ctrl held — the navigation gesture, same as body links. */
  modifier: boolean;
  /** href of the nearest enclosing rendered link, or null if the click missed one. */
  linkHref: string | null;
  /** The click landed inside the cell input that is already being edited. */
  inActiveInput: boolean;
  /** Grid position of the nearest enclosing cell; null = scrollbar / border / padding. */
  cell: { row: number; col: number } | null;
  /** Reading mode — no in-place editing, but links still navigate. */
  readOnly: boolean;
}

/**
 * Decide what a mousedown inside a rendered table means. Branch ORDER carries the
 * contract:
 *
 *   1. A click on a link that follows links (`clickFollowsLink`: Cmd/Ctrl, or
 *      any click in reading mode) navigates — checked FIRST, above the read-only
 *      gate, because reading mode must follow links too. Putting the read-only
 *      return first is exactly the bug change table-cell-link-navigation fixed.
 *   2. Read-only otherwise does nothing: no in-place editing in reading mode.
 *   3. The active cell input owns its own caret.
 *   4. A click that hits no cell (scrollbar / border / outer padding) is left to
 *      the browser so a wide table stays scrollable (spec: 宽表横向滚动).
 *   5. Anything else enters that cell.
 */
export function tableClickAction(input: TableClickInput): TableClickAction {
  if (input.linkHref && clickFollowsLink(input.modifier, input.readOnly)) {
    return { kind: "navigate", href: input.linkHref };
  }
  if (input.readOnly) return { kind: "none" };
  if (input.inActiveInput) return { kind: "none" };
  if (!input.cell) return { kind: "none" };
  return { kind: "edit", row: input.cell.row, col: input.cell.col };
}
