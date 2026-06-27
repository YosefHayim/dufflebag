/**
 * `skills-bag config` — read or update the `SKILLS_BAG_*` tunables.
 *
 * With no flags it prints the effective config for the scope (the values the
 * hooks actually see). With flags it validates, backs up, and writes only the
 * keys given, overwriting them (unlike install, which preserves). The guard
 * picks changes up on its next invocation; the detached daemon picks them up on
 * the next session, since its env is frozen at spawn.
 */

import { fromEnvMap, toEnvMap, validateConfig, ENV_KEYS } from "../core/env-config.js";
import { resolveLayout } from "../core/paths.js";
import { backupSettings, mergeEnv, readSettings, writeSettings } from "../core/settings.js";
import { c, intro, note, outro, step, success, warn } from "../core/ui.js";
import type { BagConfig, Scope } from "../core/types.js";

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

const LABELS: Record<keyof BagConfig, string> = {
  warnPct: "warn %      (nudge /handoff)",
  blockPct: "block %     (deny edits)",
  defaultBudget: "budget      (autorun cycles)",
  hardCap: "hard cap    (max cycles)",
  pollSeconds: "poll (s)    (daemon)",
  idleSeconds: "idle (s)    (daemon)",
  ttsVoice: "tts voice",
  ttsRate: "tts rate    (wpm)",
};

export function config(opts: { scope: Scope; patch: Partial<BagConfig>; projectRoot?: string }): void {
  const layout = resolveLayout(opts.scope, opts.projectRoot);
  const settings = readSettings(layout.settingsFile);
  const current = fromEnvMap(settings.env);

  intro(`skills-bag · config · ${opts.scope}`);

  if (Object.keys(opts.patch).length === 0) {
    const rows = (Object.keys(LABELS) as (keyof BagConfig)[]).map((key) => {
      const isSet = settings.env?.[ENV_KEYS[key]] != null;
      return `${LABELS[key].padEnd(28)} ${c.bold(String(current[key]))}${isSet ? "" : c.dim("  (default)")}`;
    });
    note(rows.join("\n"), "effective config");
    outro(c.dim("Change with e.g. `skills-bag config --warn 0.15 --budget 5`"));
    return;
  }

  const validated = validateConfig(opts.patch);
  const backup = backupSettings(layout.settingsFile, stamp());
  if (backup) step(c.dim(`backup: ${backup.split("/").pop()}`));
  const next = mergeEnv(settings, toEnvMap(validated), { overwrite: true });
  writeSettings(layout.settingsFile, next);

  for (const [key, value] of Object.entries(validated)) {
    success(`${LABELS[key as keyof BagConfig].trim()} → ${c.bold(String(value))}`);
  }
  warn("Guard uses new values immediately; a running autorun daemon picks them up next session.");
  outro(c.green("Saved."));
}
