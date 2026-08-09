---
name: route-request
description: Use when the user is unsure which skill to run, pastes a messy freeform or voice prompt, has too many skills to choose from, or wants a mid-orchestrator to refine the request into a short plan that reuses existing skills (finish-and-ship, deslop, messy-repo-orchestrator, etc.) instead of inventing a new workflow. Also defines the seamless input-side refine contract (STT/type → refined text in the input → user proceeds in the same session). Triggers: "which skill", "how should I run this", "route this", "refine my prompt", "I don't know which skill", "orchestrate this request", "refine into input".
type: flow
---

# Route Request (mid-orchestrator)

You are a **dispatcher**, not a second implementation of every skill, and **not a second conversation**.

Turn messy freeform (typing or dictation) into a **ready agent prompt** that reuses existing skills.

Default: **reuse existing skills**. Only suggest creating a new skill when the job is repeated, stable, and not covered (then `capture-workflow` / `skill-from-feedback`).

## How this should feel (product contract)

The user should **not** feel interrupted mid-session by a long “routing meeting.”

| Mode | When | What happens |
|------|------|----------------|
| **A — Input-side (preferred)** | STT release or “refine before send” | Draft is refined **before** a real agent turn. Refined text lands **in the focused input** (same caret STT already uses). User glances, hits Enter, **same session** continues with the real work. |
| **B — Same-turn silent (typed already sent)** | Messy freeform already submitted | In **this same turn**, classify → pick primary skill → **execute that skill immediately**. No multi-message “here is my routing card, wait for you.” At most one short line: *Using `finish-and-ship`…* then do the work. |
| **C — Explicit advice only** | User asked “which skill?” only | Routing card + refined prompt; **do not execute** until they say “do it.” |

**Wrong:** open a separate routing chat, force Cmd+C / Ctrl+V as the main UX, or burn a full turn on a long plan when they already wanted the job done.

**Right:** refine → **input** (mode A) or refine → **same turn execute** (mode B). Clipboard is only an implementation detail inside STT paste (macOS already pastes via clipboard + ⌘V into the caret—user does not manage that).

### Relation to existing voice stack

- STT already inserts text with `type_text` (clipboard + paste into focused field).
- Optional Control double-tap can refine **clipboard** via `prompt_refinement` (“review” mode)—related, but not the full story.
- Goal for seamless STT: **after final transcript**, run **route-aware refine**, then `type_text(refined)` so the **input box** shows the ready prompt. User proceeds with Enter. Session never “switches characters.”

Product wiring lives in the voice worker / bag config; this skill defines **what** the refined string must contain. Do not invent a parallel product.

## Safety

- Do not invent skills that are not installed or cataloged.
- Do not skip safety of the target skill (no silent main commits, no remote delete, no deploy unless authorized).
- Prefer the **smallest** skill that fits.
- One **primary** skill; others are supporting only.
- Never strip quoted literals, paths, URLs, or code from the draft (same spirit as `prompt_refinement` validation).

## Workflow

### 1. Capture the raw request

Keep user wording. Note workspace if known. Strip secrets from logs, not from the refined prompt the user needs.

### 2. Classify (one primary)

| Class | Freeform signals | Primary skill |
|-------|------------------|---------------|
| Ship / branch / PR / report when done | new branch, open PR, commit push | `finish-and-ship` |
| Whole messy repo / every feature / backup main | multi-feature cleanup | `messy-repo-orchestrator` |
| Parallel agents / worktrees | many lanes, fan-out | `sdlc-tasks-executions` setup-lanes |
| Land concurrent lanes | salvage, integrate worktrees | `sdlc-tasks-executions` land-lanes |
| Local UI prove | launch local, playwright, don’t deploy | `preview-and-prove` |
| Prod live prove | redeploy, is live, curl | `deploy-and-prove` |
| Lean / ceremony | deslop, AI slop, ban payload | `deslop-v2` |
| Style system (existing code) | CODE-STYLE, grill with docs | `grill-me-code-style-with-docs` |
| Kill ports | free ports, metro 8081 | `kill-ports-local-dev` |
| Bootstrap Code folder | clone all GH repos | `workspace-bootstrap` |
| Cloudflare ops | wrangler, D1 (not prove live) | `cloudflare-ops` |
| Session skill mining | repeated prompts | `agent-session-auditor` |
| Fix a skill | skill misfired | `skill-from-feedback` |
| Bench A vs B | tokens, turns, same tasks | `agent-benchmark` |
| Unsure / voice dump | which skill | this skill → then primary |

See [REFERENCE.md](REFERENCE.md).

### 3. Build the refined prompt (the deliverable)

The refined prompt is a **single paste-ready agent message**, not a markdown report:

- Lead with skill trigger when helpful: `$finish-and-ship` or clear “use finish-and-ship”
- Explicit gates: branch name, open PR vs merge, deploy yes/no, report yes/no
- Exact strings/paths in quotes
- No filler, no “I will now…”, no multi-section essay

**Mode A (input-side):** only that string matters → inject into caret.  
**Mode B (same-turn):** use that string as the effective request and **run the primary skill now**.  
**Mode C (advice):** show a short routing card **plus** the same paste-ready string.

### 4. Mode A — input-side inject (preferred seamless path)

When the host/product can write the input field (STT worker after final transcript, or a refine-before-send binding):

1. Produce refined prompt only (no long card in the agent transcript unless debugging).  
2. Insert into the **focused agent input** (existing `type_text` / caret path).  
3. Stop. User edits if needed and submits. **No second session.**

### 5. Mode B — same-turn execute (typed/sent messy freeform)

When the user already sent a messy ask in this session:

1. Classify in one line max (optional).  
2. Load primary skill SKILL.md.  
3. Execute immediately under that skill.  
4. Do **not** wait for “ok run it” unless the ask was ambiguous on a destructive gate (merge, deploy, delete remote).

### 6. Mode C — advice only

If they only asked which skill / refine for later: short card + refined string. No execution.

### 7. New skill?

Only if repeated, stable, and uncovered → `capture-workflow` or `skill-from-feedback`. Else keep `route-request` + primary.

## Verification

**Routed (mode A):** refined string is paste-ready; injected or ready for input; user can proceed without a routing conversation.

**Routed (mode B):** primary skill’s verification is the source of truth for “done”; routing was not a separate incomplete session.

**Advice (mode C):** primary id + refined string + “do not use” list present.

Do not claim success because you wrote a long skill essay. Success is **correct primary skill + ready prompt + same-session feel**.
