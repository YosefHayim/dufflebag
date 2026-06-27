# AGENTS.md

**This file is the single source of truth for the rules of working in this repository** — for any coding agent (Claude Code, Cursor, etc.) and for humans. `CLAUDE.md` and `GEMINI.md` are symlinks to this file.

## What this is

**skills-bag** — a one-command installer for a personal bag of Claude Code skills and hooks: context guard, dedup guard, autonomous loop, speak-response, and the **png-to-code** skill (PNG → measured pixel-perfect code).

Install features with:

```bash
npx skills-bag install --features png-to-code
```

Feature docs live under `skills/<feature>/`. The png-to-code harness is TypeScript under `skills/png-to-code/scripts/`.

## Repo layout

| Path | Purpose |
|------|---------|
| `src/` | skills-bag CLI (TypeScript) |
| `skills/` | Bundled skill content copied on install |
| `hooks/` | Hook scripts |
| `test/` | CLI tests |

## Validate changes

From repo root:

```bash
npm test
npm run build   # if applicable
```

For png-to-code script changes:

```bash
cd skills/png-to-code/scripts && npm run typecheck
```

## Agent skills

### Issue tracker

Issues for this repo live in GitHub (`YosefHayim/skills-bag`). See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

Five canonical triage roles mapped to GitHub label strings. See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context layout: read [`skills/png-to-code/CONTEXT.md`](skills/png-to-code/CONTEXT.md) and `skills/png-to-code/docs/adr/` when working on png-to-code. See [`docs/agents/domain.md`](docs/agents/domain.md).
