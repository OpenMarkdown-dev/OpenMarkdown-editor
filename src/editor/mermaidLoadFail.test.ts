import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { blockRanges, blockDecorationField } from "./blocks/field";
import { dialectBase, dialectExtensions } from "./dialectParser";
import { mermaidLoadFailed, mermaidLoader, requestMermaid, type MermaidModule } from "./mermaid";
import { livePreviewConfig } from "./previewConfig";
import { withCompleteTree } from "./syntax";

/**
 * A failed mermaid load ends the wait (change: render-placeholder-size, design
 * D5): its own file, because the module keeps a SUCCESSFUL load for the session
 * and `mermaid.test.ts` has one.
 */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a failed mermaid load", () => {
  it("tells every waiter, turns the placeholder back into source, and a later good load clears it", async () => {
    const body = "graph TD\n  load --> fails";
    const doc = `\`\`\`mermaid\n${body}\n\`\`\`\n\nend\n`;
    const offline = () => Promise.reject(new Error("offline"));
    const s = () =>
      withCompleteTree(
        EditorState.create({
          doc,
          selection: { anchor: doc.length },
          extensions: [
            markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }),
            livePreviewConfig.of({ revealOnSelection: true, resolveImage: (x: string) => x }),
            mermaidLoader.of(offline),
            blockDecorationField,
          ],
        }),
      );
    // Before any load: the placeholder.
    expect(blockRanges(s()).map((b) => b.id)).toEqual(["mermaid"]);
    let heard = 0;
    requestMermaid(body, "light", offline, () => heard++, () => true);
    await settle();
    expect(heard).toBe(1);
    expect(mermaidLoadFailed()).toBe(true);
    // Source, unmarked: no block, no failure mark.
    expect(blockRanges(s())).toEqual([]);
    expect(s().field(blockDecorationField).failed.size).toBe(0);
    const good = async () =>
      ({
        initialize: () => {},
        mermaidAPI: { render: async () => ({ svg: "<svg></svg>" }), getSiteConfig: () => ({}) },
      }) as MermaidModule;
    requestMermaid(body, "light", good, () => {}, () => true);
    await settle();
    expect(mermaidLoadFailed()).toBe(false);
  });
});
