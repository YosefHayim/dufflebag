# Native idle auto-compact across coding agents

**Status:** Approved design

## Goal

Let one dufflebag installation configure idle compaction for every detected coding agent that exposes the lifecycle hooks needed to do it safely. A session may submit text already waiting in its terminal input, compact after an idle turn, and then remain parked for the user.

The feature must work when several supported agents run in different Ghostty tabs or splits in one window. It must target the terminal that owns the session, never the currently focused terminal by assumption.

## Command and configuration surface

Persistent configuration uses the existing command surface:

```bash
dufflebag config --auto-compact-idle 1m
```

The value accepts a positive integer followed by `s`, `m`, `h`, or `d`. `off` disables the feature. The configuration schema owns decoding, bounds, descriptions, and defaults. A fresh installation defaults to `off`; installation must not begin submitting terminal input without an explicit opt-in.

A provider-specific environment variable may override the persistent value for one process:

```bash
DUFFLEBAG_CODEX_AUTO_COMPACT=30s codex
DUFFLEBAG_CLAUDE_CODE_AUTO_COMPACT=2m claude
DUFFLEBAG_GROK_AUTO_COMPACT=off grok
DUFFLEBAG_KIMI_CODE_AUTO_COMPACT=1m kimi
```

The variable name is derived from the catalog agent ID:

```text
DUFFLEBAG_<UPPERCASE_AGENT_ID_WITH_HYPHENS_AS_UNDERSCORES>_AUTO_COMPACT
```

Precedence is:

1. Provider-specific process environment override.
2. Persistent dufflebag configuration.
3. Disabled default.

Unknown values fail configuration validation at the CLI edge. An invalid environment override disables automation for that session and records a diagnostic; a hook must fail open rather than affect the agent session.

## Provider capability model

Agent discovery remains catalog-driven. An agent is eligible only when its catalog entry has a verified native-hook adapter that can report all of these lifecycle facts:

- session started;
- a human prompt started a turn;
- the assistant turn ended and the input is ready;
- the session ended;
- the provider's compact command.

Installation inspects the detected agents and installs only adapters whose hook contract is verified. Detection alone does not imply support. Unsupported agents remain usable and unchanged; `dufflebag doctor` reports them as detected but unsupported for idle auto-compact.

Provider-specific event names and configuration shapes stay inside the provider adapter. The idle state machine consumes one normalized event schema and does not branch on provider names.

Native hooks are the only integration mechanism in this design. Dufflebag does not replace, alias, or wrap `claude`, `codex`, `grok`, `kimi`, or any other executable.

## Session and terminal ownership

The session-start hook creates one state record containing:

- normalized agent ID;
- provider session ID;
- owning agent process ID;
- stable Ghostty terminal ID;
- effective idle duration;
- last normalized lifecycle event and timestamp;
- automation phase.

At a causally bound `SessionStart` or human `UserPromptSubmit`, while Ghostty is frontmost, the hook asks Ghostty for `front window → selected tab → focused terminal` and records that terminal's stable ID. This is the only focus-sensitive moment: it is coupled to the user's launch/submit action, not guessed later by a timer. A temporary title-marker fallback may prove a terminal when a controlling TTY permits it. If exactly one terminal cannot be proven, automation stays disabled for that session.

Ghostty 1.3 or newer is required because its native AppleScript dictionary can address tabs, splits, and terminals individually and send text or key events directly to a terminal. After the initial event-bound claim, the daemon does not require Ghostty to be frontmost and never retargets from focus.

Before every injected key or command, the daemon confirms that the agent process is alive, the session is not ended, the terminal ID still exists, and the session record still claims that terminal. Failure of any check parks and reaps the daemon without sending input.

## Idle state machine

```text
working
  -> assistant turn ended
  -> waiting for configured idle duration
  -> send Enter to the owning terminal
       -> prompt-start event observed: working
       -> no prompt-start event: send provider compact command
  -> wait for compact command to finish
  -> parked until a new human prompt-start event
```

Detailed rules:

1. Only a verified assistant-turn-ended event starts the idle timer. Quiet output during a running tool or model turn is not idle.
2. Any subsequent lifecycle activity cancels the pending timer.
3. When the timer expires, the daemon sends Enter once. This intentionally submits any text currently waiting in the input box, as approved by the user.
4. The daemon waits a short adapter-defined acknowledgement window for a prompt-start event.
5. If a prompt starts, the daemon treats it as ordinary work. When that turn ends, a new idle cycle may begin.
6. If no prompt starts, the daemon sends the adapter's compact command to the same terminal and waits for its completion event.
7. After an empty-input compaction, the session parks. It cannot compact repeatedly until a new human prompt starts another cycle.

The daemon never reads, logs, persists, or attempts to classify the draft text. The only draft operation is a single Enter key event.

## Installation and ownership

The feature extends the existing context-guard runtime rather than creating a second generic daemon framework. Dependency-free hook code remains inside the hook island and uses the existing bag-owned runtime and managed configuration paths.

Each provider hook edit is an artifact-plan operation. Installation must inspect, validate, apply transactionally, and write the receipt last. Update and uninstall may change only receipt-authorized bytes and must restore prior provider configuration exactly.

The catalog declares every shipped adapter and runtime path. A provider without catalog-declared paths ships nothing.

## Controls and diagnostics

The existing global kill switch disables all sessions immediately:

```bash
touch ~/.claude/.ctx-guard-off
```

The provider-specific `off` environment override disables one process. The persistent configuration may also be set to `off`.

`dufflebag doctor` reports, per detected agent:

- hook adapter support;
- installed and receipt-owned status;
- effective persistent idle setting;
- Ghostty version and AppleScript availability;
- stale session state;
- the most recent refusal reason without draft contents.

Refusal reasons are stable data such as `unsupported-agent`, `invalid-duration`, `terminal-not-proven`, `agent-exited`, `session-ended`, and `terminal-missing`.

## Verification

Unit tests cover duration decoding, environment-name derivation, precedence, normalized lifecycle events, the idle state machine, acknowledgement timeouts, parking, and every refusal branch.

Provider adapter fixtures prove that each supported hook format decodes into the normalized event schema. Install/update/uninstall integration tests prove byte restoration for every provider configuration surface.

A macOS Ghostty harness verifies three simultaneous terminals in one window:

1. Each session claims a distinct stable terminal ID.
2. A draft in one terminal is submitted without focusing or changing another terminal.
3. An empty terminal receives only its own compact command.
4. A working terminal is never treated as idle.
5. A parked terminal does not compact repeatedly.

Repository completion requires the changed capability tests followed by `pnpm test`, `pnpm typecheck`, and `pnpm verify`.

## Out of scope

- Wrapping or shadowing agent executables.
- Screen scraping or accessibility-based draft inspection.
- Supporting an agent without a verified lifecycle-hook contract.
- Linux terminal automation.
- Automatically resuming work after an empty-input compaction.
- Reading or storing the contents of an unsent draft.
