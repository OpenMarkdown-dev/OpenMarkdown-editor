import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests run in node (no DOM): editor logic is tested through pure helpers and
// EditorState, never a mounted EditorView. `@/` is the source root, as in the
// build (`build.mjs`) and `tsconfig.json`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node" },
});
