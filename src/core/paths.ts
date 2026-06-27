/**
 * Filesystem layout resolver.
 *
 * Every command needs to know, for a given scope, where the Claude Code config
 * lives, where the bag's self-contained JS payload goes, and where the skills
 * are dropped. Centralizing it here keeps the "global vs project" branching out
 * of the command logic and guarantees the install path always contains the
 * `INSTALL_DIR_NAME` marker that makes uninstall surgical.
 */

import { homedir } from "node:os";
import path from "node:path";

import type { Scope } from "./types.js";

/**
 * The namespaced directory name the bag owns. It appears in every hook command
 * path, so "command includes /skills-bag/" uniquely identifies our entries in a
 * settings.json that may also hold the user's own hooks.
 */
export const INSTALL_DIR_NAME = "skills-bag";

/** Substring fingerprint used to recognize bag-owned hook commands during uninstall. */
export const PATH_MARKER = `/${INSTALL_DIR_NAME}/`;

/** Resolved absolute paths for a given scope. */
export interface Layout {
  scope: Scope;
  /** ~/.claude or <cwd>/.claude */
  claudeDir: string;
  /** The settings.json this scope edits. */
  settingsFile: string;
  /** Namespaced payload dir: <claudeDir>/skills-bag */
  installDir: string;
  /** Compiled hooks live here: <installDir>/hooks */
  hooksDir: string;
  /** Skills are copied here: <claudeDir>/skills */
  skillsDir: string;
}

/**
 * Resolve the layout for a scope. `projectRoot` defaults to the current working
 * directory and only matters for project scope.
 */
export function resolveLayout(scope: Scope, projectRoot: string = process.cwd()): Layout {
  const claudeDir = scope === "global" ? path.join(homedir(), ".claude") : path.join(projectRoot, ".claude");
  const installDir = path.join(claudeDir, INSTALL_DIR_NAME);
  return {
    scope,
    claudeDir,
    settingsFile: path.join(claudeDir, "settings.json"),
    installDir,
    hooksDir: path.join(installDir, "hooks"),
    skillsDir: path.join(claudeDir, "skills"),
  };
}

/** Render the settings.json `command` string for a compiled hook file in this layout. */
export function hookCommand(layout: Layout, file: string): string {
  // Quote the path so spaces in a project path (e.g. "Desktop/Code Stuff") survive.
  return `node "${path.join(layout.hooksDir, file)}"`;
}

/** Timestamped backup path for a settings.json (caller supplies the stamp for determinism/testability). */
export function backupPath(settingsFile: string, stamp: string): string {
  return `${settingsFile}.bak.${stamp}`;
}
