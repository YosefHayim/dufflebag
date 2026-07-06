/**
 * Filesystem helpers and package-asset locators.
 *
 * The CLI runs from `dist/cli.js` inside the installed npm package, but it has
 * to copy two kinds of bundled assets out to the user's ~/.claude: the compiled
 * hook JS (`dist/hooks`) and the skill markdown (`src/skills/`). These helpers
 * resolve those source locations relative to the running file so it works the
 * same under `npx`, a global install, or `pnpm dev`.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to the installed package root. Resolved by walking up to the
 * nearest `package.json` rather than a fixed hop count, so it is correct both
 * built (`dist/src/core/fs.js`) and under `tsx` dev (`src/core/fs.ts`),
 * whose depths differ once the compiler roots at the repo (rootDir ".").
 */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, "package.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // hit the filesystem root — give up gracefully
    dir = parent;
  }
  return dir;
}

/** Directory holding the compiled hook payload that gets copied to the install dir. */
export function bundledHooksDir(): string {
  return path.join(packageRoot(), "dist", "hooks");
}

/** Directory holding the shipped skill folders (each with a SKILL.md). */
export function bundledSkillsDir(): string {
  return path.join(packageRoot(), "src", "skills");
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Recursively copy `src` to `dest`, replacing whatever is there. The existing
 * `dest` is removed first so a real directory can replace a symlink or file left
 * by a prior install (e.g. a symlinked personal skill in a mirror target) —
 * `cpSync` alone throws when overwriting a non-directory with a directory.
 */
export function copyDir(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, force: true });
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function removePath(target: string): void {
  rmSync(target, { recursive: true, force: true });
}
