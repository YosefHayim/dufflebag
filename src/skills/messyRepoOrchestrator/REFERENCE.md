# Messy Repo Orchestrator — templates

## STATE.md (phase SSOT — write every phase change)

```markdown
# Messy-repo STATE — <repo>

updated: <ISO date>
campaign: single | full
phase: scope | setup | audit | land | close | done
phase_status: pending | in_progress | complete | blocked
requested_through: setup | audit | land | close
host: A | B | C
product_tip: <ref> @ <sha>
backup: <ref> @ <sha>
run_id: <YYYY-MM-DDTHHMMSSZ>
matrix: docs/agent/messy-repo/<run-id>/MATRIX.md
audit: docs/agent/messy-repo/<run-id>/AUDIT.md | none
health: docs/agent/messy-repo/<run-id>/HEALTH.md | none
next_action: <one concrete verb — e.g. "run audit-wave on open MATRIX PRs">
block_reason: none | <only if blocked>
lanes_open: N
lanes_merged: N
residual_fix: [#…]
residual_hold: [#…]
notes: <one line>
```

**Resume rule:** if this file exists, do the `next_action` / next incomplete `phase` — do not re-print a completed phase board as the answer.

## AUDIT.md

```markdown
# Messy-repo AUDIT — <repo>

Updated: <ISO date>
Product tip (PR base): `<ref>` @ `<sha>`
MATRIX: docs/agent/messy-repo/<run-id>/MATRIX.md
Mode: audit-wave
New feature PRs this run: **0**

## Scoreboard

| Order | PR | Feature | Head | Intent | Deslop | CODE-STYLE | Tests | Gates | Risk | Verdict | Notes |
|-------|-----|---------|------|--------|--------|------------|-------|-------|------|---------|-------|
| 1 | #22 | … | abc | match | better | ok | business+ | unit pass; CI pass | low | MERGE | … |

## Verdict counts

| MERGE | FIX | HOLD |
|-------|-----|------|
| N | N | N |

## HOLD (do not land)

| PR | Reason |
|----|--------|
| #32 | GitGuardian FAILURE — triage secrets |

## FIX (same branch only — no new PR)

| PR | Branch | Fix hint |
|----|--------|----------|
| #N | fix/… | … |

## Overlaps / land order

(from MATRIX; adjust if audit found new blockers)

1. …
2. …

## Dry-land integration

| Item | Value |
|------|--------|
| Base | `<product tip>` @ sha |
| Branch | `audit/dry-land-…` (local only) |
| Merged in order | #22, #26, … |
| Conflicts | none / list |
| Unit | `<cmd>` → pass\|fail\|skip |
| E2E | `<cmd>` → pass\|fail\|skip (headless) |
| Tip advanced? | **no** |

## Code slices (for planpage)

| Feature | Path | Why shown |
|---------|------|-----------|
| auth | `src/…` | CODE-STYLE example |
| … | … | deslop before→after |

## Residual mess (not this wave)

- …
```

## Per-PR subagent return (paste into AUDIT)

```markdown
### PR #N — <feature>
- branch: …
- head: …
- intent: match | partial | miss — <one line>
- deslop: better | same | worse — axis: line|structure|ceremony — proof: …
- code_style: ok | nits | violates — rule: … (flag `data`/`result`/`payload`/`body`/`response`, stems `build`/`to`/`mapTo`/`resolve`, and template-literal returns for simple path/key assembly)
- tests: added business: Y/N; stale/slop: Y/N; note: …
- gates: unit=; e2e=; ci=; secret_scan=
- risk: low | med | high
- verdict: MERGE | FIX | HOLD
- fix_hint: (if FIX) do on THIS branch: …
- slice: path + 5–15 lines or before→after sketch
```

## HEALTH.md

```markdown
# Product health — <repo>

status: audit-draft | post-land
updated: <ISO date>

## Tips

| Ref | SHA | Role |
|-----|-----|------|
| product tip | … | PR base / real main |
| origin/main | … | GitHub default (if different) |
| backup/… | … | restore |

## Features

| id | paths | tests | risk | wave disposition |
|----|-------|-------|------|------------------|
| auth | … | 24 unit | high | MERGE #32 HOLD? |

## Structure tree (top levels)

```text
app/
src/
  features/
  …
```

## How code is written (slices)

### 1. <feature> — <path>
```ts
// 8–20 real lines from tip or PR head
```
Notes vs CODE-STYLE: …

### 2. …

## Tests

| Layer | Count / command | Result |
|-------|-----------------|--------|
| unit | … | … |
| e2e | … | … |
| stale deleted this wave | … | … |

## Branches

| Class | Count | Names (sample) |
|-------|-------|----------------|
| product lanes open | … | … |
| merged this land | … | … |
| backups | … | … |
| wip / deferred | … | … |
| stale candidates (local only until authorized) | … | … |

## Worktrees

| Path | Keep? | Reason |
|------|-------|--------|
| .worktrees/… | until close-wave | … |

## Residual

- …
```

## planpage-data.json (`plan-brief`)

Shape for `npx planpage render plan-brief --data …`:

```json
{
  "title": "Messy-repo audit — <repo>",
  "summary": [
    { "label": "Lanes", "value": "18" },
    { "label": "MERGE", "value": "12" },
    { "label": "FIX", "value": "5" },
    { "label": "HOLD", "value": "1" },
    { "label": "Dry-land e2e", "value": "pass|fail|skip" }
  ],
  "notes": [
    {
      "tone": "decision",
      "title": "No new PRs",
      "body": "Audit scored existing MATRIX PRs only. Land merges those PRs; it does not re-split features."
    },
    {
      "tone": "danger",
      "title": "HOLD examples",
      "body": "#32 auth — GitGuardian; triage before land."
    }
  ],
  "steps": [
    { "label": "Skim scoreboard", "status": "done", "detail": "MERGE/FIX/HOLD in AUDIT.md" },
    { "label": "Glance code slices", "status": "doing", "detail": "style + structure below" },
    { "label": "Send feedback or say land-wave", "status": "todo", "detail": "Agent merges only MERGE after gates" }
  ],
  "risks": [
    {
      "risk": "Landing without triaging HOLD",
      "severity": "high",
      "mitigation": "Leave HOLD open; fix on same branch or explicit override"
    }
  ],
  "code": {
    "label": "Example: how this codebase writes auth",
    "code": "// real excerpt…",
    "annotations": [
      { "line": 1, "note": "Matches CODE-STYLE …" }
    ]
  },
  "details": [
    {
      "summary": "Feature map",
      "detail": "auth · chat-rag · … (paths)"
    },
    {
      "summary": "Structure tree",
      "detail": "app/\\nsrc/features/…"
    },
    {
      "summary": "Per-PR one-liners",
      "detail": "#22 MERGE — kept proxy.ts\\n#32 HOLD — GitGuardian"
    }
  ]
}
```

Optional second render: `before-after` with `{ "title": "…", "diffs": [{ "file", "before", "after" }] }`.

Optional scores page: `audit-report` with dimensions e.g. Intent match, Deslop, CODE-STYLE, Tests, Dry-land e2e (0–100).

## Fix-loop brief (same PR — never new PR)

```markdown
# Fix lane (same PR)
You are fixing PR #<n> on branch <branch> in worktree <path>.
Product tip base: <ref> @ <sha>

## Rules
- Do NOT open a new PR or new issue.
- Do NOT touch other lanes.
- Commit + push to THIS branch only; PR updates in place.
- Follow CODE-STYLE.md; use deslop-v2 for approved fix_hint only.
- Re-run narrow tests for this feature.

## Fix hint from AUDIT
<fix_hint>

## Done when
- fix_hint addressed
- unit green for lane
- stop (orchestrator re-audits). No merge.
```

## Anti-patterns

| Bad | Good |
|-----|------|
| Open 18 new PRs to “re-deslop” | Score existing 18; FIX pushes to same branch |
| Merge during audit | audit = score + dry-land only |
| Delete remotes in close without ask | Local worktrees only by default |
| Claim e2e green when skipped | `skip: reason` |
| Human must open every PR tab | planpage + AUDIT scoreboard |
