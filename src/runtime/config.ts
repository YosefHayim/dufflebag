/**
 * Dependency-free bag config reader for installed hooks.
 *
 * This module is the hook-island transport: bare Node, no Effect, no app imports.
 * Application config SSOT is `src/config/bagConfigSchema.ts`. Keep env key names
 * aligned with that schema's legacy environment map so read/write never drift.
 */

export type DedupMode = "deny" | "warn" | "off";

export type BagConfig = {
  readonly contextWarnFraction: number;
  readonly contextBlockFraction: number;
  readonly autorunDefaultCycleCount: number;
  readonly autorunMaxCycleCount: number;
  readonly autorunPollIntervalSeconds: number;
  readonly autorunIdleThresholdSeconds: number;
  readonly speechVoice: string;
  readonly speechWordsPerMinute: number;
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
  speechVoice: "dufflebagSpeechVoice",
  speechWordsPerMinute: "dufflebagSpeechWordsPerMinute",
  dedupEnforcement: "dufflebagDedupEnforcement",
  dedupSkipDirectories: "dufflebagDedupSkipDirectories",
  debugEnabled: "dufflebagDebugEnabled",
} satisfies Record<keyof BagConfig, string>;

/** Modes listed by interactive pickers; defaults to deny when env is missing or unknown. */
export const DEDUP_MODES: ReadonlyArray<DedupMode> = ["deny", "warn", "off"];

/**
 * Built-in defaults (warn at 18% of the model window, hard block at 20%,
 * 10-cycle autorun budget, 50-cycle anti-runaway cap).
 */
export const DEFAULTS: BagConfig = {
  contextWarnFraction: 0.18,
  contextBlockFraction: 0.2,
  autorunDefaultCycleCount: 10,
  autorunMaxCycleCount: 50,
  autorunPollIntervalSeconds: 5,
  autorunIdleThresholdSeconds: 8,
  speechVoice: "Samantha",
  speechWordsPerMinute: 230,
  dedupEnforcement: "deny",
  dedupSkipDirectories: "",
  debugEnabled: false,
};

const numberFromEnv = (raw: string | undefined, fallback: number): number => {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const booleanFromEnv = (raw: string | undefined, fallback: boolean): boolean => {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
      return true;
    case "0":
    case "false":
    case "no":
      return false;
    default:
      return fallback;
  }
};

const dedupModeFromEnv = (raw: string | undefined): DedupMode => {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "warn":
      return "warn";
    case "off":
      return "off";
    default:
      return "deny";
  }
};

/** Read effective config from an environment map; unknown or empty values fall back to defaults. */
export const readConfig = (env: NodeJS.Dict<string> = process.env): BagConfig => ({
  contextWarnFraction: numberFromEnv(env[ENV_KEYS.contextWarnFraction], DEFAULTS.contextWarnFraction),
  contextBlockFraction: numberFromEnv(env[ENV_KEYS.contextBlockFraction], DEFAULTS.contextBlockFraction),
  autorunDefaultCycleCount: numberFromEnv(env[ENV_KEYS.autorunDefaultCycleCount], DEFAULTS.autorunDefaultCycleCount),
  autorunMaxCycleCount: numberFromEnv(env[ENV_KEYS.autorunMaxCycleCount], DEFAULTS.autorunMaxCycleCount),
  autorunPollIntervalSeconds: numberFromEnv(env[ENV_KEYS.autorunPollIntervalSeconds], DEFAULTS.autorunPollIntervalSeconds),
  autorunIdleThresholdSeconds: numberFromEnv(env[ENV_KEYS.autorunIdleThresholdSeconds], DEFAULTS.autorunIdleThresholdSeconds),
  speechVoice: env[ENV_KEYS.speechVoice] ?? DEFAULTS.speechVoice,
  speechWordsPerMinute: numberFromEnv(env[ENV_KEYS.speechWordsPerMinute], DEFAULTS.speechWordsPerMinute),
  dedupEnforcement: dedupModeFromEnv(env[ENV_KEYS.dedupEnforcement]),
  dedupSkipDirectories: env[ENV_KEYS.dedupSkipDirectories] ?? DEFAULTS.dedupSkipDirectories,
  debugEnabled: booleanFromEnv(env[ENV_KEYS.debugEnabled], DEFAULTS.debugEnabled),
});

/**
 * Render a complete BagConfig as the string env map hooks read. Always emits every
 * key (including defaults) so a detached child freezes a fully-specified snapshot.
 */
export const configToEnvMap = (config: BagConfig): Record<string, string> => ({
  [ENV_KEYS.contextWarnFraction]: String(config.contextWarnFraction),
  [ENV_KEYS.contextBlockFraction]: String(config.contextBlockFraction),
  [ENV_KEYS.autorunDefaultCycleCount]: String(config.autorunDefaultCycleCount),
  [ENV_KEYS.autorunMaxCycleCount]: String(config.autorunMaxCycleCount),
  [ENV_KEYS.autorunPollIntervalSeconds]: String(config.autorunPollIntervalSeconds),
  [ENV_KEYS.autorunIdleThresholdSeconds]: String(config.autorunIdleThresholdSeconds),
  [ENV_KEYS.speechVoice]: config.speechVoice,
  [ENV_KEYS.speechWordsPerMinute]: String(config.speechWordsPerMinute),
  [ENV_KEYS.dedupEnforcement]: config.dedupEnforcement,
  [ENV_KEYS.dedupSkipDirectories]: config.dedupSkipDirectories,
  [ENV_KEYS.debugEnabled]: config.debugEnabled ? "true" : "false",
});

/**
 * Spawn env for the detached ctx-watch daemon. Starts from the parent environment
 * and overwrites every `dufflebag*` key with the parent's *effective* config so the
 * daemon freezes the same resolved values even when inheritance is incomplete.
 */
export const daemonSpawnEnv = (env: NodeJS.Dict<string> = process.env): NodeJS.Dict<string> => ({
  ...env,
  ...configToEnvMap(readConfig(env)),
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
  readonly configSnapshot: BagConfig;
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
  const env = daemonSpawnEnv(request.env ?? process.env);
  return {
    command: "node",
    args: [request.daemonPath, request.sessionId],
    options: { detached: true, stdio: "ignore", env },
    configSnapshot: readConfig(env),
  };
};

/**
 * Decode a daemon spawn snapshot (BagConfig JSON written at spawn) back to an
 * effective config. Unknown shapes fall back to defaults per key.
 */
export const configFromSnapshot = (raw: unknown): BagConfig => {
  if (raw == null || typeof raw !== "object") return readConfig({});
  const record = raw as Record<string, unknown>;
  // Env-style snapshot (string map keyed by dufflebag*).
  if (typeof record[ENV_KEYS.contextWarnFraction] === "string" || typeof record[ENV_KEYS.contextWarnFraction] === "number") {
    const env: NodeJS.Dict<string> = {};
    // Copy only known dufflebag* keys so stray fields cannot pollute parsing.
    for (const key of Object.values(ENV_KEYS)) {
      const value = record[key];
      if (value != null) env[key] = String(value);
    }
    return readConfig(env);
  }
  // BagConfig-style snapshot (decoded numbers/bools written by planDaemonSpawn).
  const env: NodeJS.Dict<string> = {};
  for (const [field, key] of Object.entries(ENV_KEYS) as Array<[keyof BagConfig, string]>) {
    const value = record[field];
    if (value != null) env[key] = String(value);
  }
  return readConfig(env);
};

/** Autorun-relevant fields the detached daemon freezes at spawn (doctor comparison surface). */
export const DAEMON_CONFIG_KEYS = [
  "contextWarnFraction",
  "contextBlockFraction",
  "autorunDefaultCycleCount",
  "autorunMaxCycleCount",
  "autorunPollIntervalSeconds",
  "autorunIdleThresholdSeconds",
] as const satisfies ReadonlyArray<keyof BagConfig>;

export type DaemonConfigKey = (typeof DAEMON_CONFIG_KEYS)[number];

export type DaemonConfigDiff = {
  readonly key: DaemonConfigKey;
  readonly expected: number;
  readonly daemon: number;
};

/** Diff a managed/settings config against a daemon spawn snapshot. */
export const daemonConfigDiff = (
  expected: Pick<BagConfig, DaemonConfigKey>,
  daemon: Pick<BagConfig, DaemonConfigKey>,
): ReadonlyArray<DaemonConfigDiff> =>
  DAEMON_CONFIG_KEYS.flatMap((key) => {
    if (expected[key] === daemon[key]) return [];
    return [{ key, expected: expected[key], daemon: daemon[key] }];
  });
