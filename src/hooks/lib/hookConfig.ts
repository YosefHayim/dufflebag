// Dependency-free config reader for installed hooks. `src/config/configSchema.ts` owns the contract;
// the colocated test keeps these defaults aligned with it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type HookConfig = {
  readonly contextWarnPercent: number;
  readonly contextBlockPercent: number;
  readonly autorunDefaultCycles: number;
  readonly autorunMaxCycles: number;
  readonly autorunCheckEverySeconds: number;
  readonly autorunIdleAfterSeconds: number;
  readonly idleCompactAfter: string;
  readonly duplicateCodeMode: "block" | "warn" | "off";
  readonly duplicateCodeSkipFolders: ReadonlyArray<string>;
  readonly sessionRehomeRoots: ReadonlyArray<string>;
  readonly debugLogs: boolean;
};

type NumberSetting =
  | "contextWarnPercent"
  | "contextBlockPercent"
  | "autorunDefaultCycles"
  | "autorunMaxCycles"
  | "autorunCheckEverySeconds"
  | "autorunIdleAfterSeconds";

const DEFAULTS: HookConfig = {
  contextWarnPercent: 18,
  contextBlockPercent: 20,
  autorunDefaultCycles: 10,
  autorunMaxCycles: 50,
  autorunCheckEverySeconds: 5,
  autorunIdleAfterSeconds: 8,
  idleCompactAfter: "off",
  duplicateCodeMode: "block",
  duplicateCodeSkipFolders: [],
  sessionRehomeRoots: ["Desktop/Code", "Code", "Projects", "dev", "src", "repos"],
  debugLogs: false,
};

const SECONDS_PER_UNIT: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3_600, d: 86_400 };

// Installed hooks load this module as <installRoot>/hooks/<feature>/lib/hookConfig.js, because install copies
// src/hooks/lib into each feature's lib/. config.json and hook state live under <installRoot>.
export const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const managedConfigPath = path.join(installRoot, "config.json");

const propertyOf = (candidate: object, key: keyof HookConfig): unknown =>
  Object.getOwnPropertyDescriptor(candidate, key)?.value;

const numberSetting = (candidate: object, key: NumberSetting): number => {
  const value = propertyOf(candidate, key);
  return typeof value === "number" && Number.isFinite(value) ? value : DEFAULTS[key];
};

// A missing or malformed field keeps the application default.
export const decodeHookConfig = (candidate: unknown): HookConfig => {
  if (typeof candidate !== "object" || candidate === null) return DEFAULTS;
  const idleCompactAfter = propertyOf(candidate, "idleCompactAfter");
  const duplicateCodeMode = propertyOf(candidate, "duplicateCodeMode");
  const skipFolders = propertyOf(candidate, "duplicateCodeSkipFolders");
  const rehomeRoots = propertyOf(candidate, "sessionRehomeRoots");
  const debugLogs = propertyOf(candidate, "debugLogs");
  return {
    contextWarnPercent: numberSetting(candidate, "contextWarnPercent"),
    contextBlockPercent: numberSetting(candidate, "contextBlockPercent"),
    autorunDefaultCycles: numberSetting(candidate, "autorunDefaultCycles"),
    autorunMaxCycles: numberSetting(candidate, "autorunMaxCycles"),
    autorunCheckEverySeconds: numberSetting(candidate, "autorunCheckEverySeconds"),
    autorunIdleAfterSeconds: numberSetting(candidate, "autorunIdleAfterSeconds"),
    idleCompactAfter: typeof idleCompactAfter === "string" ? idleCompactAfter : DEFAULTS.idleCompactAfter,
    duplicateCodeMode:
      duplicateCodeMode === "block" || duplicateCodeMode === "warn" || duplicateCodeMode === "off"
        ? duplicateCodeMode
        : DEFAULTS.duplicateCodeMode,
    duplicateCodeSkipFolders: Array.isArray(skipFolders)
      ? skipFolders.filter((folder): folder is string => typeof folder === "string")
      : DEFAULTS.duplicateCodeSkipFolders,
    sessionRehomeRoots: Array.isArray(rehomeRoots)
      ? rehomeRoots.filter((folder): folder is string => typeof folder === "string")
      : DEFAULTS.sessionRehomeRoots,
    debugLogs: typeof debugLogs === "boolean" ? debugLogs : DEFAULTS.debugLogs,
  };
};

// Read on every call, so a running watcher follows `dufflebag config set`.
export const readConfig = (): HookConfig => {
  try {
    return decodeHookConfig(JSON.parse(readFileSync(managedConfigPath, "utf8")));
  } catch {
    return DEFAULTS;
  }
};

// e.g. "90s" → 90, "2m" → 120; "off", malformed, or outside 10 s–1 day → null
const durationSeconds = (durationText: string): number | null => {
  const match = /^([0-9]+)([smhd])$/.exec(durationText);
  if (!match) return null;
  const seconds = Number(match[1]) * SECONDS_PER_UNIT[match[2]];
  return seconds >= 10 && seconds <= 86_400 ? seconds : null;
};

// DUFFLEBAG_IDLE_COMPACT_AFTER, set when starting an agent, wins over config.json.
export const resolveIdleCompactSeconds = (request: {
  readonly env: NodeJS.Dict<string>;
  readonly configValue: string;
}): number | null => {
  const override = request.env.DUFFLEBAG_IDLE_COMPACT_AFTER;
  return durationSeconds(override === undefined ? request.configValue : override);
};
