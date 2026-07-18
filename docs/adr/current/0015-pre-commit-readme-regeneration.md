# ADR 0015 — Pre-commit README regeneration


> **Current map (0016):** feature catalog SSOT is `src/catalog/featureCatalog.ts` (not `src/core/catalog/features.ts`).

## Status

Accepted.

## Context

`README.md` contains two auto-generated regions bounded by HTML comments:

- `<!-- AUTO:FEATURES:START/END -->` — populated from `src/core/catalog/features.ts`.
- `<!-- AUTO:SKILLS:START/END -->` — populated from every `SKILL.md` found across the project's skill collections:
  - `src/skills/` (dufflebag source),
  - `~/.claude/skills/` (Claude Code),
  - `~/.kimi-code/skills/` (Kimi Code CLI),
  - `~/.kiro/skills/` (Kiro).

The generator script already exists (`pnpm generate-readme`), but it only scanned `src/skills` and was a manual step. Authors were committing changes without regenerating the README, so the rendered tables drifted and did not reflect the full personal skill bag.

## Decision

Run `pnpm generate-readme` automatically in a pre-commit hook, then stage the updated `README.md` so the commit always includes the regenerated tables.

- Use **husky** for the hook manager. It adds one small dev dependency and aligns with the existing `prepare` script convention (`husky`).
- Keep the hook minimal: run the existing generator, then `git add README.md`. No lint/test gates in the hook — those remain in CI via `pnpm verify`.
- Expand the generator to scan all four skill roots, dedupe by skill name, and show a **Where** column (source / Claude / Kimi / Kiro) so the README reflects the whole collection.
- Harden the generator to fall back to the first prose paragraph if a `SKILL.md` lacks YAML frontmatter, and to warn + skip only if no description can be extracted at all.

## Consequences

- README tables stay in sync with the full skill bag without manual intervention.
- Contributors must run `pnpm install` after cloning to activate the hook; CI still catches drift because the generator runs cleanly and the committed README matches.
- The README now lists every skill that exists in the scanned collections, with provenance, instead of only the subset shipped from `src/skills`.
