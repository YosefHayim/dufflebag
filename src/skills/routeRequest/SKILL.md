---
name: route-request
description: Use when the user is unsure which skill to run, pastes a messy freeform or voice prompt, has too many skills to choose from, or wants a mid-orchestrator to refine the request into a short plan that reuses existing skills (finish-and-ship, deslop, messy-repo-orchestrator, etc.) instead of inventing a new workflow. Triggers: "which skill", "how should I run this", "route this", "refine my prompt", "I don't know which skill", "orchestrate this request".
type: flow
---

# Route Request (mid-orchestrator)

You are a **dispatcher**, not a second implementation of every skill.

Turn messy freeform (typing or dictation) into:

1. a **clear goal** in one sentence  
2. a **primary skill** (and optional supporting skills) that already exist  
3. a **refined prompt** the user can paste or that you then execute under that skill  
4. what **not** to use (overkill / wrong job)

Default: **reuse existing skills**. Only suggest creating a new skill when the job is repeated, stable, and not covered (then hand off to `capture-workflow` or `skill-from-feedback`).

## Safety

- Do not invent skills that are not installed or cataloged. Prefer the repo’s / user’s real skill list when available.
- Do not skip safety of the target skill (no silent main commits, no remote delete, no deploy unless the refined request authorizes it).
- If the user only asked for routing advice, **stop after the plan** unless they say “do it” / “run it.”
- Prefer the **smallest** skill that fits. Multi-agent / messy-repo orchestration is for multi-feature fan-out, not a one-line edit.
- When multiple skills could apply, pick one **primary** and list the rest as **supporting** in order.

## Workflow

### 1. Capture the raw request

Keep the user’s wording (or a short paraphrase). Note repo/workspace if known. Strip secrets before logging.

### 2. Classify the job (pick one primary class)

| Class | Typical freeform | Primary skill |
|-------|------------------|---------------|
| Ship / branch / PR / “report when done” | new branch, open PR, commit push, handoff | `finish-and-ship` (+ `organized-commits`) |
| Multi-feature cleanup on a messy repo | whole project, every feature, backup main | `messy-repo-orchestrator` |
| Parallel lanes / worktrees | many agents, `.worktrees/`, fan-out | `coordinate-worktrees` (setup-lanes) |
| Land concurrent worktrees | salvage, merge lanes, integrate | `coordinate-worktrees` (land-lanes) |
| Local UI prove | launch local, playwright, e2e, don’t deploy | `preview-and-prove` |
| Prod / redeploy prove | redeploy, is live, curl smoke | `deploy-and-prove` |
| Lean / kill ceremony | deslop, AI slop, flatten, ban payload | `deslop-v2` (then `deslop` if readability) |
| Style system on existing code | CODE-STYLE, grill with docs, structure | `grill-me-code-style-with-docs` |
| Greenfield style | empty/new project style | `grill-me-code-style` |
| Kill ports | free ports, except metro 8081 | `kill-ports-local-dev` |
| Bootstrap Code folder | clone all GH repos, bulk pnpm | `workspace-bootstrap` |
| Cloudflare ops | wrangler, D1, KV, R2 (not “prove live”) | `cloudflare-ops` |
| Scan sessions for skill ideas | repeated prompts, skill opportunities | `agent-session-auditor` |
| Improve a skill from feedback | this skill misfired, fix triggers | `skill-from-feedback` |
| Measure skill/tool quality | same tasks, tokens/turns/cost | `agent-benchmark` |
| Unsure / messy freeform | “which skill”, voice dump | **this skill** (`route-request`) then the primary |

Full quick map: [REFERENCE.md](REFERENCE.md).

### 3. Output a routing card (always)

```markdown
## Goal
<one sentence>

## Primary skill
`<skill-id>` — why

## Supporting (optional, ordered)
1. `…` — why
2. `…` — why

## Refined prompt (copy-paste)
> …

## Do not use
- `…` — why (overkill / wrong)

## Gates
- branch? PR? merge? deploy? (explicit yes/no from user intent)
```

### 4. Refine the prompt

Rewrite freeform so the **primary skill’s triggers** fire:

- Name the branch if they want one (`feat/…`, `v12-…`)
- Say **open PR** vs **merge** explicitly  
- Say **report** when they want a handoff  
- Put the exact text/content in quotes  
- Add `$skill-id` or the skill name once if the host needs it  

Example (bio line + branch + PR):

> Raw: *new branch v12 update line … street cat … report when done pr open*  
> Refined: *On branch `feat/v12-street-cat-bio`, change that line to: `…`. Open a PR to main, do not merge. Report branch + PR URL. Use finish-and-ship.*

### 5. Execute only if asked

If the user says run / do it / go:

1. Load and follow the **primary** skill’s SKILL.md.  
2. Call supporting skills at the handoff points they define.  
3. Do not re-implement their workflows in this skill.

If they only wanted routing, stop after the card.

### 6. When to suggest a new skill

Only if:

- the same job appears repeatedly (session audit / user says so), and  
- no existing skill covers it without painful freeform, and  
- the workflow is stable enough to encode  

Then: `capture-workflow` (new) or `skill-from-feedback` (extend existing). Otherwise leave as ordinary prompting + `route-request`.

## Verification

Before claiming “routed”:

- primary skill id exists in the installed/catalog set (or you stated it may be missing)  
- refined prompt includes branch/PR/merge/deploy gates as yes/no  
- overkill skills called out under **Do not use**  
- if executed: evidence comes from the **primary** skill’s verification, not this skill alone  

Do not claim the user “should memorize the catalog.” Success is a correct primary skill + a pasteable refined prompt.
