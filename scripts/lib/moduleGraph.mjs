// The runtime import graph of `src/` and its cycles — the ONE place they are
// computed (spec: module-graph / 运行时 import 不成环; gate:
// `src/moduleGraph.gate.test.ts`).
//
// An edge is a STATIC import that survives to runtime:
//   import x from "…" / import { a } from "…" / import * as n from "…" / import "…"
//   export { a } from "…" / export * from "…" / export * as n from "…"
// NOT an edge (erased by TypeScript / esbuild before the module runs):
//   import type …, export type …, and `import { type A, type B }` /
//   `export { type A }` where EVERY specifier is `type`.
// Dynamic `import("…")` is collected separately: it runs after the importer has
// finished evaluating, so it cannot close an evaluation-order cycle.
//
// Resolution: `@/x` → `src/x` (tsconfig `paths` / vite `resolve.alias`),
// `./x` and `../x` relative to the importer; then the exact path, `.ts`,
// `.tsx`, `/index.ts`, `/index.tsx`, in that order. A query (`?url`, `?raw`)
// is dropped. Anything that does not resolve to a file in the graph (a
// package, a stylesheet, an asset) is not an edge.
//
// Parsing is TypeScript's own parser (`ts.createSourceFile`), so comments,
// strings and multi-line import lists are not guessed at.
//
// Limits (stated, not hidden): a value import used ONLY in type positions is
// also erased at runtime, but telling that needs the type checker — such an
// import is counted as an edge (conservative: the fix is to write `import type`).
// Vite's demo-only aliases (`./fixtureGlob`, `./demoAssets`) are not applied;
// the plain relative file they replace is what the app build resolves.

import ts from "typescript";
import path from "node:path";

const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/** All named specifiers are `type` → the whole declaration is erased. */
function allTypeOnly(elements) {
  return elements.length > 0 && elements.every((e) => e.isTypeOnly);
}

/**
 * The imports of one source text: `{ runtime, dynamic }`, each a list of
 * `{ spec, line, text }` (1-based line, the declaration's first line, trimmed).
 */
export function parseImports(source, fileName = "x.ts") {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const runtime = [];
  const dynamic = [];
  const at = (node, spec) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const text = node.getText(sf).split("\n")[0].trim();
    return { spec, line, text };
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const c = st.importClause;
      if (c) {
        if (c.isTypeOnly) continue;
        const nb = c.namedBindings;
        if (!c.name && nb && ts.isNamedImports(nb) && allTypeOnly(nb.elements)) continue;
      }
      runtime.push(at(st, st.moduleSpecifier.text));
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      if (st.isTypeOnly) continue;
      const ec = st.exportClause;
      if (ec && ts.isNamedExports(ec) && allTypeOnly(ec.elements)) continue;
      runtime.push(at(st, st.moduleSpecifier.text));
    }
  }
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      dynamic.push(at(node, node.arguments[0].text));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { runtime, dynamic };
}

/**
 * Resolve `spec` imported from `from` (both POSIX repo-relative paths under
 * the graph root, e.g. `editor/blocks/field.ts`) against the set `files`.
 * Returns the target path, or null when it is not a file of the graph.
 */
export function resolveImport(from, spec, files) {
  const bare = spec.split("?")[0];
  let base;
  if (bare.startsWith("@/")) base = bare.slice(2);
  else if (bare === "." || bare === ".." || bare.startsWith("./") || bare.startsWith("../")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(from), bare));
  } else return null;
  for (const ext of EXTS) {
    const p = base + ext;
    if (files.has(p)) return p;
  }
  return null;
}

/**
 * Build the graph from `{ [repoPath]: sourceText }`. Returns
 * `{ nodes, edges, dynamic }`; `edges` / `dynamic` are lists of
 * `{ from, to, line, text }`.
 */
export function buildGraph(sources) {
  const nodes = Object.keys(sources).sort();
  const files = new Set(nodes);
  const edges = [];
  const dynamic = [];
  for (const from of nodes) {
    const parsed = parseImports(sources[from], from);
    for (const [list, out] of [
      [parsed.runtime, edges],
      [parsed.dynamic, dynamic],
    ]) {
      for (const imp of list) {
        const to = resolveImport(from, imp.spec, files);
        if (to) out.push({ from, to, line: imp.line, text: imp.text });
      }
    }
  }
  return { nodes, edges, dynamic };
}

/** Tarjan's strongly connected components over `{ nodes, edges }`. */
export function stronglyConnected(nodes, edges) {
  const adj = new Map(nodes.map((n) => [n, []]));
  for (const e of edges) adj.get(e.from)?.push(e.to);
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const out = [];
  const strong = (v) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp.sort());
    }
  };
  for (const n of nodes) if (!idx.has(n)) strong(n);
  return out;
}

/**
 * Every cycle-bearing component: `{ members, path, edges }` where `path` is a
 * shortest cycle through the first member (`a → b → … → a`, as edges) and
 * `edges` is every runtime edge inside the component. Sorted, deterministic.
 */
export function findCycles(graph) {
  const comps = stronglyConnected(graph.nodes, graph.edges);
  const cycles = [];
  for (const members of comps) {
    const inside = new Set(members);
    const internal = graph.edges.filter((e) => inside.has(e.from) && inside.has(e.to));
    const selfLoop = internal.some((e) => e.from === e.to);
    if (members.length < 2 && !selfLoop) continue;
    const start = members[0];
    // BFS from start back to start, inside the component.
    const prev = new Map();
    const queue = [start];
    let closing = null;
    while (queue.length && !closing) {
      const v = queue.shift();
      for (const e of internal) {
        if (e.from !== v) continue;
        if (e.to === start) {
          closing = e;
          break;
        }
        if (!prev.has(e.to)) {
          prev.set(e.to, e);
          queue.push(e.to);
        }
      }
    }
    const pathEdges = [closing];
    for (let n = closing.from; n !== start; n = prev.get(n).from) pathEdges.unshift(prev.get(n));
    cycles.push({ members, path: pathEdges, edges: internal });
  }
  return cycles.sort((a, b) => (a.members[0] < b.members[0] ? -1 : 1));
}

/** Human-readable report of `findCycles` output (one block per cycle). */
export function formatCycles(cycles) {
  return cycles
    .map((c) => {
      const chain = [c.path[0].from, ...c.path.map((e) => e.to)].join(" → ");
      const lines = c.edges.map((e) => `    ${e.from}:${e.line}  ${e.text}`);
      return `cycle (${c.members.length} modules): ${chain}\n  runtime edges inside it:\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
