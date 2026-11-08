import type { MermaidModule } from "./mermaid";

/**
 * The editor's one `import("mermaid")` (change: editor-integration-fixes; spec:
 * editor-package / 无图表的入口). Everything else about diagrams lives in
 * `./mermaid.ts`, which never names the package: a state renders diagrams only
 * with this loader installed (`mermaidLoader`). The full entry (`./index.ts`)
 * installs it; the diagram-free entry (`./base.ts`) does not import this file,
 * so a bundler building that entry never sees Mermaid.
 */
export const importMermaid = (): Promise<MermaidModule> =>
  import("mermaid").then((m) => m.default as unknown as MermaidModule);
