/**
 * Find `@agent` addressing tokens in a single line, for the provenance-color
 * decoration (spec: live-preview-editor / `@agent` 出处色渲染). Matches the bare
 * `@agent` and the named `@agent(name)` forms of the agent-plugin marker
 * convention, but only as standalone tokens: the `@` must sit at a boundary
 * (not glued to a preceding word char or `@`), and the token must be followed by
 * whitespace or end-of-line. It deliberately misses `@agent@example.com` (email),
 * `@agentfoo` (word run) and a bare `@` — coloring is pure decoration, so a miss
 * is harmless where a mismark is not (design: 保守匹配). Returns `[from, to)`
 * offsets relative to the line start. Pure (unit-tested; no EditorView in node).
 */
export function matchAgentTokens(line: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const re = /@agent(?:\([^)]*\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    // Left boundary: start-of-line, or a char that isn't a word char / `@`
    // (rejects `foo@agent`, `x@agent` email local parts).
    const prev = from > 0 ? line[from - 1] : "";
    if (prev && /[\w@]/.test(prev)) continue;
    // Right boundary: end-of-line or whitespace (rejects `@agentfoo`,
    // `@agent@example.com`, `@agent(claude)draft`).
    const next = to < line.length ? line[to] : "";
    if (next && !/\s/.test(next)) continue;
    out.push({ from, to });
  }
  return out;
}
