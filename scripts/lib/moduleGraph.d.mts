// Types for moduleGraph.mjs (the runtime import graph of `src/`; see its header).

export interface ImportRef {
  spec: string;
  /** 1-based line of the declaration / call. */
  line: number;
  /** The declaration's first line, trimmed. */
  text: string;
}

export interface Edge {
  from: string;
  to: string;
  line: number;
  text: string;
}

export interface Graph {
  nodes: string[];
  edges: Edge[];
  dynamic: Edge[];
}

export interface Cycle {
  members: string[];
  /** A shortest cycle through `members[0]`, as edges. */
  path: Edge[];
  /** Every runtime edge inside the component. */
  edges: Edge[];
}

export function parseImports(source: string, fileName?: string): { runtime: ImportRef[]; dynamic: ImportRef[] };
export function resolveImport(from: string, spec: string, files: Set<string>): string | null;
export function buildGraph(sources: Record<string, string>): Graph;
export function stronglyConnected(nodes: string[], edges: Edge[]): string[][];
export function findCycles(graph: Graph): Cycle[];
export function formatCycles(cycles: Cycle[]): string;
