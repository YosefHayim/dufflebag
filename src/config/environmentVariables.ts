import { Schema } from "effect";

// e.g. "DUFFLEBAG_VOICE_DIR" — DUFFLEBAG_<AREA>_<SETTING>
const ENVIRONMENT_VARIABLE_PATTERN = /^DUFFLEBAG_[A-Z]+(?:_[A-Z]+)+$/;

const environmentVariableSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.pattern(ENVIRONMENT_VARIABLE_PATTERN, {
      message: () => "Environment variables are named DUFFLEBAG_<AREA>_<SETTING>.",
    }),
    Schema.annotations({ description: "Exact environment variable name." }),
  ),
  defaultValue: Schema.NonEmptyTrimmedString.annotations({
    description: "What applies when the variable is unset.",
  }),
  purpose: Schema.NonEmptyTrimmedString.annotations({
    description: "What the variable changes, in one or two plain sentences.",
  }),
  readBy: Schema.NonEmptyArray(Schema.Literal("TypeScript", "Rust", "Python")).annotations({
    description: "Languages whose code reads the variable.",
  }),
});

// Every DUFFLEBAG_* variable any dufflebag code reads; environmentVariables.test.ts fails when src/ drifts from it.
export const environmentVariables = Schema.decodeUnknownSync(Schema.Array(environmentVariableSchema), {
  onExcessProperty: "error",
})([
  {
    name: "DUFFLEBAG_AGENT_ID",
    defaultValue: "set by dufflebag in hook commands",
    purpose:
      "Which agent ran a hook (claude-code, codex, grok). Install writes DUFFLEBAG_AGENT_ID=<agent> in front of the hook commands that read it: idle compact, voice, and session rehome.",
    readBy: ["TypeScript"],
  },
  {
    name: "DUFFLEBAG_IDLE_COMPACT_AFTER",
    defaultValue: "unset (idleCompactAfter in config.json applies)",
    purpose:
      "Overrides idleCompactAfter for one agent session: off, or a time like 30s. Set it when starting the agent, e.g. `DUFFLEBAG_IDLE_COMPACT_AFTER=30s codex`.",
    readBy: ["TypeScript"],
  },
  {
    name: "DUFFLEBAG_AUTORUN_DRY_RUN",
    defaultValue: "off",
    purpose:
      "When 1, true, or yes, the autorun watcher logs the keystrokes it would type instead of typing them (safe manual testing).",
    readBy: ["TypeScript"],
  },
  {
    name: "DUFFLEBAG_VOICE_DIR",
    defaultValue: "~/Library/Application Support/dufflebag/voice on macOS",
    purpose:
      "Folder for voice state: Whisper models, the narration inbox, worker status, and saved refine choices. The Stop hook, the voice worker, and the refiner all use it.",
    readBy: ["TypeScript", "Rust", "Python"],
  },
  {
    name: "DUFFLEBAG_VOICE_CONFIG_FILE",
    defaultValue: "unset (the install's config.json, then ~/.claude/dufflebag/config.json)",
    purpose:
      "Path to the config.json the voice Stop hook and voice worker read (for example speechMode). When set, it is the only file they read; tests use it to stay away from the real config.",
    readBy: ["TypeScript", "Rust"],
  },
  {
    name: "DUFFLEBAG_DICTATION_MODEL",
    defaultValue: "unset (dictationLanguage picks turbo-q5 or the ivrit.ai Hebrew model)",
    purpose:
      "Forces the Whisper model the dictation worker loads: turbo-q5, turbo-q8, turbo, small, base, tiny, or ivrit.",
    readBy: ["Rust"],
  },
  {
    name: "DUFFLEBAG_DICTATION_LIVE_PREVIEW",
    defaultValue: "on",
    purpose: "Set to off (or 0, false, no) to stop the live caption preview while Shift is held.",
    readBy: ["Rust"],
  },
  {
    name: "DUFFLEBAG_REFINE_PICKER",
    defaultValue: "on",
    purpose:
      "Set to off (or 0, false, no) so a failed refine never opens the macOS model picker (CI, headless machines).",
    readBy: ["Python"],
  },
  {
    name: "DUFFLEBAG_REHOME_STATE_DIR",
    defaultValue: "~/.claude/dufflebag/state/session-rehome",
    purpose:
      "Folder for session-rehome's ledger of moved, kept, and deleted sessions, its watcher lock, and its sweep stamp. Tests point it at a temporary folder.",
    readBy: ["TypeScript"],
  },
  {
    name: "DUFFLEBAG_PROVIDER_HEALTH_FILE",
    defaultValue: "~/.claude/dufflebag/state/provider-health.json",
    purpose: "File where `dufflebag free` keeps provider health records and the accepted terms version.",
    readBy: ["TypeScript"],
  },
]);
