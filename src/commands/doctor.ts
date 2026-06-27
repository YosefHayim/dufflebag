/**
 * `skills-bag doctor` — read-only health report.
 *
 * Answers "is this actually going to work here?" across both scopes: host
 * capabilities (Node, macOS, Ghostty), what each scope has installed, whether
 * the managed hooks are present in settings.json, the effective config, and any
 * leftover manual hooks that would double-fire. Never mutates anything.
 */

import { existsSync } from "node:fs";

import { fromEnvMap } from "../core/env-config.js";
import { FEATURES } from "../core/features.js";
import { readManifest } from "../core/manifest.js";
import { resolveLayout } from "../core/paths.js";
import { ghosttyAvailable, isMacOS, nodeMajor, platformBlocker } from "../core/platform.js";
import { detectLegacyHooks, listManagedHooks, readSettings } from "../core/settings.js";
import { c, intro, note, outro } from "../core/ui.js";
import type { Scope } from "../core/types.js";

const ok = (t: string): string => `${c.green("✓")} ${t}`;
const bad = (t: string): string => `${c.yellow("⚠")} ${t}`;

function hostBlock(): string {
  return [
    nodeMajor() >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} (needs >= 20)`),
    isMacOS() ? ok(`Platform ${process.platform}`) : bad(`Platform ${process.platform} (autorun/TTS are macOS-only)`),
    ghosttyAvailable() ? ok("Ghostty detected") : bad("Ghostty not detected (autorun needs it)"),
  ].join("\n");
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
