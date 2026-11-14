import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { blockDecorationField } from "./blocks/field";
import { MermaidRequests, driverShouldRequest } from "./blocks/mermaid";
import { asyncRenderDone } from "./blocks/render";
import { dialectBase, dialectExtensions } from "./dialectParser";
import { mermaidLoadFailed, mermaidLoader } from "./mermaid";
import { livePreviewConfig } from "./previewConfig";
import { withCompleteTree } from "./syntax";

/**
 * A failed load is not retried in a loop: the waiters hear (`done`), their
 * redraw dispatches `asyncRenderDone`, and that rebuild alone must not make
 * the driver ask again — only what the Render press changes does. Its own
 * file: the module keeps a SUCCESSFUL load for the session.
 */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a failed mermaid load, through the driver", () => {
  it("is attempted once: the redraw it causes does not request again", async () => {
    let attempts = 0;
    const offline = () => {
      attempts++;
      return Promise.reject(new Error("offline"));
    };
    const doc = "intro\n\n```mermaid\ngraph TD\n  retry --> loop\n```\n\nend\n";
    let s = withCompleteTree(
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
    const viewport = () => ({ from: 0, to: s.doc.length });
    // The driver plugin, without a view: the redraw dispatches asyncRenderDone
    // and the plugin's update asks again when `driverShouldRequest` says so.
    let redraws = 0;
    const driver: MermaidRequests = new MermaidRequests(() => {
      if (++redraws > 10) return;
      const tr = s.update({ effects: asyncRenderDone.of(null) });
      const startState = s;
      s = tr.state;
      if (driverShouldRequest({ docChanged: false, selectionSet: false, startState, state: s })) {
        driver.request(s, viewport());
      }
    });
    driver.request(s, viewport());
    for (let i = 0; i < 10; i++) await settle();
    expect(mermaidLoadFailed()).toBe(true);
    expect(attempts).toBe(1);
    expect(redraws).toBe(1);
  });
});
