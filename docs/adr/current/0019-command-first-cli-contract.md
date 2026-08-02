# 0019 — Command-first CLI with one execution path

- **Status:** Accepted (2026-08-02)
- **Scope:** public CLI grammar, interactive routing, presentation, and exit status
- **Supersedes:** [0011 — Interactive menu entry](0011-interactive-menu-entry.md)
- **Related:** [0009 — Reusable workflows and CLI scaffolding](0009-reusable-workflows-and-cli-scaffolding.md), [0016 — Capability layout](0016-capability-layout-replaces-core.md)

## Context

Bare `dufflebag` previously changed meaning according to terminal detection: a TTY
opened a menu while a non-TTY printed help. The menu assembled several capability
requests independently from the direct commands, so confirmation, diagnostics,
configuration, and workflow behavior drifted. Several commands also caught typed
failures, printed them, and returned exit status `0`.

The option grammar carried similar ambiguity: project and global scope were separate
booleans, feature IDs were a comma-separated option, configuration exposed one flag
per setting, `dedup check` had only one action, and `scaffold-ci` did more than its name
claimed.

## Decision

**Make the CLI command-first and route every invocation through one decoded capability
request.**

```text
dufflebag
├── menu
├── catalog
├── install [feature-id...] [--scope global|project]
├── update [feature-id...] [--scope global|project]
├── uninstall [--scope global|project] [--yes]
├── doctor
├── dedup [workspace] [--staged | --since <git-ref>]
├── config
│   ├── show [setting] [--scope global|project]
│   ├── set <setting> <value> [--scope global|project]
│   └── reset [setting] [--scope global|project] [--yes]
├── workflow
│   └── scaffold [workspace] [--overwrite]
└── voice
    ├── on|off|status [--scope global|project]
    ├── speak <text> [--source claude-code|codex|grok|devin|manual]
    ├── refine <prompt> [--speak]
    └── devin [-- <devin-arguments...>]
```

- Bare invocation always prints help; `menu` is the only interactive selector.
- Scope is one decoded literal and defaults to global.
- Feature IDs are repeatable positionals rather than a comma-separated option.
- Non-TTY execution never prompts.
- Only destructive actions accept `--yes`; non-TTY destructive actions require it.
- `--format text|json` is explicit and never inferred from TTY state.
- Application failures are translated once by the CLI boundary.
- Public exit statuses are `0` success/cancellation, `1` capability or gate failure,
  `2` invalid invocation, and `130` interruption.
- Version `0.14.0` is a clean pre-1.0 break: old commands and flags receive no hidden
  compatibility parser.

Command modules declare grammar, decode arguments, delegate once, and present through
`TerminalUI`. They do not own parallel business behavior. The menu gathers choices and
constructs the same capability request used by a direct command.

## Consequences

- **+** People and automation receive the same command meaning and failure status.
- **+** Feature discovery is available without a prompt through `dufflebag catalog`.
- **+** The public vocabulary matches the capabilities it invokes.
- **+** CLI subprocess tests can pin grammar, output channels, and exit status.
- **−** Existing pre-1.0 scripts must migrate to positional feature IDs, `--scope`,
  `workflow scaffold`, `dedup`, and `voice speak`.
- **−** JSON output becomes a public Schema-encoded contract that must be changed
  deliberately.
