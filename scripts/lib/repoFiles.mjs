// Repo files and repo paths for the source-scanning gates — the ONE place they
// are made.
//
// RULE: every repo path a gate compares (an allowlist entry, an owner, a
// `file:line` message, an expected fixture name) is POSIX-form (`lib/disk.ts`,
// never `lib\disk.ts`), and it is produced only here: list the files with
// `listFiles` / `listDirs`, name them with `repoPath`. A gate that walks the
// tree with its own `readdirSync` and names files with `path.relative` /
// `join` / `slice(ROOT.length + 1)` gets the host separator, which is `\` on
// Windows — so its allowlists stop matching there and nowhere else (the
// v0.15.0 Windows release lane: 12 red tests, macOS/Linux green).
// `repoFiles.gate.test.ts` next to this file holds the tests and the gate
// scripts to that.
//
// Order is deterministic and the same on every OS: sorted by the POSIX form of
// the path below `dir`.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/** `pattern` as a predicate over an entry's base name; no pattern → `fallback`. */
function matcher(pattern, fallback) {
  if (!pattern) return () => fallback;
  if (pattern instanceof RegExp) return (name) => pattern.test(name);
  return pattern;
}

/** Is `abs` a directory? Follows symlinks, like `statSync`. */
function isDir(dir, entry) {
  if (entry.isSymbolicLink()) return statSync(path.join(dir, entry.name)).isDirectory();
  return entry.isDirectory();
}

/** `abs` relative to `from`, always with `/` separators. `p` is the path flavour (tests pass `path.win32`). */
export function repoPath(from, abs, p = path) {
  return p.relative(from, abs).split(p.sep).join("/");
}

const byRepoPath = (from) => (a, b) => {
  const x = repoPath(from, a);
  const y = repoPath(from, b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Every file under `dir` (absolute paths, sorted). `include` / `exclude` test
 * an entry's base name: `include` picks files; `exclude` drops files and prunes
 * whole directories. `recursive: false` lists `dir` itself only.
 */
export function listFiles(dir, { include, exclude, recursive = true } = {}) {
  const want = matcher(include, true);
  const skip = matcher(exclude, false);
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (skip(e.name)) continue;
      const abs = path.join(d, e.name);
      if (isDir(d, e)) {
        if (recursive) walk(abs);
      } else if (want(e.name)) out.push(abs);
    }
  };
  walk(dir);
  return out.sort(byRepoPath(dir));
}

/** The directories directly inside `dir` (absolute paths, sorted). */
export function listDirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => isDir(dir, e))
    .map((e) => path.join(dir, e.name))
    .sort(byRepoPath(dir));
}
