import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { livePreviewConfig } from "./previewConfig";
import { followLink } from "./linkNavigate";

/**
 * `followLink` reads only `view.state` for a local link, so a state stands in
 * for the view (`EditorView` is not constructible in node).
 */
function opened(href: string): Array<[string, string | null]> {
  const calls: Array<[string, string | null]> = [];
  const state = EditorState.create({
    extensions: livePreviewConfig.of({
      revealOnSelection: true,
      resolveImage: () => null,
      docDir: "/notes",
      openLink: (abs, fragment) => calls.push([abs, fragment]),
    }),
  });
  followLink({ state } as unknown as EditorView, href);
  return calls;
}

describe("followLink hands a local link's #fragment to the host", () => {
  it("passes the decoded fragment", () => {
    expect(opened("other.md#set%20up")).toEqual([["/notes/other.md", "set up"]]);
  });

  it("passes null without one, or with an empty one", () => {
    expect(opened("other.md")).toEqual([["/notes/other.md", null]]);
    expect(opened("other.md#")).toEqual([["/notes/other.md", null]]);
  });
});
