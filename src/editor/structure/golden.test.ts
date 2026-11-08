import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorState } from "@codemirror/state";
import { blessGolden, foldLines, foldedLines, goldenState, mark, parseGolden } from "./golden";
import { runStructureKey, type StructureKey } from ".";
import { listFiles, repoPath } from "../../../scripts/lib/repoFiles.mjs";

/** Press one key through the entry, as the body editor's keymap would. */
function press(state: EditorState, key: StructureKey): EditorState {
  let next = state;
  runStructureKey({ state, dispatch: (tr) => (next = tr.state) }, key);
  return next;
}

const DIR = join(__dirname, "../../../fixtures/structure-keys");

const UPDATE = process.env.GOLDEN_UPDATE === "1";

for (const path of listFiles(DIR, { include: /\.md$/, recursive: false })) {
  const file = repoPath(DIR, path);
  const source = readFileSync(path, "utf8");
  const cases = parseGolden(source);
  const actuals: string[] = [];
  describe(`fixtures/structure-keys/${file}`, () => {
    cases.forEach((c, i) => {
      it(`${c.title} (line ${c.line})`, () => {
        let state = foldLines(goldenState(c.before, c.readOnly), c.fold);
        for (const key of c.keys) state = press(state, key);
        actuals[i] = mark(state);
        if (!UPDATE) expect(actuals[i]).toBe(c.after);
        if (c.foldAfter) expect(foldedLines(state)).toEqual(c.foldAfter);
      });
    });
    if (UPDATE) afterAll(() => writeFileSync(path, blessGolden(source, actuals)));
  });
}
