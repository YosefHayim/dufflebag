/**
 * `skills-bag install` — the orchestrator.
 *
 * Reconciles a requested feature set into ~/.claude (or ./.claude for project
 * scope): copies the self-contained hook payload and skills, then performs the
 * settings.json surgery (backup → optional legacy migration → managed hooks →
 * env defaults). Every disk write is preceded by a timestamped backup, and the
 * env merge preserves any value the user already set, so re-running this is also
 * the safe `update` path.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULTS, toEnvMap } from "../core/env-config.js";
import { ALL_FEATURES, DEFAULT_FEATURES, FEATURES, resolveFeatures, skillsFor } from "../core/features.js";
import {
  bundledHooksDir,
  bundledSkillsDir,
  copyDir,
  ensureDir,
  packageRoot,
  readJson,
  writeJson,
} from "../core/fs-utils.js";
import { writeManifest, type Manifest } from "../core/manifest.js";
import { hookCommand, resolveLayout, type Layout } from "../core/paths.js";
import { platformBlocker, nodeMajor } from "../core/platform.js";
import {
  backupSettings,
  detectLegacyHooks,
  mergeEnv,
  mergeManagedHooks,
  readSettings,
  removeLegacyHooks,
  writeSettings,
  type RenderedHook,
} from "../core/settings.js";
import { c, confirm, intro, multiselect, note, outro, spinner, step, warn } from "../core/ui.js";
import type { FeatureId, Scope } from "../core/types.js";

export interface InstallOptions {
  scope: Scope;
  /** Requested features (deps are resolved). Defaults to the manifest's set on update, else context-guard. */
  features?: FeatureId[];
  /** Skip all prompts (CI / scripted installs). */
  assumeYes?: boolean;
  /** Treat as an update: keep the previously installed feature set if none is given. */
  isUpdate?: boolean;
  projectRoot?: string;
}

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

const version = (): string => readJson<{ version: string }>(path.join(packageRoot(), "package.json"))?.version ?? "0.0.0";

/** Render the settings.json hook commands for a resolved feature set. */
function renderHooks(layout: Layout, features: FeatureId[]): RenderedHook[] {
  return features.flatMap((id) =>
    FEATURES[id].hooks.map((h) => ({ event: h.event, matcher: h.matcher, command: hookCommand(layout, h.file) })),
  );
}

/**
 * Decide the feature set: an explicit `--features`, else the prior manifest (on
 * update / re-run), else an interactive multiselect, else the safe default.
 */
async function chooseFeatures(opts: InstallOptions, prior: FeatureId[] | undefined): Promise<FeatureId[]> {
  if (opts.features) return resolveFeatures(opts.features);
  if (prior) return resolveFeatures(prior);
  if (opts.assumeYes || !process.stdin.isTTY) return resolveFeatures(DEFAULT_FEATURES);
  const picked = await multiselect<FeatureId>(
    "Which features do you want to install?",
    ALL_FEATURES.map((id) => ({
      value: id,
      label: FEATURES[id].title,
      hint: FEATURES[id].platform === "any" ? "any OS" : FEATURES[id].platform,
    })),
    DEFAULT_FEATURES,
    DEFAULT_FEATURES,
  );
  return resolveFeatures(picked.length > 0 ? picked : DEFAULT_FEATURES);
}

export async function install(opts: InstallOptions): Promise<void> {
  const layout = resolveLayout(opts.scope, opts.projectRoot);
  const prior = readJson<Manifest>(path.join(layout.installDir, "manifest.json"));

  intro(`skills-bag ${version()} · ${opts.isUpdate ? "update" : "install"} · ${opts.scope}`);
  step(c.dim(`target: ${layout.claudeDir}`));

  const features = await chooseFeatures(opts, prior?.features);
  const skills = skillsFor(features);

  // Preflight — warn (never hard-fail) on unmet platform constraints.
  if (nodeMajor() < 20) warn(`Node ${process.versions.node} detected; skills-bag needs Node >= 20.`);
  for (const id of features) {
    const blocker = platformBlocker(FEATURES[id].platform);
    if (blocker) warn(`${c.bold(FEATURES[id].title)} ${blocker} — installs but stays inert until satisfied.`);
  }

  // Legacy migration — detect hand-rolled hooks that would double-fire.
  const settings = readSettings(layout.settingsFile);
  const legacy = detectLegacyHooks(settings);
  let migrate = false;
  if (legacy.length > 0) {
    warn(`Found ${legacy.length} pre-existing manual hook(s): ${legacy.map((l) => l.script).join(", ")}`);
    migrate = await confirm("Remove these so hooks don't double-fire?", true, opts.assumeYes ?? false);
  }

  const s = spinner();
  s.start("Writing files");

  // Backup before any mutation.
  const backup = backupSettings(layout.settingsFile, stamp());

  // Copy the self-contained payload: compiled hooks + a type:module marker so the ESM hooks run as bare files.
  ensureDir(layout.installDir);
  copyDir(bundledHooksDir(), layout.hooksDir);
  writeJson(path.join(layout.installDir, "package.json"), { name: "skills-bag-payload", private: true, type: "module" });

  // Copy skills, templating the absolute daemon-control path into each SKILL.md.
  if (skills.length > 0) {
    ensureDir(layout.skillsDir);
    const ctl = path.join(layout.hooksDir, "ctx-loop-ctl.js");
    for (const name of skills) {
      const dest = path.join(layout.skillsDir, name);
      copyDir(path.join(bundledSkillsDir(), name), dest);
      const skillMd = path.join(dest, "SKILL.md");
      if (existsSync(skillMd)) writeFileSync(skillMd, readFileSync(skillMd, "utf8").replaceAll("@@CTL@@", ctl), "utf8");
    }
  }

  // Settings surgery: optional legacy removal → managed hooks → env defaults (preserve user values).
  let next = migrate ? removeLegacyHooks(settings) : settings;
  next = mergeManagedHooks(next, renderHooks(layout, features));
  next = mergeEnv(next, toEnvMap(DEFAULTS)); // preserve=default: fills only missing keys
  writeSettings(layout.settingsFile, next);

  // Manifest.
  const manifest: Manifest = { version: version(), scope: opts.scope, features, skills, installedAt: new Date().toISOString() };
  writeManifest(layout.installDir, manifest);

  s.stop(`Installed ${c.bold(features.join(", "))}`);

  if (backup) step(c.dim(`backup: ${path.basename(backup)}`));
  if (migrate) step("Migrated off the previous manual install.");

  note(nextSteps(features, opts.scope), "Next steps");
  outro(c.green("Done. Restart Claude Code so the hooks load."));
}

function nextSteps(features: FeatureId[], scope: Scope): string {
  const lines = [`${c.dim("•")} Restart Claude Code (or open a new session) to load the hooks.`];
  if (features.includes("autonomous-loop"))
    lines.push(`${c.dim("•")} Arm the loop with ${c.cyan("/autorun")} ${c.dim("(macOS + Ghostty).")}`);
  lines.push(`${c.dim("•")} Tune values: ${c.cyan("skills-bag config --warn 0.15")}`);
  if (scope === "project") lines.push(`${c.dim("•")} Commit ${c.cyan(".claude/")} so teammates share the setup.`);
  lines.push(`${c.dim("•")} Health check: ${c.cyan("skills-bag doctor")}`);
  return lines.join("\n");
}
