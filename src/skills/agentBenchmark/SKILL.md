---
name: agent-benchmark
description: Use when the user wants a professional, dynamic agent/skill/tool benchmark — compare harnesses, skills, MCPs, CLIs, or workflows on the same tasks with tokens, turns, latency, cost, and success metrics; prove whether a change helps; run ablation-style experiments; or build a reusable bench harness for a repo. Inspired by rigorous same-task evaluation (not GitHub stars).
type: flow
---

# Agent Benchmark

Build and run **dynamic, professional benchmarks** for agent systems: skills, tools, prompts, harnesses, and workflows. Popularity is not evidence. Same tasks + measured metrics + reported methodology is evidence.

Grounded in field practice from Kun Chen’s agentic engineering workflow talk ([video](https://www.youtube.com/watch?v=iQyg-KypKAA)): viral skills can **increase tokens and worsen outcomes**; GitHub MCP vs CLI/agent-optimized tools differed by **~3× tokens** and **>2× latency** on the **same tasks**; browser tools differed in **turns and tokens** for equal work; long loops only help when a **verifiable metric** exists.

See [REFERENCE.md](REFERENCE.md) for principles, metric catalog, and experiment templates.

## Safety

- Prefer **read-only or sandboxed** tasks for first runs. Do not hit production write APIs, charge real cards, or delete remote branches/data as part of a bench case unless the user explicitly authorizes a labeled “live” suite.
- Never publish secrets, tokens, customer data, or private repo contents in bench artifacts. Redact logs.
- Cap cost: set max tokens, max turns, max wall time, and max concurrent trials **before** the first run.
- Do not claim statistical significance with n=1. Report n, variance, and limits honestly.
- Isolate runs (clean worktree / temp dir / fresh session) so order effects and dirty git state do not poison comparisons.
- When benchmarking third-party skills/tools, record exact versions/commits; do not smear authors—report numbers.

## Workflow

### 1. Define the decision

State the question in one sentence, e.g.:

- “Does skill A beat skill B on these PR tasks?”
- “Is MCP cheaper than CLI for the same GitHub tasks?”
- “Did our skill-from-feedback patch improve success without blowing tokens?”

If the user has no tasks yet, propose a **minimal suite** (3–10 cases) from their repo’s real workflows, not synthetic toys alone.

### 2. Fix the experiment design (before coding)

Write a bench plan (markdown or JSON) with:

| Field | Required |
|-------|----------|
| `suite_id` / title | yes |
| `tasks[]` — id, prompt, setup, success_predicate, timeout | yes |
| `conditions[]` — id, what varies (skill on/off, tool A/B, model, harness) | yes |
| `metrics` — success, tokens_in/out, turns, wall_ms, cost_usd, optional quality score | yes |
| `n_trials` per task×condition | yes (≥3 recommended) |
| `budget_caps` | yes |
| `isolation` — worktree / tmp / session reset | yes |
| `seeds` / ordering (round-robin conditions) | yes |

**Hard rule:** every condition runs the **exact same task prompts** and the **same success predicate**. Only the controlled variable changes.

### 3. Implement a dynamic harness (smallest that works)

Prefer repo-owned scripts under `scripts/dev/` or `scripts/bench/` (gitignored personal vs maintained—follow repo policy):

1. Load plan JSON/YAML.
2. For each trial: prepare isolation → run agent/tool under condition → collect metrics → evaluate success predicate.
3. Append one JSONL row per trial: `suite, task, condition, trial, metrics, error, artifact_path`.
4. Aggregate: mean/median, success rate, p50/p95 latency, total cost; optional bootstrap CI if n allows.
5. Mint a run dir, then emit `$AGENT_DOCS/REPORT.md` + `$AGENT_DOCS/results.json`:

   ```bash
   RUN_ID=$(date -u +%Y-%m-%dT%H%M%SZ)
   AGENT_DOCS="docs/agent/benchmark/$RUN_ID"
   mkdir -p "$AGENT_DOCS"
   printf '%s\n' "$RUN_ID" > docs/agent/benchmark/CURRENT
   ```

   Include methodology, versions, and raw data paths. Never write these at the repository root or a fixed flat path that a second bench overwrites.

Dynamic = the plan file is the product: user adds tasks/conditions without rewriting the runner.

### 4. Run

1. Dry-run one task × two conditions with n=1 to validate plumbing.
2. Full suite under budget caps.
3. On failure of the harness itself, fix harness before interpreting model quality.

### 5. Interpret (professional bar)

- Prefer **paired** comparisons (same task across conditions).
- Call a winner only if success is ≥ and cost/tokens/latency improve, or success improves with justified cost tradeoff the user accepts.
- Flag **degradations** (Kun’s viral skill pattern: more tokens, worse results).
- Recommend next experiment (ablate one variable) rather than “more vibes.”

### 6. Optional long-loop mode

When the user wants overnight improvement on a **verifiable metric** (coverage %, load time, failing e2e count):

- Define metric + stop condition + token/iteration caps (avoid unbounded quota burn).
- Loop: hypothesis → change → re-run fixed suite → keep only if metric improves.
- Land changes on a **feature branch** with `finish-and-ship`; never trash main.

### 7. Feed skills

If a condition is “skill v1 vs skill v2”, hand losing/winning diffs to `skill-from-feedback` / `capture-workflow` with the bench report as evidence—not stars.

## Verification

Publish:

- suite plan path and git commit of harness + tasks;
- environment: model ids, harness versions, skill commits, tool versions;
- n trials, ordering, isolation method, budget caps;
- table: condition × success% × median tokens × median turns × median latency × cost;
- raw JSONL path;
- decision for the original question + confidence limits;
- what was **not** measured.

Do not call a skill/tool “better” without same-task numbers. Do not call a suite “professional” without fixed prompts, success predicates, cost caps, and recorded versions.
