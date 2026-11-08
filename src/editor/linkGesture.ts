/**
 * Which click follows a rendered link (spec: live-preview-editor / 链接点击导航).
 *
 * One rule for both places that can hit a link — body text (`livePreview.ts`)
 * and a rendered table cell (`tableClick.ts`) — so links never behave
 * differently inside tables:
 *
 *   - live and source: Cmd/Ctrl+click follows; a plain click places the caret
 *     to edit there (design D1);
 *   - reading: a plain click follows too — there is no caret to place, so a
 *     link should act like a link.
 */
export function clickFollowsLink(modifier: boolean, readOnly: boolean): boolean {
  return modifier || readOnly;
}
