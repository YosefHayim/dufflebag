# dufflebag — Purpose & Direction

What an agent reads to understand *intent* before writing code. The human-facing
version is `../../README.md`; the domain glossary and layout live in
`../../AGENTS.md` and `../../src/skills/png-to-code/CONTEXT.md`. Purpose and direction only.

## The problem

Three papercuts, one owner: long Claude Code sessions balloon past usable context
before winding down; agents re-paste the same function or type under a new name;
and standing up a personal set of Claude Code hooks/skills + CI is copy-paste
across ~18 repos. dufflebag packages the owner's personal **bag** of guardrails,
skills, and CI templates behind one installer that wires them into `~/.claude` (or
a project's `.claude/`) **surgically**, and takes them back just as cleanly.

## Who it's for

The **owner first**, and any Claude Code user who wants these specific guardrails.
Explicitly **not**: a general-purpose plugin marketplace, a team product with SLAs,
or a multi-agent tool — **Claude Code is the only install target today** (a detected
Cursor/Codex is surfaced but untouched; adapters tracked in [#5](https://github.com/YosefHayim/dufflebag/issues/5)).

## The core insight

A hook payload that **depends on nothing** runs the instant a hook fires and can be
removed by a single `/dufflebag/` path marker with zero collateral; **behavior as
data** (the `FEATURES` catalog) turns each guardrail into an install-time toggle.
Why now: the owner runs many repos and long agent sessions daily, so guardrails that
install/uninstall cleanly and CI that copies in one command pay for themselves
immediately — a toolbelt, not a platform.

## Goals

- One command **installs / updates / uninstalls** a chosen feature set, and uninstall
  **byte-restores** `settings.json` (surgical, path-identified).
- A long session **winds down gracefully** — `/handoff` nudged at the warn fraction,
  new code edits denied near the cap — instead of overflowing.
- A **duplicate** function/type is blocked at write time on Claude (warned on Cursor,
  gated in CI by `dedup check`).
- A PNG **converges to pixel-perfect code** via a measured screenshot-diff loop, not
  eyeballing.
- Any repo adopts the **single-purpose CI set** (and templated `publish.yml`) with one
  `scaffold-ci`.

## Non-goals

- **Not a marketplace** — it ships the owner's bag, not other people's skills.
- **No back-compat shims** — a clean break is the default unless asked (the rename
  carried no legacy markers/env; see [ADR 0007](../../docs/adr/current/0007-rename-to-dufflebag-broadened-remit.md)).
- **Not cross-platform for the GUI loop** — the autonomous loop is macOS + Ghostty
  only, by design (it types into the terminal).
- **No runtime deps in the hook payload** — ever ([ADR 0001](../../docs/adr/current/0001-zero-dependency-hook-payload.md)).
- **Not a live workflow host** — repos own **copies** of CI, never references
  ([ADR 0009](../../docs/adr/current/0009-reusable-workflows-and-cli-scaffolding.md)).

## Direction

- **Built:** context-guard · dedup-guard · autonomous-loop (`autorun`) · speak-response ·
  png-to-code · `scaffold-ci`. The `skills-bag → dufflebag` rename (clean break),
  vertical-per-feature layout, catalog ship-allowlist, and reusable workflows all landed —
  as did the **2026-07-02 style refresh** (TSDoc on the exported surface, biome linter on,
  co-located tests, single-command `autorun`) and the **source consolidation**: all source
  under `src/` (`src/skills/`, `src/scripts/`), all copyable templates under `templates/`
  (`templates/workflows/`, `templates/mdFiles/`) — [ADR 0012](../../docs/adr/current/0012-tsdoc-on-the-exported-surface.md)–[0014](../../docs/adr/current/0014-consolidate-under-src-and-templates.md).
- **Next:** Cursor/Codex adapters ([#5](https://github.com/YosefHayim/dufflebag/issues/5)).
- **Maybe:** more template kinds under `templates/` — a project should be able to scaffold
  `CODE-STYLE.md`/`PROJECT.md` alongside the CI set; additional agents as install targets.

## Guiding principles

- **SSOT / KISS / YAGNI / DRY**; reuse and extend before creating.
- **Pure core, imperative shell**; errors chosen by role, not locale.
- **Zero-dep hook payload**; surgical, path-identified install/uninstall.
- **Clean break over back-compat**, unless explicitly asked to migrate.
- **Readable over clever** — behavior in data tables and guard clauses, not metaprogramming.
