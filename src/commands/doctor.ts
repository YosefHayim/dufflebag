/**
 * `skills-bag doctor` — read-only health report.
 *
 * Answers "is this actually going to work here?" across both scopes: host
 * capabilities (Node, macOS, Ghostty), what each scope has installed, whether
 * the managed hooks are present in settings.json, the effective config, and any
 * leftover manual hooks that would double-fire. Never mutates anything.
 */

import { existsSync } from "node:fs";

import { detectAgents } from "../core/agents.js";
import { cursorHooksPath, rootDirOf } from "../core/agent-wiring.js";
import { fromEnvMap } from "../core/env-config.js";
import { loadTypeScript } from "../hooks/lib/dupIndex.js";
import { FEATURES } from "../core/features.js";
import { readManifest } from "../core/manifest.js";
import { resolveLayout } from "../core/paths.js";
import { ghosttyAvailable, isMacOS, nodeMajor, platformBlocker } from "../core/platform.js";
import { detectLegacyHooks, listManagedHooks, readSettings } from "../core/settings.js";
import { c, intro, note, outro } from "../core/ui.js";
import type { DedupMode, Scope } from "../core/types.js";

const ok = (t: string): string => `${c.green("✓")} ${t}`;
const bad = (t: string): string => `${c.yellow("⚠")} ${t}`;

function hostBlock(): string {
  const installed = detectAgents().filter((a) => a.installed);
  const agents = installed.length
    ? installed.map((a) => (a.supported ? a.name : `${a.name} ${c.dim("(#5)")}`)).join(", ")
    : "none detected";
  return [
    nodeMajor() >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} (needs >= 20)`),
    isMacOS() ? ok(`Platform ${process.platform}`) : bad(`Platform ${process.platform} (autorun/TTS are macOS-only)`),
    ghosttyAvailable() ? ok("Ghostty detected") : bad("Ghostty not detected (autorun needs it)"),
    c.dim(`Agents: ${agents}`),
  ].join("\n");
}

/** dedup-guard health: its real dependency is the repo's own TypeScript, plus the Cursor surface it wired. */
function dedupLines(claudeDir: string, scope: Scope, mode: DedupMode): string[] {
  const out: string[] = [];
  if (scope === "project") {
    out.push(
      loadTypeScript(rootDirOf(claudeDir))
        ? ok("dedup-guard: TypeScript resolvable")
        : bad("dedup-guard: no TypeScript here — inert until the repo installs it"),
    );
    if (existsSync(cursorHooksPath(claudeDir))) out.push(ok("dedup-guard: Cursor afterFileEdit wired"));
  } else {
    out.push(c.dim("dedup-guard: resolves the repo's TypeScript per session (CLAUDE_PROJECT_DIR)"));
  }
  out.push(c.dim(`dedup-guard mode: ${mode}`));
  return out;
}

/** One scope's report, or null when a project scope simply has no .claude dir. */
function scopeBlock(scope: Scope): string | null {
  const layout = resolveLayout(scope);
  if (scope === "project" && !existsSync(layout.claudeDir)) return null;

  const manifest = readManifest(layout.installDir);
  if (!manifest) return c.dim("not installed");

  const settings = readSettings(layout.settingsFile);
  const managed = listManagedHooks(settings);
  const expected = manifest.features.flatMap((id) => FEATURES[id].hooks).length;
  const legacy = detectLegacyHooks(settings);
  const cfg = fromEnvMap(settings.env);

  const lines = [
    `version  ${c.bold(manifest.version)}   ${c.dim(manifest.installedAt)}`,
    `features ${manifest.features.map((id) => c.bold(id)).join(", ")}`,
    managed.length >= expected
      ? ok(`${managed.length} bag hook(s) wired`)
      : bad(`${managed.length}/${expected} bag hook(s) wired — re-run install`),
  ];
  if (legacy.length > 0) lines.push(bad(`${legacy.length} manual hook(s) may double-fire: ${legacy.map((l) => l.script).join(", ")}`));
  for (const id of manifest.features) {
    const blocker = platformBlocker(FEATURES[id].platform);
    if (blocker) lines.push(bad(`${id} ${blocker} (inert here)`));
  }
  if (manifest.features.includes("dedup-guard")) lines.push(...dedupLines(layout.claudeDir, scope, cfg.dedupMode));
  lines.push(c.dim(`config: warn ${cfg.warnPct} · block ${cfg.blockPct} · budget ${cfg.defaultBudget} · cap ${cfg.hardCap}`));
  return lines.join("\n");
}

export function doctor(): void {
  intro("skills-bag · doctor");
  note(hostBlock(), "host");
  note(scopeBlock("global") ?? c.dim("not installed"), "global  (~/.claude)");
  const project = scopeBlock("project");
  if (project) note(project, "project  (./.claude)");
  outro(c.dim("Read-only — nothing was changed."));
}
