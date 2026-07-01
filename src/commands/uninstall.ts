/**
 * `dufflebag uninstall` — the exact inverse of install.
 *
 * Removes only what the bag owns: hook entries (matched by the `/dufflebag/`
 * path marker), `dufflebag*` env keys, the installed skill folders (from the
 * manifest), and the namespaced payload dir. The user's own hooks, env, and
 * settings are left untouched, and settings.json is backed up first. Any
 * running autonomous-loop daemon is asked to exit so it stops typing.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Scope } from "../core/index.js";
import {
  backupSettings,
  c,
  intro,
  outro,
  readManifest,
  readSettings,
  removeAgentsBlock,
  removeManagedEnv,
  removeManagedHooks,
  removePath,
  resolveLayout,
  spinner,
  stamp,
  step,
  unwriteCursorHook,
  writeSettings,
} from "../core/index.js";

/** Best-effort: signal every recorded autonomous-loop daemon to stop. */
function stopDaemons(): void {
  const stateDir = path.join(homedir(), ".claude", ".ctx-loop-state");
  if (!existsSync(stateDir)) return;
  for (const file of readdirSync(stateDir)) {
    if (!file.endsWith(".pid")) continue;
    const pid = Number(readFileSync(path.join(stateDir, file), "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

export function uninstall(opts: { scope: Scope; projectRoot?: string }): void {
  const layout = resolveLayout(opts.scope, opts.projectRoot);
  const manifest = readManifest(layout.installDir);

  intro(`dufflebag · uninstall · ${opts.scope}`);
  step(c.dim(`target: ${layout.claudeDir}`));

  if (!manifest && !existsSync(layout.installDir)) {
    outro(c.yellow("Nothing installed at this scope — nothing to remove."));
    return;
  }

  stopDaemons();

  const s = spinner();
  s.start("Removing");

  // settings.json: strip our hooks + env, after a backup.
  let backup: string | null = null;
  if (existsSync(layout.settingsFile)) {
    backup = backupSettings(layout.settingsFile, stamp());
    const cleaned = removeManagedEnv(removeManagedHooks(readSettings(layout.settingsFile)));
    writeSettings(layout.settingsFile, cleaned);
  }

  // dedup-guard's multi-agent surfaces (Cursor hooks.json + AGENTS.md block) — surgical, no-op when absent.
  unwriteCursorHook(layout.claudeDir);
  removeAgentsBlock(layout.claudeDir);

  // Skills recorded in the manifest, then the payload dir (hooks, manifest, payload package.json).
  for (const name of manifest?.skills ?? []) removePath(path.join(layout.skillsDir, name));
  removePath(layout.installDir);

  s.stop("Removed bag hooks, config, skills, payload, and agent wiring");

  if (backup) step(c.dim(`backup: ${path.basename(backup)} (roll back any time)`));
  outro(c.green("Uninstalled. Restart Claude Code so the hooks unload."));
}
