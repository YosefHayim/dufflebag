/**
 * `dufflebag` (bare, in a terminal) / `dufflebag menu` — the interactive front door.
 *
 * A menu-driven wrapper for people who'd rather not memorize subcommands and
 * flags: pick an action, get walked through its options (scope, features,
 * tunables), and the very same command functions the flags drive run
 * underneath — the menu is a router, not a second implementation. Needs a TTY;
 * bare non-interactive runs still print commander's help (see cli.ts).
 */

import type { BagConfig, DedupMode, Scope } from "../core/index.js";
import {
  c,
  confirm,
  DEDUP_MODES,
  fromEnvMap,
  intro,
  outro,
  parseNumber,
  readSettings,
  resolveLayout,
  select,
  text,
  warn,
} from "../core/index.js";
import { config } from "./config.js";
import { doctor } from "./doctor.js";
import { install } from "./install.js";
import { scaffoldCi } from "./scaffoldCi.js";
import { uninstall } from "./uninstall.js";

type Action = "install" | "update" | "config" | "doctor" | "scaffold-ci" | "uninstall" | "exit";

const MAIN_MENU: { value: Action; label: string; hint: string }[] = [
  { value: "install", label: "Install features", hint: "copy hooks + skills into .claude" },
  { value: "update", label: "Update", hint: "refresh hook code, keep features + config" },
  { value: "config", label: "Configure", hint: "warn %, autorun budget, TTS, dedup…" },
  { value: "doctor", label: "Doctor", hint: "read-only health check" },
  { value: "scaffold-ci", label: "Scaffold CI", hint: "copy the workflow set into a repo" },
  { value: "uninstall", label: "Uninstall", hint: "surgically remove everything" },
  { value: "exit", label: "Exit", hint: "close the bag" },
];

type FieldKind = "number" | "string" | "dedupMode" | "boolean";
export interface Field {
  key: keyof BagConfig;
  label: string;
  kind: FieldKind;
}
/** Every editable tunable, in picker order. A test locks this to `BagConfig` so a new tunable can't silently miss the editor. */
export const CONFIG_FIELDS: Field[] = [
  { key: "contextWarnFraction", label: "Context warn fraction (nudge /handoff)", kind: "number" },
  { key: "contextBlockFraction", label: "Context block fraction (deny edits)", kind: "number" },
  { key: "autorunDefaultCycleCount", label: "Autorun default cycles", kind: "number" },
  { key: "autorunMaxCycleCount", label: "Autorun max cycles (anti-runaway)", kind: "number" },
  { key: "autorunPollIntervalSeconds", label: "Autorun poll interval (s)", kind: "number" },
  { key: "autorunIdleThresholdSeconds", label: "Autorun idle threshold (s)", kind: "number" },
  { key: "speechVoice", label: "Speech voice (macOS say)", kind: "string" },
  { key: "speechWordsPerMinute", label: "Speech rate (wpm)", kind: "number" },
  { key: "dedupEnforcement", label: "Dedup enforcement", kind: "dedupMode" },
  { key: "dedupSkipDirectories", label: "Dedup skip directories", kind: "string" },
  { key: "debugEnabled", label: "Debug logging", kind: "boolean" },
];

const scopeHome = (scope: Scope): string => (scope === "global" ? "~/.claude" : "./.claude");

async function pickScope(verb: string): Promise<Scope> {
  return select<Scope>(
    `${verb} — which scope?`,
    [
      { value: "global", label: "global", hint: "~/.claude · every session" },
      { value: "project", label: "project", hint: "./.claude · this repo, committable" },
    ],
    "global",
    "global",
  );
}

/** Prompt one field's new value, or undefined when the input was unusable (left unchanged). */
async function promptField(field: Field, current: BagConfig[keyof BagConfig]): Promise<string | number | boolean | undefined> {
  if (field.kind === "dedupMode") {
    return select<DedupMode>(
      field.label,
      DEDUP_MODES.map((m) => ({ value: m, label: m })),
      current as DedupMode,
      current as DedupMode,
    );
  }
  if (field.kind === "boolean") {
    return confirm(`${field.label}?`, Boolean(current), false);
  }
  const raw = (await text(field.label, { initial: String(current), placeholder: String(current) })).trim();
  if (field.kind === "string") return raw;
  const n = parseNumber(raw);
  if (n == null) {
    warn(`Not a number: "${raw}" — left ${field.label} unchanged.`);
    return undefined;
  }
  return n;
}

/** "current → staged" hint for a field row. */
function pendingHint(key: keyof BagConfig, staged: Record<string, string | number | boolean>, current: BagConfig): string {
  const now = String(current[key]);
  const next = staged[key];
  return next === undefined ? c.dim(now) : `${c.dim(now)} → ${c.green(String(next))}`;
}

/**
 * Interactive config editor: stage changes field-by-field against the scope's
 * current effective config, then hand the whole patch to `config()` — which
 * validates, clamps, backs up, and writes (the one SSOT for the write path).
 * The staged map is loosely typed; `config()`'s `validateConfig` re-coerces and
 * re-validates every field, so casting it to a patch on apply is safe.
 */
async function editConfig(scope: Scope): Promise<void> {
  const current = fromEnvMap(readSettings(resolveLayout(scope).settingsFile).env);
  const staged: Record<string, string | number | boolean> = {};

  for (;;) {
    const count = Object.keys(staged).length;
    const key = await select<string>(
      `Configure · ${scope}${count ? c.dim(`  (${count} staged)`) : ""}`,
      [
        ...CONFIG_FIELDS.map((f) => ({ value: f.key as string, label: f.label, hint: pendingHint(f.key, staged, current) })),
        {
          value: "__apply__",
          label: count ? c.green(`Apply ${count} change(s)`) : "Apply",
          hint: count ? "write settings.json" : "nothing staged yet",
        },
        { value: "__back__", label: "Back to menu", hint: count ? "discard staged changes" : "" },
      ],
      CONFIG_FIELDS[0]!.key,
      "__back__",
    );

    if (key === "__back__") return;
    if (key === "__apply__") {
      if (count === 0) {
        warn("No changes staged.");
        continue;
      }
      config({ scope, patch: staged as Partial<BagConfig> });
      return;
    }

    const field = CONFIG_FIELDS.find((f) => f.key === key);
    if (!field) continue;
    const value = await promptField(field, current[field.key]);
    if (value !== undefined) staged[field.key] = value;
  }
}

async function run(action: Exclude<Action, "exit">): Promise<void> {
  switch (action) {
    case "install":
      return install({ scope: await pickScope("Install"), reselectFeatures: true });
    case "update":
      return install({ scope: await pickScope("Update"), isUpdate: true });
    case "config":
      return editConfig(await pickScope("Configure"));
    case "doctor":
      return doctor();
    case "scaffold-ci": {
      const target = (await text("Target repo path", { initial: process.cwd(), placeholder: process.cwd() })).trim();
      return scaffoldCi({ path: target || undefined });
    }
    case "uninstall": {
      const scope = await pickScope("Uninstall");
      const go = await confirm(`Remove everything dufflebag added to ${scopeHome(scope)}?`, false, false);
      if (go) uninstall({ scope });
      else warn("Uninstall cancelled — nothing was removed.");
      return;
    }
  }
}

export async function menu(): Promise<void> {
  intro("dufflebag · interactive");
  for (;;) {
    const action = await select<Action>("What do you want to do?", MAIN_MENU, "install", "exit");
    if (action === "exit") break;
    await run(action);
  }
  outro(c.dim("Bag closed. Restart Claude Code if you changed anything."));
}
