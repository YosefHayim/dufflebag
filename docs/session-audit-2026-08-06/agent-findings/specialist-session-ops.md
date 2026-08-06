# Specialist: session resume / finish incomplete

**Scope:** resume interrupted work, finish incomplete agent sessions, continue from pause  
**Skills reviewed:** `finishAgentSessions`, `agentSessionAuditor`  
**Corpus:** `job-like-prompts.jsonl` + intent/cluster artifacts  
**Verdict: leave** (optional tiny trigger polish only)

## Existing skills

| Skill | Role |
|---|---|
| `finishAgentSessions` | Inventory agent stores → extract interrupted outcomes → dedupe → reconcile current repo truth → classify → resume + `finish-and-ship` → durable ledger |
| `agentSessionAuditor` | Read-only multi-agent prompt mining → normalize/cluster → rank skill candidates (privacy-preserving) |

Both already match the job. Safety is strong (current truth outranks old plans; no inherited deploy/delete authority; no inventing work from TODOs).

## Volume vs finish-ship

| Intent (refined) | prompts | unique sessions | rec |
|---|---:|---:|---|
| `finish_ship_commit_push` | 125 | 116 | improve |
| `session_ops` | **4** | **4** | improve_or_trigger |

Coarse `session_resume_finish` shows 37 / 31 but is **keyword-polluted** by “stale” (dead files, deps, docs), not session recovery. True resume signal is an order of magnitude below finish-ship.

## Genuine resume evidence (job-like)

After filtering history vs `session_jsonl` duplicates and non-resume “stale/continue” noise:

1. **`proceed from where interrupted`** — exact cluster count 4 rows / ~2 unique user sessions (codex); freeform, no skill name.
2. **Devin handoff paste** — “proceed from where devin paused… `devin -r <name>`” — fuzzy c0216, 4 rows / 2 sessions (maple-dogwood, traveling-harrier); cross-agent recovery into codex.
3. Weak / adjacent only: “continue full migration”, “continue but ask… planpage”, in-scope “Continue deslop…” — ordinary mid-task continues, not multi-session recovery.

No `$finish-agent-sessions` / `$agent-session-auditor` invocations in this slice. Agent breadth for real resume: **codex only**.

## Skill fit

- **finishAgentSessions:** covers the real pain (interrupted outcomes, multi-store inventory, dedupe, current-state reconcile). Low freeform volume does not prove the skill is wrong—users rarely ask for fleet-wide recovery in this window.
- **agentSessionAuditor:** not a resume skill; it *is* the skill powering this audit. Meta: this request (specialist shard of session-audit-2026-08-06) is itself an auditor run, not unfinished-work recovery.

## Recommendation

**Leave** both skills as primary workflows. Do **not** prioritize rewrite vs finish-ship.

Optional low-cost only (if doing a pass anyway):
- Add freeform triggers to `finishAgentSessions` description: “proceed from where interrupted”, “where X paused”, “resume this session”, “finish incomplete sessions”.
- Keep auditor and finisher separate; do not merge.

**Do not create** a third session-ops skill. Volume and trigger ambiguity do not justify it.

## Limits

- Short audit window; codex-heavy extraction; “stale” false positives inflate coarse buckets.
- Devin CLI paste may mean “import that session’s outcome,” not full multi-agent ledger runs.
