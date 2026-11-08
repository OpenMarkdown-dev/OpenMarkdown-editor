// Types for repoFiles.mjs (the one producer of POSIX-form repo paths; see its header).
import type { PlatformPath } from "node:path";

/** A test over an entry's base name. */
export type NameFilter = RegExp | ((name: string) => boolean);

export interface ListOptions {
  /** Files to keep, by base name (default: all). */
  include?: NameFilter;
  /** Files to drop and directories to prune, by base name (default: none). */
  exclude?: NameFilter;
  /** Descend into subdirectories (default: true). */
  recursive?: boolean;
}

/** `abs` relative to `from`, always with `/` separators. */
export function repoPath(from: string, abs: string, p?: PlatformPath): string;

/** Every file under `dir`: absolute paths, sorted by their POSIX form below `dir`. */
export function listFiles(dir: string, options?: ListOptions): string[];

/** The directories directly inside `dir`: absolute paths, sorted. */
export function listDirs(dir: string): string[];
