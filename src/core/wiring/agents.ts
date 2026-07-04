/**
 * Detection of the AI coding agents installed on this host.
 *
 * dufflebag wires into Claude Code's settings + hook system, so Claude Code is
 * the only agent it can install into today. This probe still surfaces a *detected*
 * Cursor / Codex so the interactive setup can name them and be explicit that an
 * adapter is tracked (issue #5) — rather than silently pretending they don't
 * exist. The detection is split into a pure {@link classifyAgents} (testable) and
 * an IO {@link realProbe} so host filesystem state never leaks into unit tests.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Stable id for each agent dufflebag knows how to detect. */
export type AgentId = "claude-code" | "cursor" | "codex" | "kimi-code" | "kiro";

/**
 * A coding agent dufflebag probed for.
 *
 * `installed` is whether we found it on this host; `supported` is whether
 * dufflebag can actually wire its hooks/skills into it yet (only Claude Code).
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
}

/** Map raw probe signals to the agent list, in a stable order. Pure. */
export function classifyAgents(probe: AgentProbe): DetectedAgent[] {
  return [
    { id: "claude-code", name: "Claude Code", installed: probe.claudeCode, supported: true },
    { id: "cursor", name: "Cursor", installed: probe.cursor, supported: false },
    { id: "codex", name: "Codex", installed: probe.codex, supported: false },
    { id: "kimi-code", name: "Kimi Code CLI", installed: probe.kimiCode, supported: true },
    { id: "kiro", name: "Kiro", installed: probe.kiro, supported: true },
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
  };
}

/** Detect agents on this host (override `probe` in tests). */
export function detectAgents(probe: AgentProbe = realProbe()): DetectedAgent[] {
  return classifyAgents(probe);
}
