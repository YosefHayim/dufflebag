# test-gap-ship — reference

## Relationship to siblings

| Skill | Role in this campaign |
|-------|----------------------|
| `test-gap-tdd` | How to scan layers and TDD-fill; headless default |
| `messy-repo-orchestrator` | Backup main, host A/B/C, multi-lane matrix, main safety |
| `sdlc-tasks-executions` | setup-lanes mechanics |
| `organized-commits` | Commit shape on topic branches |
| `finish-and-ship` | Push + open PR (pre-merge) |
| `ship-feature-e2e` | Confidence honesty + act gate ideas; **single** product feature is a different skill |

## Headless policy

Same as `test-gap-tdd`: default **headless**. Only `headed` / `visible` / `ui` switches UI mode.

## Resume from an existing test-gap-tdd run

Typical MYPR-style handoff:

```text
repo has:
  docs/agent/test-gap/CURRENT              # run-id pointer
  docs/agent/test-gap/<run-id>/REPORT.md
  docs/agent/test-gap/<run-id>/FEATURES.md
  (legacy flat docs/agent/test-gap/*.md or root TEST-GAP-*.md → migrate into a run dir on resume)
  branch test/test-gap-tdd-p0-units  (optional mono fill)
```

| Orchestrator step | Action |
|-------------------|--------|
| Wave 0 (optional) | If mono branch has unpushed/unmerged filled work → one PR via finish-and-ship → merge if gates pass |
| Residual lanes | Features under **residual** / still Missing in report → parallel lanes |
| Skip re-fill | Do not re-implement clusters already green on merged main |

```text
/test-gap-ship resume residual-only
/test-gap-ship resume   # board from full report; skip already-ok cells
```

## Confidence + merge caps

| Situation | Max confidence | Merge? |
|-----------|----------------|--------|
| Unit + e2e green for lane surface | 8–10 if pattern-faithful | Yes if ≥ 6 |
| Unit green, e2e **honest skip** (no API/sim) | **6** max | Yes only if user did not say `e2e-required`; PR must list skip |
| Unit green, e2e red | ≤ 4 | **No** |
| Partial unit, known holes | ≤ 5 | **No** unless user override this turn |
| Confidence &lt; 6 | — | **No** (ask human) |

## E2E unblock (orchestrator note, not silent fake green)

Before claiming e2e for a wave, try once to bring up **documented** local stack (repo README/AGENTS):

1. Install deps if needed  
2. Start API/seed on expected port  
3. Start web or boot sim per scripts  
4. Run headless e2e  

If still blocked → skip with exact reason in `$AGENT_DOCS/SHIP.md` and each PR. Do not hit production.

## Merge order

1. `@shared` / contract / schema test PRs  
2. Server-only feature gaps  
3. Client unit / mocks  
4. E2E-heavy lanes last (need main that already has API test seeds if any)

After each merge: update open PRs (rebase) before merging the next conflicting lane.

## Wave sizing

| Lanes with P0 gaps | Default |
|--------------------|---------|
| 1–8 | One wave |
| 9+ | Wave 1 = first 8 by risk (auth, payments, data loss first); rest queued |
| User `max-lanes=N` | Override |

## PR body template (lane)

```markdown
Fixes #<n>

## Summary
- Test-gap campaign lane: <feature_id>
- Gaps filled: <list>
- Layers: backend-unit | client-unit | mocks | e2e-…

## Confidence
N/10 — <why>

## Test plan
- [ ] unit: `<cmd>` → pass
- [ ] e2e: `<cmd>` → pass | skip:<reason>
- [ ] headless: yes (default)

## Main safety
- Backup: backup/<default>-… @ <sha>
- Topic branch only; orchestrator merges after gates
```

## Anti-triggers

| Ask | Use instead |
|-----|-------------|
| Scan/fill only, no merge/lanes | `test-gap-tdd` |
| One product feature to main | `ship-feature-e2e` |
| Multi-feature deslop/refactor (not tests) | `messy-repo-orchestrator` |
| Over-engineering | `lean-prove` |

## Anti-patterns

- Mono-branch dump of all features when parallel lanes were requested (except optional wave-0 of prior work)  
- Merging without backup  
- Merging red CI/unit  
- Claiming e2e green when skipped  
- Reimplementing worktree or TDD rules inside this file  
- Deleting remotes or force-pushing main  
- Unbounded fan-out (20+ agents at once)  
