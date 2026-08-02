#!/usr/bin/env node
/**
 * assembleHooks — gather the vertical per-feature hook sources into the single
 * flat, self-contained `dist/hooks/` payload the installer copies wholesale.
 *
 * Sources are vertical (`src/hookIsland/<feature>/hooks/*`, `src/hookIsland/<feature>/lib/*`)
 * and the shared zero-dep kernel lives in `src/runtime/*`; the *output* is flat
 * (ADR 0008: source structure ≠ output structure). Entry hooks land at
 * `dist/hooks/*.js`, their kernel + feature libs at `dist/hooks/lib/*.js`, and
 * each entry hook's cross-dir import specifiers are rewritten to the flat
 * `./lib/` layout. This keeps install/uninstall, the `PATH_MARKER`, and the
 * `HOOK` map unchanged.
 *
 * Zero-dependency by design (ADR 0006 prefers a hand-rolled step over a bundler);
 * the shipped payload therefore stays dependency-free (ADR 0001). tsc emits
 * import specifiers verbatim under NodeNext, so the rewrite targets are stable.
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ENTRY = path.join(ROOT, "dist", "src", "cli", "main.js");
const DIST_ISLAND = path.join(ROOT, "dist", "src", "hookIsland");
const SKILL_CONTENT_DIRECTORY = path.join(ROOT, "dist", "src", "runtime");
const OUT_HOOKS = path.join(ROOT, "dist", "hooks");
const OUT_LIB = path.join(OUT_HOOKS, "lib");

/**
 * Cross-dir import specifiers tsc emits (verbatim under NodeNext) and the flat
 * sibling they map to in the assembled payload:
 *   ../../../runtime/config.js      →  ./lib/config.js   (shared kernel)
 *   ../../../payload/config.js      →  ./lib/config.js   (legacy path during transition)
 *   ../lib/state.js                 →  ./lib/state.js    (feature-local lib)
 */
const IMPORT_REWRITES = [
  ["../../../runtime/", "./lib/"],
  ["../../../payload/", "./lib/"],
  ["../lib/", "./lib/"],
];

/** Rewrite a compiled entry hook's cross-dir specifiers to the flat sibling layout. */
const flatten = (code) => IMPORT_REWRITES.reduce((out, [from, to]) => out.replaceAll(from, to), code);

/** Copy every `.js` in `fromDir` into `toDir`, optionally transforming its text. */
const copyJs = ({ fromDir, toDir, transform }) => {
  if (!existsSync(fromDir)) return 0;
  let n = 0;
  // Walk the directory entry by entry so the returned count covers only the `.js` files written.
  for (const name of readdirSync(fromDir)) {
    if (!name.endsWith(".js")) continue;
    const code = readFileSync(path.join(fromDir, name), "utf8");
    writeFileSync(path.join(toDir, name), transform ? transform(code) : code, "utf8");
    n++;
  }
  return n;
};

const main = () => {
  if (!existsSync(DIST_ISLAND)) {
    throw new Error("dist/src/hookIsland is missing — run `tsc` before assembling the hook payload.");
  }
  if (!existsSync(CLI_ENTRY)) {
    throw new Error("dist/src/cli/main.js is missing — run `tsc` before finalizing the build.");
  }
  chmodSync(CLI_ENTRY, 0o755);
  rmSync(OUT_HOOKS, { recursive: true, force: true });
  mkdirSync(OUT_LIB, { recursive: true });

  let hooks = 0;
  // Each feature contributes its entry hooks (rewritten, flat) and feature libs.
  for (const feature of readdirSync(DIST_ISLAND)) {
    hooks += copyJs({ fromDir: path.join(DIST_ISLAND, feature, "hooks"), toDir: OUT_HOOKS, transform: flatten });
    copyJs({ fromDir: path.join(DIST_ISLAND, feature, "lib"), toDir: OUT_LIB });
  }
  // The shared zero-dep kernel (config SSOT + io) sits alongside the feature libs.
  copyJs({ fromDir: SKILL_CONTENT_DIRECTORY, toDir: OUT_LIB });

  const libs = readdirSync(OUT_LIB).filter((n) => n.endsWith(".js")).length;
  console.log(`assembled dist/hooks: ${hooks} hook(s) + ${libs} lib(s)`);
};

main();
