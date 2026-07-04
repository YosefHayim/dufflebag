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

import type { Scope } from "../catalog/types.js";
import { AGENT_CONFIGS, type AgentId, type SkillInstallMode } from "../wiring/agents.js";

/**
 * The namespaced directory name the bag owns. It appears in every hook command
 * path, so "command includes /dufflebag/" uniquely identifies our entries in a
 * settings.json that may also hold the user's own hooks.
 */
export const INSTALL_DIR_NAME = "dufflebag";

/** Substring fingerprint used to recognize bag-owned hook commands during uninstall. */
export const PATH_MARKER = `/${INSTALL_DIR_NAME}/`;

/** True when a settings/hook command string is bag-owned (contains the `/dufflebag/` path marker). */
export const isBagCommand = (command: string): boolean => command.includes(PATH_MARKER);

/** Filesystem-safe ISO timestamp (`:`/`.` → `-`), used for backup filenames. */
export const stamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

/** Resolved absolute paths for a given scope. */
export interface Layout {
  scope: Scope;
  /** ~/.claude or <cwd>/.claude */
  claudeDir: string;
  /** The settings.json this scope edits. */
  settingsFile: string;
  /** Namespaced payload dir: <claudeDir>/dufflebag */
  installDir: string;
  /** Compiled hooks live here: <installDir>/hooks */
  hooksDir: string;
  /** Skills are copied here: <claudeDir>/skills */
  skillsDir: string;
  /** ~/.kimi-code or <root>/.kimi-code */
  kimiDir: string;
  /** Skills are copied here: <kimiDir>/skills */
  kimiSkillsDir: string;
  /** ~/.kiro or <root>/.kiro */
  kiroDir: string;
  /** Skills are copied here: <kiroDir>/skills */
  kiroSkillsDir: string;
  /** Cross-tool Agent Skills dir: ~/.agents/skills or <root>/.agents/skills */
  agentsSkillsDir: string;
}

/**
 * Resolve the layout for a scope. `projectRoot` defaults to the current working
 * directory and only matters for project scope.
 */
export function resolveLayout(scope: Scope, projectRoot: string = process.cwd()): Layout {
  const claudeDir = scope === "global" ? path.join(homedir(), ".claude") : path.join(projectRoot, ".claude");
  const kimiDir = scope === "global" ? path.join(homedir(), ".kimi-code") : path.join(projectRoot, ".kimi-code");
  const kiroDir = scope === "global" ? path.join(homedir(), ".kiro") : path.join(projectRoot, ".kiro");
  const agentsDir = scope === "global" ? path.join(homedir(), ".agents") : path.join(projectRoot, ".agents");
  const installDir = path.join(claudeDir, INSTALL_DIR_NAME);
  return {
    scope,
    claudeDir,
    settingsFile: path.join(claudeDir, "settings.json"),
    installDir,
    hooksDir: path.join(installDir, "hooks"),
    skillsDir: path.join(claudeDir, "skills"),
    kimiDir,
    kimiSkillsDir: path.join(kimiDir, "skills"),
    kiroDir,
    kiroSkillsDir: path.join(kiroDir, "skills"),
    agentsSkillsDir: path.join(agentsDir, "skills"),
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

/** Resolved target for writing skills into a specific agent. */
export interface AgentTarget {
  /** The directory or file path where skills are written. */
  dir: string;
  /** How the agent consumes skill content. */
  mode: SkillInstallMode;
  /** For single-file / config-ref modes: the absolute file path of the target. */
  file?: string;
}

/**
 * Resolve the absolute write target for a given agent and scope. This is the
 * generic resolver that abstracts over the per-agent Layout fields — use it
 * when you need a uniform "where does this agent get its skills?" answer
 * without hard-coding per-agent paths.
 */
export function resolveAgentTarget(agentId: AgentId, scope: Scope, projectRoot: string = process.cwd()): AgentTarget {
  const config = AGENT_CONFIGS[agentId];
  const root = scope === "global" ? homedir() : projectRoot;

  switch (config.mode) {
    case "skills-dir":
      return { dir: path.join(root, config.skillsDir!), mode: config.mode };
    case "rules-file":
      return { dir: path.join(root, config.rulesDir!), mode: config.mode };
    case "single-file":
      return { dir: path.dirname(path.join(root, config.targetFile!)), mode: config.mode, file: path.join(root, config.targetFile!) };
    case "config-ref":
      return { dir: path.dirname(path.join(root, config.targetFile!)), mode: config.mode, file: path.join(root, config.targetFile!) };
  }
}
