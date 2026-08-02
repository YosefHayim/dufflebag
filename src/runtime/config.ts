import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Dependency-free bag config reader for installed hooks.
 *
 * This module is the hook-island transport: bare Node, no Effect, no app imports.
 * Application config SSOT is `src/config/bagConfigSchema.ts`. Keep env key names
 * aligned with that schema's legacy environment map so read/write never drift.
 */

export type DedupMode = "deny" | "warn" | "off";
export type HookConfigProjection = {
  readonly contextWarnFraction: number;
  readonly contextBlockFraction: number;
  readonly autorunDefaultCycleCount: number;
  readonly autorunMaxCycleCount: number;
  readonly autorunPollIntervalSeconds: number;
  readonly autorunIdleThresholdSeconds: number;
  readonly idleAutoCompact: string;
  readonly dedupEnforcement: DedupMode;
  readonly dedupSkipDirectories: string;
  readonly debugEnabled: boolean;
};

/** Prefix marking every key this tool owns in settings.json `env`. */
export const ENV_PREFIX = "dufflebag";

/** Canonical env var name for each config field (must match application legacy keys). */
export const ENV_KEYS = {
  contextWarnFraction: "dufflebagContextWarnFraction",
  contextBlockFraction: "dufflebagContextBlockFraction",
  autorunDefaultCycleCount: "dufflebagAutorunDefaultCycleCount",
  autorunMaxCycleCount: "dufflebagAutorunMaxCycleCount",
  autorunPollIntervalSeconds: "dufflebagAutorunPollIntervalSeconds",
  autorunIdleThresholdSeconds: "dufflebagAutorunIdleThresholdSeconds",
  idleAutoCompact: "dufflebagIdleAutoCompact",
  dedupEnforcement: "dufflebagDedupEnforcement",
  dedupSkipDirectories: "dufflebagDedupSkipDirectories",
  debugEnabled: "dufflebagDebugEnabled",
} satisfies Record<keyof HookConfigProjection, string>;

export const HOOK_CONFIG_FIELDS = [
  "contextWarnFraction",
  "contextBlockFraction",
  "autorunDefaultCycleCount",
  "autorunMaxCycleCount",
  "autorunPollIntervalSeconds",
  "autorunIdleThresholdSeconds",
  "idleAutoCompact",
  "dedupEnforcement",
  "dedupSkipDirectories",
  "debugEnabled",
] as const satisfies ReadonlyArray<keyof HookConfigProjection>;

/** Modes listed by interactive pickers; defaults to deny when env is missing or unknown. */
export const DEDUP_MODES: ReadonlyArray<DedupMode> = ["deny", "warn", "off"];

/**
 * Built-in defaults (warn at 18% of the model window, hard block at 20%,
 * 10-cycle autorun budget, 50-cycle anti-runaway cap).
 */
export const DEFAULTS: HookConfigProjection = {
  contextWarnFraction: 0.18,
  contextBlockFraction: 0.2,
  autorunDefaultCycleCount: 10,
  autorunMaxCycleCount: 50,
  autorunPollIntervalSeconds: 5,
  autorunIdleThresholdSeconds: 8,
  idleAutoCompact: "off",
  dedupEnforcement: "deny",
  dedupSkipDirectories: "",
  debugEnabled: false,
};

const numberFromEnv = (configText: string | undefined, fallback: number): number => {
  if (configText == null || configText.trim() === "") return fallback;
  const n = Number(configText);
  return Number.isFinite(n) ? n : fallback;
};

const booleanFromEnv = (request: { readonly configText: string | undefined; readonly fallback: boolean }): boolean => {
  const normalizedText = request.configText === undefined ? "" : request.configText.trim().toLowerCase();
  switch (normalizedText) {
    case "1":
    case "true":
    case "yes":
      return true;
    case "0":
    case "false":
    case "no":
      return false;
    default:
      return request.fallback;
  }
};

const dedupModeFromEnv = (configText: string | undefined): DedupMode => {
  const normalizedText = configText === undefined ? "" : configText.trim().toLowerCase();
  switch (normalizedText) {
    case "warn":
      return "warn";
    case "off":
      return "off";
    default:
      return "deny";
  }
};

const envTextOr = (configText: string | undefined, fallback: string): string =>
  configText === undefined ? fallback : configText;

const dedupModeFromSources = (configText: string | undefined, managedMode: DedupMode | undefined): DedupMode => {
  if (configText !== undefined) return dedupModeFromEnv(configText);
  return managedMode === undefined ? DEFAULTS.dedupEnforcement : managedMode;
};

const managedConfigPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config.json");

const decodeManagedHookConfig = (candidate: unknown): Partial<HookConfigProjection> => {
  if (typeof candidate !== "object" || candidate === null) return {};
  const property = (key: keyof HookConfigProjection): unknown => Object.getOwnPropertyDescriptor(candidate, key)?.value;

  const numberProperty = (key: keyof HookConfigProjection): number | undefined => {
    const value = property(key);
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };

  const stringProperty = (key: keyof HookConfigProjection): string | undefined => {
    const value = property(key);
    return typeof value === "string" ? value : undefined;
  };
  const dedupMode = property("dedupEnforcement");
  const debugEnabled = property("debugEnabled");
  return {
    contextWarnFraction: numberProperty("contextWarnFraction"),
    contextBlockFraction: numberProperty("contextBlockFraction"),
    autorunDefaultCycleCount: numberProperty("autorunDefaultCycleCount"),
    autorunMaxCycleCount: numberProperty("autorunMaxCycleCount"),
    autorunPollIntervalSeconds: numberProperty("autorunPollIntervalSeconds"),
    autorunIdleThresholdSeconds: numberProperty("autorunIdleThresholdSeconds"),
    idleAutoCompact: stringProperty("idleAutoCompact"),
    dedupEnforcement: dedupMode === "deny" || dedupMode === "warn" || dedupMode === "off" ? dedupMode : undefined,
    dedupSkipDirectories: stringProperty("dedupSkipDirectories"),
    debugEnabled: typeof debugEnabled === "boolean" ? debugEnabled : undefined,
  };
};

const readManagedHookConfig = (): Partial<HookConfigProjection> => {
  try {
    return decodeManagedHookConfig(JSON.parse(readFileSync(managedConfigPath, "utf8")));
  } catch {
    return {};
  }
};

type ReadConfigRequest = {
  readonly environment?: NodeJS.Dict<string>;
  readonly managedConfig?: Partial<HookConfigProjection>;
  readonly invocationConfig?: Partial<HookConfigProjection>;
};

/** Resolve hook config once: invocation overrides, environment, managed file, then matching application defaults. */
export const readConfig = (request: ReadConfigRequest = {}): HookConfigProjection => {
  const env = request.environment === undefined ? process.env : request.environment;
  const managedConfig = request.managedConfig === undefined ? readManagedHookConfig() : request.managedConfig;
  const invocationConfig = request.invocationConfig === undefined ? {} : request.invocationConfig;
  return {
    contextWarnFraction: numberFromEnv(
      env[ENV_KEYS.contextWarnFraction],
      managedConfig.contextWarnFraction === undefined
        ? DEFAULTS.contextWarnFraction
        : managedConfig.contextWarnFraction,
    ),
    contextBlockFraction: numberFromEnv(
      env[ENV_KEYS.contextBlockFraction],
      managedConfig.contextBlockFraction === undefined
        ? DEFAULTS.contextBlockFraction
        : managedConfig.contextBlockFraction,
    ),
    autorunDefaultCycleCount: numberFromEnv(
      env[ENV_KEYS.autorunDefaultCycleCount],
      managedConfig.autorunDefaultCycleCount === undefined
        ? DEFAULTS.autorunDefaultCycleCount
        : managedConfig.autorunDefaultCycleCount,
    ),
    autorunMaxCycleCount: numberFromEnv(
      env[ENV_KEYS.autorunMaxCycleCount],
      managedConfig.autorunMaxCycleCount === undefined
        ? DEFAULTS.autorunMaxCycleCount
        : managedConfig.autorunMaxCycleCount,
    ),
    autorunPollIntervalSeconds: numberFromEnv(
      env[ENV_KEYS.autorunPollIntervalSeconds],
      managedConfig.autorunPollIntervalSeconds === undefined
        ? DEFAULTS.autorunPollIntervalSeconds
        : managedConfig.autorunPollIntervalSeconds,
    ),
    autorunIdleThresholdSeconds: numberFromEnv(
      env[ENV_KEYS.autorunIdleThresholdSeconds],
      managedConfig.autorunIdleThresholdSeconds === undefined
        ? DEFAULTS.autorunIdleThresholdSeconds
        : managedConfig.autorunIdleThresholdSeconds,
    ),
    idleAutoCompact: envTextOr(
      env[ENV_KEYS.idleAutoCompact],
      managedConfig.idleAutoCompact === undefined ? DEFAULTS.idleAutoCompact : managedConfig.idleAutoCompact,
    ),
    dedupEnforcement: dedupModeFromSources(env[ENV_KEYS.dedupEnforcement], managedConfig.dedupEnforcement),
    dedupSkipDirectories: envTextOr(
      env[ENV_KEYS.dedupSkipDirectories],
      managedConfig.dedupSkipDirectories === undefined
        ? DEFAULTS.dedupSkipDirectories
        : managedConfig.dedupSkipDirectories,
    ),
    debugEnabled: booleanFromEnv({
      configText: env[ENV_KEYS.debugEnabled],
      fallback: managedConfig.debugEnabled === undefined ? DEFAULTS.debugEnabled : managedConfig.debugEnabled,
    }),
    ...invocationConfig,
  };
};

/**
 * Render a complete BagConfig as the string env map hooks read. Always emits every
 * key (including defaults) so a detached child freezes a fully-specified snapshot.
 */
export const configToEnvMap = (config: HookConfigProjection): Record<string, string> => ({
  [ENV_KEYS.contextWarnFraction]: String(config.contextWarnFraction),
  [ENV_KEYS.contextBlockFraction]: String(config.contextBlockFraction),
  [ENV_KEYS.autorunDefaultCycleCount]: String(config.autorunDefaultCycleCount),
  [ENV_KEYS.autorunMaxCycleCount]: String(config.autorunMaxCycleCount),
  [ENV_KEYS.autorunPollIntervalSeconds]: String(config.autorunPollIntervalSeconds),
  [ENV_KEYS.autorunIdleThresholdSeconds]: String(config.autorunIdleThresholdSeconds),
  [ENV_KEYS.idleAutoCompact]: config.idleAutoCompact,
  [ENV_KEYS.dedupEnforcement]: config.dedupEnforcement,
  [ENV_KEYS.dedupSkipDirectories]: config.dedupSkipDirectories,
  [ENV_KEYS.debugEnabled]: config.debugEnabled ? "true" : "false",
});

const autoCompactSeconds = (configText: string): number | null => {
  if (configText === "off") return null;
  if (!/^[0-9]+[smhd]$/.test(configText)) return null;
  const amount = Number(configText.slice(0, -1));
  let seconds = amount;
  switch (configText.slice(-1)) {
    case "m":
      seconds = amount * 60;
      break;
    case "h":
      seconds = amount * 3_600;
      break;
    case "d":
      seconds = amount * 86_400;
      break;
  }
  return seconds >= 10 && seconds <= 86_400 ? seconds : null;
};

export const agentAutoCompactEnvironmentKey = (agentId: string): string =>
  `DUFFLEBAG_${agentId.replaceAll("-", "_").toUpperCase()}_AUTO_COMPACT`;

export const resolveAutoCompactSeconds = (request: {
  readonly agentId: string;
  readonly env?: NodeJS.Dict<string>;
  readonly persistentValue?: string;
}): number | null => {
  const env = request.env === undefined ? process.env : request.env;
  const persistentValue = request.persistentValue === undefined ? DEFAULTS.idleAutoCompact : request.persistentValue;
  const override = env[agentAutoCompactEnvironmentKey(request.agentId)];
  return autoCompactSeconds(override === undefined ? persistentValue : override);
};

/**
 * Spawn env for the detached ctx-watch daemon. Starts from the parent environment
 * and overwrites every `dufflebag*` key with the parent's *effective* config so the
 * daemon freezes the same resolved values even when inheritance is incomplete.
 */
export const daemonSpawnEnv = (env: NodeJS.Dict<string> = process.env): NodeJS.Dict<string> => ({
  ...env,
  ...configToEnvMap(readConfig({ environment: env })),
});

/** Fully specified detached spawn for ctx-watch (unit-test surface; no process I/O). */
export type DaemonSpawnPlan = {
  readonly command: "node";
  readonly args: readonly [string, string];
  readonly options: {
    readonly detached: true;
    readonly stdio: "ignore";
    readonly env: NodeJS.Dict<string>;
  };
  readonly configSnapshot: HookConfigProjection;
};

/**
 * Build the spawn request the SessionStart / autorun launchers share. Callers
 * write `configSnapshot` beside the session state and then `spawn` with
 * `options` so the child freezes the same effective config.
 */
export const planDaemonSpawn = (request: {
  readonly sessionId: string;
  readonly daemonPath: string;
  readonly env?: NodeJS.Dict<string>;
}): DaemonSpawnPlan => {
  const env = daemonSpawnEnv(request.env === undefined ? process.env : request.env);
  return {
    command: "node",
    args: [request.daemonPath, request.sessionId],
    options: { detached: true, stdio: "ignore", env },
    configSnapshot: readConfig({ environment: env, managedConfig: {} }),
  };
};

/**
 * Decode a daemon spawn snapshot (BagConfig JSON written at spawn) back to an
 * effective config. Unknown shapes fall back to defaults per key.
 */
export const configFromSnapshot = (configText: unknown): HookConfigProjection => {
  if (configText == null || typeof configText !== "object") return readConfig({ environment: {} });
  const property = (key: string): unknown => Object.getOwnPropertyDescriptor(configText, key)?.value;

  const environmentFrom = (bindings: ReadonlyArray<readonly [string, string]>): NodeJS.Dict<string> => {
    const env: NodeJS.Dict<string> = {};
    for (const [field, key] of bindings) {
      const value = property(field);
      if (value != null) env[key] = String(value);
    }
    return env;
  };
  // Env-style snapshot (string map keyed by dufflebag*).
  if (
    typeof property(ENV_KEYS.contextWarnFraction) === "string" ||
    typeof property(ENV_KEYS.contextWarnFraction) === "number"
  ) {
    // Copy only known dufflebag* keys so stray fields cannot pollute parsing.
    const environmentBindings = Object.values(ENV_KEYS).map((key) => [key, key] as const);
    return readConfig({ environment: environmentFrom(environmentBindings), managedConfig: {} });
  }
  // BagConfig-style snapshot (decoded numbers/bools written by planDaemonSpawn).
  const configEnvironmentBindings = Object.entries(ENV_KEYS);
  return readConfig({ environment: environmentFrom(configEnvironmentBindings), managedConfig: {} });
};

/** Autorun-relevant fields the detached daemon freezes at spawn (doctor comparison surface). */
export const DAEMON_CONFIG_KEYS = [
  "contextWarnFraction",
  "contextBlockFraction",
  "autorunDefaultCycleCount",
  "autorunMaxCycleCount",
  "autorunPollIntervalSeconds",
  "autorunIdleThresholdSeconds",
] as const satisfies ReadonlyArray<keyof HookConfigProjection>;

export type DaemonConfigKey = (typeof DAEMON_CONFIG_KEYS)[number];

export type DaemonConfigDiff = {
  readonly key: DaemonConfigKey;
  readonly expected: number;
  readonly daemon: number;
};

/** Diff a managed/settings config against a daemon spawn snapshot. */
export const daemonConfigDiff = (
  expected: Pick<HookConfigProjection, DaemonConfigKey>,
  daemon: Pick<HookConfigProjection, DaemonConfigKey>,
): ReadonlyArray<DaemonConfigDiff> =>
  DAEMON_CONFIG_KEYS.flatMap((key) => {
    if (expected[key] === daemon[key]) return [];
    return [{ key, expected: expected[key], daemon: daemon[key] }];
  });
