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

import { detectAgents } from "../core/agents.js";
import { rootDirOf, writeAgentsBlock, writeCursorHook } from "../core/agent-wiring.js";
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
import { hookCommand, resolveLayout, stamp, type Layout } from "../core/paths.js";
import {
  ghosttyAvailable,
  homebrewAvailable,
  installGhosttyViaBrew,
  isMacOS,
  nodeMajor,
  platformBlocker,
} from "../core/platform.js";
import {
  backupSettings,
  applyEnvMigration,
  detectLegacyHooks,
  mergeEnv,
  mergeManagedHooks,
  readSettings,
  removeLegacyHooks,
  writeSettings,
  type RenderedHook,
} from "../core/settings.js";
import { c, confirm, intro, multiselect, note, outro, spinner, step, success, warn } from "../core/ui.js";
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

const version = (): string => readJson<{ version: string }>(path.join(packageRoot(), "package.json"))?.version ?? "0.0.0";

/** Render the settings.json hook commands for a resolved feature set. */
function renderHooks(layout: Layout, features: FeatureId[]): RenderedHook[] {
  return features.flatMap((id) =>
    FEATURES[id].hooks.map((h) => ({ event: h.event, matcher: h.matcher, command: hookCommand(layout, h.file) })),
  );
}

/**
 * Render a note of the AI coding agents detected on this host. Claude Code is
 * the install target; a detected Cursor/Codex is shown but flagged as not yet
 * wired (issue #5) so the user knows skills-bag saw it and why it's untouched.
 */
function agentsNote(): string {
  const shown = detectAgents().filter((a) => a.installed || a.supported);
  return shown
    .map((a) => {
      const mark = a.supported ? c.green("✓") : c.dim("•");
      const tag = a.supported ? c.green("install target") : c.dim("detected · adapter tracked in #5");
      return `${mark} ${c.bold(a.name)} ${c.dim("—")} ${tag}`;
    })
    .join("\n");
}

/**
 * When the autonomous loop is selected on macOS without Ghostty, offer to
 * install it via Homebrew — the loop can drive no other terminal. Declining is
 * fine: the loop still installs but stays inert, and context-guard works
 * regardless. Returns true when it has already messaged about the loop's
 * readiness, so the generic preflight warning can skip it and not double up.
 */
async function ensureGhostty(features: FeatureId[], opts: InstallOptions): Promise<boolean> {
  if (!features.includes("autonomous-loop") || !isMacOS() || ghosttyAvailable()) return false;

  const interactive = !opts.assumeYes && process.stdin.isTTY;
  if (interactive && homebrewAvailable()) {
    const go = await confirm("Ghostty isn't installed — install it now with Homebrew? (required for /autorun)", true, false);
    if (go) {
      step("Installing Ghostty via Homebrew — this can take a minute…");
      try {
        installGhosttyViaBrew();
        success("Ghostty installed.");
      } catch {
        warn("Homebrew couldn't finish installing Ghostty — install it from https://ghostty.org. /autorun stays inert until then.");
      }
    } else {
      warn("Skipping Ghostty — /autorun installs but can't run without it. context-guard still works everywhere.");
    }
    return true;
  }

  warn(
    homebrewAvailable()
      ? "Ghostty not detected — run `brew install --cask ghostty` to use /autorun. context-guard works regardless."
      : "Ghostty not detected — install it from https://ghostty.org to use /autorun. context-guard works regardless.",
  );
  return true;
}

/**
 * Wire the dedup-guard feature's non-Claude surfaces. Claude is handled by the
 * shared settings.json path; this adds Cursor + AGENTS.md. In project scope we
 * write both unconditionally so the committed repo protects every teammate's
 * agent on clone; in global scope we only write `~/.cursor` when Cursor is
 * actually installed, and skip AGENTS.md (it's a per-repo file). Returns the
 * touched paths for the install summary.
 */
function wireDedupAgents(layout: Layout, scope: Scope): string[] {
  const touched: string[] = [];
  const cursorPresent = detectAgents().some((a) => a.id === "cursor" && a.installed);
  if (scope === "project" || cursorPresent) {
    touched.push(writeCursorHook(layout.claudeDir, hookCommand(layout, "dedup-cursor.js")));
  }
  if (scope === "project") {
    touched.push(writeAgentsBlock(layout.claudeDir));
  }
  return touched;
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
  note(agentsNote(), "Agents detected");

  const features = await chooseFeatures(opts, prior?.features);
  const skills = skillsFor(features);

  // Bootstrap Ghostty for the autonomous loop before preflight, so a successful
  // install means the generic platform warning below has nothing left to flag.
  const ghosttyHandled = await ensureGhostty(features, opts);

  // Preflight — warn (never hard-fail) on unmet platform constraints.
  if (nodeMajor() < 20) warn(`Node ${process.versions.node} detected; skills-bag needs Node >= 20.`);
  for (const id of features) {
    if (id === "autonomous-loop" && ghosttyHandled) continue;
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

  // Settings surgery: optional legacy removal → env migration → managed hooks → env defaults (preserve user values).
  let next = migrate ? removeLegacyHooks(settings) : settings;
  next = applyEnvMigration(next);
  next = mergeManagedHooks(next, renderHooks(layout, features));
  next = mergeEnv(next, toEnvMap(DEFAULTS)); // preserve=default: fills only missing keys
  writeSettings(layout.settingsFile, next);

  // Multi-agent surfaces for dedup-guard (Cursor hooks.json + AGENTS.md block).
  const dedupWiring = features.includes("dedup-guard") ? wireDedupAgents(layout, opts.scope) : [];

  // Manifest.
  const manifest: Manifest = { version: version(), scope: opts.scope, features, skills, installedAt: new Date().toISOString() };
  writeManifest(layout.installDir, manifest);

  s.stop(`Installed ${c.bold(features.join(", "))}`);

  if (backup) step(c.dim(`backup: ${path.basename(backup)}`));
  if (migrate) step("Migrated off the previous manual install.");
  if (dedupWiring.length > 0) {
    const root = rootDirOf(layout.claudeDir);
    step(c.dim(`dedup-guard also wired: ${dedupWiring.map((f) => path.relative(root, f)).join(", ")}`));
  }

  note(nextSteps(features, opts.scope), "Next steps");
  outro(c.green("Done. Restart Claude Code so the hooks load."));
}

function nextSteps(features: FeatureId[], scope: Scope): string {
  const lines = [`${c.dim("•")} Restart Claude Code (or open a new session) to load the hooks.`];
  if (features.includes("autonomous-loop"))
    lines.push(`${c.dim("•")} Arm the loop with ${c.cyan("/autorun")} ${c.dim("(macOS + Ghostty).")}`);
  if (features.includes("dedup-guard")) {
    lines.push(`${c.dim("•")} Dedup-guard blocks copy-pasted functions/types on Claude (Cursor warns; Codex via AGENTS.md).`);
    lines.push(`${c.dim("•")} Scan or gate CI: ${c.cyan("skills-bag dedup check --since main")} ${c.dim("· soften with --dedup-mode warn")}`);
  }
  if (features.includes("png-to-code")) {
    const base = scope === "project" ? "./.claude" : "~/.claude";
    lines.push(
      `${c.dim("•")} png-to-code: one-time harness setup — ${c.cyan(`cd ${base}/skills/png-to-code/scripts && npm i && npx playwright install chromium`)}`,
    );
  }
  lines.push(`${c.dim("•")} Tune values: ${c.cyan("skills-bag config --warn 0.15")}`);
  if (scope === "project") lines.push(`${c.dim("•")} Commit ${c.cyan(".claude/")} so teammates share the setup.`);
  lines.push(`${c.dim("•")} Health check: ${c.cyan("skills-bag doctor")}`);
  return lines.join("\n");
}
