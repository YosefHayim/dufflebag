# Route Request — freeform → skill map

Use this as a quick lookup. Prefer **one primary** skill.

## Delivery & git

| You say… | Primary | Notes |
|----------|---------|--------|
| git commit push, wrap up, open PR, report when done | `finish-and-ship` | Topic branch by default; no remote delete |
| split commits, conventional messages only | `organized-commits` | Outer loop still finish-and-ship if “done” means handoff |
| new branch + small edit + PR | `finish-and-ship` | Not messy-repo-orchestrator |
| one feature fully to main (tests, act, merge, reinstall) | `ship-feature-e2e` | `/ship-feature-e2e` or existing `#N`; reuses sdlc-tasks-executions + finish-and-ship |
| test gaps unit/MSW/e2e scan then TDD | `test-gap-tdd` | `/test-gap-tdd`; headless e2e default |
| over-engineering scan + before/after + TDD prove | `lean-prove` | `/lean-prove`; reuses deslop-v2; headless e2e default |
| test gaps parallel lanes merge to main | `test-gap-ship` | `/test-gap-ship`; resume report; default merge after gates |
| numbered task list full SDLC one agent each | `sdlc-tasks-executions` **execute** | `/sdlc-tasks-executions` |
| merge many worktrees / salvage lanes | `sdlc-tasks-executions` **land-lanes** | was coordinate-worktrees |
| spawn many agents / `.worktrees/` / one issue per lane | `sdlc-tasks-executions` **setup-lanes** | was coordinate-worktrees |
| whole messy repo, every feature, backup main | `messy-repo-orchestrator` | |

## Quality of code / structure

| You say… | Primary |
|----------|---------|
| deslop, AI slop, kill ceremony, ban payload/result (local/scope) | `deslop-v2` |
| identify over-engineering whole repo, prove lean, fewer files/LOC same behavior | `lean-prove` |
| make readable / rename for clarity | `deslop` |
| CODE-STYLE grill or compliance audit on existing repo | `grill-me-code-style-with-docs` (grill vs audit mode) |
| brand-new empty project style | `grill-me-code-style` |
| teach stack choices | `grill-me-stack` |
| plan / design grill | `grill-me` / `grill-with-docs` |

## Prove it works

| You say… | Primary |
|----------|---------|
| launch local, playwright, e2e, don’t deploy | `preview-and-prove` |
| scan/fill missing unit mocks e2e per feature (TDD) | `test-gap-tdd` |
| over-engineering kill list + TDD parity + headless e2e | `lean-prove` |
| test-gap campaign worktrees PRs merge | `test-gap-ship` |
| redeploy, is live, production smoke | `deploy-and-prove` |
| /fix-bug, reproduce then fix, fix these bugs | `fix-bug` |

## Meta / skills / sessions

| You say… | Primary |
|----------|---------|
| which skill / refine my prompt / too many skills | **`route-request`** (this) |
| fix this skill from feedback | `skill-from-feedback` |
| scan sessions for repeated work | `agent-session-auditor` |
| bench skill A vs B | `agent-benchmark` |
| turn what we just did into a skill | `capture-workflow` |
| sync skills to all agents | `sync-agent-skills` |

## Repo / platform utilities

| You say… | Primary |
|----------|---------|
| kill ports except metro | `kill-ports-local-dev` |
| clone all GH repos into Code | `workspace-bootstrap` |
| wrangler / D1 / KV ops | `cloudflare-ops` |
| README / AGENTS docs set | `readme-editor` |
| Chrome Web Store listing SEO | `cws-listing-seo` |
| mobile store release | `mobile-release` |

## Agent artifact paths (anti-slop)

Campaign / audit MD is **not** product SSOT. Skills must write under **`docs/agent/<campaign>/<run-id>/`** (UTC `date -u +%Y-%m-%dT%H%M%SZ`; create if missing; set `CURRENT` pointer), never:

- root `TEST-GAP-*.md`, `LEAN-PROVE-*.md`, `*AUDIT*.md`, campaign boards
- fixed flat paths like `docs/agent/<campaign>/BOARD.md` that parallel agents overwrite
- product **`docs/agents/`** (plural — issue-tracker / triage / domain)

| Campaign | Dir |
|----------|-----|
| sdlc-tasks | `docs/agent/sdlc-tasks/<run-id>/` |
| test-gap / test-gap-ship | `docs/agent/test-gap/<run-id>/` |
| lean-prove | `docs/agent/lean-prove/<run-id>/` |
| style audit | `docs/agent/style-audit/<run-id>/` |
| messy-repo matrix | `docs/agent/messy-repo/<run-id>/` |
| ux-journey | `docs/agent/ux-journey/<run-id>/` |
| benchmark | `docs/agent/benchmark/<run-id>/` |
| TEACH (stack grill) | `docs/learning/TEACH.md` |

Root stays for: README, AGENTS, CODE-STYLE, PROJECT, CONTEXT, LANGUAGE.

## Anti-patterns

- Using `messy-repo-orchestrator` for a one-line string change  
- Using `deploy-and-prove` when they said “run local only”  
- Creating a new skill for a one-off edit  
- Naming five primaries — pick **one** primary, rest supporting  
- Dropping agent report MD on the repository root  


## Template refined prompts

These strings are what should land **in the agent input** (STT inject) or be executed **same-turn** — not a multi-page plan.

**Branch + line edit + PR (no merge):**

```text
finish-and-ship: create branch feat/<slug>, apply this exact text change: "<…>",
open PR to main, do not merge, report branch + PR URL + SHA.
```

**One feature all the way to main (tests + act + merge + reinstall):**

```text
/ship-feature-e2e <feature description>
/ship-feature-e2e #2
```

**Numbered tasks → one agent each → full SDLC:**

```text
/sdlc-tasks-executions
1. …
2. …
/sdlc-tasks-executions merge
1. …
```

**Scan test gaps (unit + mocks + e2e) then TDD fill; headless e2e default:**

```text
/test-gap-tdd
/test-gap-tdd scan-only
/test-gap-tdd headed
/test-gap-tdd surface=web
```

**Identify over-engineering; kill with parity tests; headless e2e default:**

```text
/lean-prove
/lean-prove scan-only
/lean-prove apply
/lean-prove headed
```

**Test gaps all the way: parallel lanes + merge (after gates):**

```text
/test-gap-ship
/test-gap-ship resume residual-only
/test-gap-ship no-merge
/test-gap-ship max-lanes=6
```

**Messy multi-feature cleanup:**

```text
messy-repo-orchestrator: backup main, inventory features, one agent per feature,
issue + branch + PR each, no merge until I review.
```

**Unsure (advice only):**

```text
route-request: here is my raw ask — <paste> — primary skill + paste-ready refined prompt only.
```

## Seamless UX (how to do this right)

```text
[STT hold-Control release] or [typed draft]
        │
        ▼
  route-aware refine  (route-request rules + preserve literals)
        │
        ▼
  insert into focused input  (type_text / caret — user sees it)
        │
        ▼
  user hits Enter  →  normal agent turn in SAME session
        │
        ▼
  primary skill runs (finish-and-ship, deslop-v2, …)
```

| Approach | Feels like | Use |
|----------|------------|-----|
| Refine → **input** → Enter | Talking to one agent | STT / pre-send (preferred) |
| Messy Enter → **same turn** silent route + execute | One reply, work happens | Typed freeform already sent |
| Separate “routing chat” then restart | Interrupt / context switch | **Avoid** |
| Manual Cmd+C / Cmd+V as the product | Clunky | Only internal to `type_text` |

Existing pieces:

- STT already pastes into the caret (`voice/src/typing.rs`).
- Optional Control double-tap refines **clipboard** (`promptRefinementMode=review|both`).
- **Product wiring (mode A):** after **final STT transcript**, when `promptRefinementMode=stt|both`, voice runs route-aware `prompt_refinement.py` (default backend `codex` / model `gpt-5.3-codex-spark`), then `type_text(refined)` into the caret. See `src/hookIsland/speakResponse/voice/TESTING.md`.
