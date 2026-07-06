/**
 * Detection of the AI coding agents installed on this host.
 *
 * dufflebag installs skills/rules into every agent it can detect. The detection
 * is split into a pure {@link classifyAgents} (testable) and an IO
 * {@link realProbe} so host filesystem state never leaks into unit tests.
 *
 * Each agent has an {@link AgentInstallConfig} that describes HOW it consumes
 * skill content — whether it reads a per-skill folder, a rules directory, a
 * single flat file, or a config reference.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Stable id for each agent dufflebag knows how to detect. */
export type AgentId =
  | "claude-code"
  | "cursor"
  | "codex"
  | "kimi-code"
  | "kiro"
  | "devin"
  | "windsurf"
  | "cline"
  | "gemini"
  | "aider"
  | "continue"
  | "cody"
  | "junie";

/**
 * How a given agent consumes skill/rule content.
 *
 * - `skills-dir`: Each skill is a folder with SKILL.md (Claude, Kiro, Kimi).
 * - `rules-file`: Each skill is a file in a rules directory (Cursor → .cursor/rules/name.mdc).
 * - `single-file`: All skills merge into one file (Windsurf, Cline, Codex, Gemini, Cody, Junie).
 * - `config-ref`: A config file must reference a rules file (Aider, Continue).
 */
export type SkillInstallMode = "skills-dir" | "rules-file" | "single-file" | "config-ref";

/** How to install skills into a specific agent. */
export interface AgentInstallConfig {
  id: AgentId;
  name: string;
  mode: SkillInstallMode;
  /** For skills-dir: the skills directory relative to scope root (e.g. '.claude/skills'). */
  skillsDir?: string;
  /** For rules-file: the rules directory relative to scope root (e.g. '.cursor/rules'). */
  rulesDir?: string;
  /** For single-file: the file path relative to scope root (e.g. '.clinerules', 'AGENTS.md'). */
  targetFile?: string;
  /** File extension for rules-file mode (e.g. '.mdc'). */
  ruleExt?: string;
  /** For config-ref: the config file that needs updating. */
  configFile?: string;
}

/** Single source of truth for all agent install behavior. */
export const AGENT_CONFIGS: Record<AgentId, AgentInstallConfig> = {
  "claude-code": { id: "claude-code", name: "Claude Code", mode: "skills-dir", skillsDir: ".claude/skills" },
  kiro: { id: "kiro", name: "Kiro", mode: "skills-dir", skillsDir: ".kiro/skills" },
  "kimi-code": { id: "kimi-code", name: "Kimi Code CLI", mode: "skills-dir", skillsDir: ".kimi-code/skills" },
  devin: { id: "devin", name: "Devin CLI", mode: "skills-dir", skillsDir: ".devin/skills" },
  cursor: { id: "cursor", name: "Cursor", mode: "rules-file", rulesDir: ".cursor/rules", ruleExt: ".mdc" },
  windsurf: { id: "windsurf", name: "Windsurf", mode: "single-file", targetFile: ".windsurfrules" },
  cline: { id: "cline", name: "Cline", mode: "single-file", targetFile: ".clinerules" },
  codex: { id: "codex", name: "Codex", mode: "single-file", targetFile: "AGENTS.md" },
  gemini: { id: "gemini", name: "Gemini CLI", mode: "single-file", targetFile: "GEMINI.md" },
  aider: { id: "aider", name: "Aider", mode: "config-ref", targetFile: "AGENTS.md", configFile: ".aider.conf.yml" },
  continue: { id: "continue", name: "Continue", mode: "config-ref", targetFile: "AGENTS.md", configFile: ".continue/config.json" },
  cody: { id: "cody", name: "Cody", mode: "single-file", targetFile: ".cody/instructions.md" },
  junie: { id: "junie", name: "Junie", mode: "single-file", targetFile: ".junie/guidelines.md" },
};

/**
 * A coding agent dufflebag probed for.
 *
 * `installed` is whether we found it on this host; `supported` is whether
 * dufflebag can install skills/rules into it.
 */
export interface DetectedAgent {
  id: AgentId;
  name: string;
  installed: boolean;
  supported: boolean;
}

/** Raw "is this present?" signals, separated from classification so it's testable. */
export interface AgentProbe {
  claudeCode: boolean;
  cursor: boolean;
  codex: boolean;
  kimiCode: boolean;
  kiro: boolean;
  devin: boolean;
  windsurf: boolean;
  cline: boolean;
  gemini: boolean;
  aider: boolean;
  continue: boolean;
  cody: boolean;
  junie: boolean;
}

/** Map raw probe signals to the agent list, in a stable order. Pure. */
export function classifyAgents(probe: AgentProbe): DetectedAgent[] {
  return [
    { id: "claude-code", name: "Claude Code", installed: probe.claudeCode, supported: true },
    { id: "kiro", name: "Kiro", installed: probe.kiro, supported: true },
    { id: "kimi-code", name: "Kimi Code CLI", installed: probe.kimiCode, supported: true },
    { id: "devin", name: "Devin CLI", installed: probe.devin, supported: true },
    { id: "cursor", name: "Cursor", installed: probe.cursor, supported: true },
    { id: "windsurf", name: "Windsurf", installed: probe.windsurf, supported: true },
    { id: "cline", name: "Cline", installed: probe.cline, supported: true },
    { id: "codex", name: "Codex", installed: probe.codex, supported: true },
    { id: "gemini", name: "Gemini CLI", installed: probe.gemini, supported: true },
    { id: "aider", name: "Aider", installed: probe.aider, supported: true },
    { id: "continue", name: "Continue", installed: probe.continue, supported: true },
    { id: "cody", name: "Cody", installed: probe.cody, supported: true },
    { id: "junie", name: "Junie", installed: probe.junie, supported: true },
  ];
}

// --- IO layer ---------------------------------------------------------------

/** True if `bin` resolves on PATH. */
function onPath(bin: string): boolean {
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Inspect the real host: config dirs, app bundles, and PATH binaries. */
export function realProbe(): AgentProbe {
  const home = homedir();
  return {
    claudeCode: existsSync(path.join(home, ".claude")) || onPath("claude"),
    cursor: existsSync("/Applications/Cursor.app") || existsSync(path.join(home, ".cursor")) || onPath("cursor"),
    codex: existsSync(path.join(home, ".codex")) || onPath("codex"),
    kimiCode: existsSync(path.join(home, ".kimi-code")) || onPath("kimi"),
    kiro: existsSync(path.join(home, ".kiro")) || onPath("kiro"),
    devin: existsSync(path.join(home, ".devin")) || existsSync(path.join(home, ".config", "devin")) || onPath("devin"),
    windsurf: existsSync("/Applications/Windsurf.app") || existsSync(path.join(home, ".windsurf")) || onPath("windsurf"),
    cline: existsSync(path.join(home, ".cline")) || onPath("cline"),
    gemini: onPath("gemini"),
    aider: onPath("aider"),
    continue: existsSync(path.join(home, ".continue")),
    cody: existsSync(path.join(home, ".cody")),
    junie: existsSync(path.join(home, ".junie")),
  };
}

/** Detect agents on this host (override `probe` in tests). */
export function detectAgents(probe: AgentProbe = realProbe()): DetectedAgent[] {
  return classifyAgents(probe);
}
