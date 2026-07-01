# 0011 — Bare invocation opens an interactive menu; the menu is a router, not a second CLI

- **Status:** Accepted (2026-07-02)
- **Scope:** `src/cli.ts` (dispatch), `src/commands/menu.ts`, the `select`/`text` wrappers in `src/core/ui.ts`
- **Related:** [0004 — Unified style + error model by role](0004-unified-style-and-error-model-by-role.md), [0010 — Core grouped by domain](0010-core-grouped-by-domain.md)

## Context

The CLI was subcommand + flag only. Bare `dufflebag` printed commander's help
— a static wall of flags you had to already know. The only interactivity lived
*inside* `install` (a feature multiselect, a Ghostty confirm); `config` was
flag-driven or a read-only print, and `uninstall`/`doctor`/`scaffold-ci` had no
prompts at all (uninstall didn't even confirm before removing). "I want an
interactive TUI, not just arguments."

## Decision

**Bare invocation in a terminal opens an interactive menu; anything else defers
to commander unchanged.**

- Dispatch rule (`cli.ts`): `process.argv.length <= 2 && process.stdin.isTTY`
  → `menu()`. Any argument (a command, `-h`, `-v`) or a non-TTY stdin (pipe / CI)
  → `program.parseAsync` as before. An explicit `dufflebag menu` command also
  exists, for discoverability and to force the menu.
- **The menu is a router, not a second implementation.** `menu()` calls the very
  same command functions the flags drive (`install`/`config`/`doctor`/
  `scaffoldCi`/`uninstall`), gathering their inputs interactively (scope select,
  a stage-then-apply config editor). There is no parallel code path to keep in
  sync — the config editor hands its staged patch to `config()`, which remains
  the one SSOT for validate → clamp → back up → write.
- Two new `ui` wrappers, `select` and `text`, sit beside `confirm`/`multiselect`
  and honour the same fail-safe: **return the fallback without prompting when
  stdin isn't a TTY**, so nothing scripted can hang. Every menu prompt goes
  through them.
- Menu **"Install" re-opens the feature picker** (prefilled with what's already
  installed) via a new `reselectFeatures` flag; menu **"Update"** keeps the set
  silently. The CLI's own `install`/`update` behaviour is untouched (it never
  sets the flag).

## Considered options

- **An explicit `dufflebag menu` command only (leave bare = help):**
  non-invasive, but undiscoverable — it defeats "not just arguments" to require
  knowing the `menu` word. Rejected as the *primary* entry; kept as an alias.
- **A full-screen TUI library (ink / blessed):** a heavier dependency and a
  different rendering paradigm than the line-based `@clack/prompts` the CLI
  already standardises on ([0004](0004-unified-style-and-error-model-by-role.md)).
  Rejected — the clack step-rail already gives an animated, on-brand flow; a
  second UI stack isn't worth the weight.
- **Bare → menu, router over the existing commands (chosen):** discoverable,
  zero new UI stack, and no second implementation to drift.

## Consequences

- **+** A newcomer can drive everything without memorising a flag; power users
  and CI are untouched (args and non-TTY bypass the menu entirely).
- **+** No duplicated logic — the menu composes the command functions; the
  config editor reuses `config()`'s validation.
- **−** Bare behaviour changed (was a help dump). Acceptable: nothing scripted
  relies on bare output, and non-TTY bare still prints help.
- **−** Each action keeps its own `intro`/`outro`, so a session is a stack of
  framed blocks rather than one continuous screen — accepted for the first cut.
- **−** The menu's deep, prompt-driven branches aren't unit-testable without
  mocking the prompt library (which would test clack, not us). Covered instead
  by the manual demo plus tests that pin the two fail-safes: the `ui` wrappers'
  non-TTY fallbacks, and `CONFIG_FIELDS` staying in lockstep with `BagConfig`.
