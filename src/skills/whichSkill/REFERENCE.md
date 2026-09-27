# Which skill — freeform → skill map

Use this as a quick lookup. Prefer **one primary** skill.

## Delivery & git

| You say… | Primary | Notes |
|----------|---------|--------|
| git commit push, wrap up, open PR, report when done | `finish-and-push` | Topic branch by default; no remote delete |
| split commits, conventional messages only | `organize-commits` | Outer loop still finish-and-push if “done” means handoff |
| new branch + small edit + PR | `finish-and-push` | Not clean-repo-by-feature |
| one feature fully to main (tests, act, merge, reinstall) | `ship-one-feature` | `/ship-one-feature` or existing `#N`; reuses run-tasks-in-parallel + finish-and-push |
| test gaps unit/MSW/e2e scan then TDD | `find-missing-tests` | `/find-missing-tests`; headless e2e default |
| over-engineering scan + before/after + TDD prove | `simplify-repo-with-tests` | `/simplify-repo-with-tests`; reuses simplify-code; headless e2e default |
| test gaps parallel lanes merge to main | `ship-missing-tests` | `/ship-missing-tests`; resume report; default merge after gates |
| numbered task list full SDLC one agent each | `run-tasks-in-parallel` **execute** | `/run-tasks-in-parallel` |
| merge many worktrees / salvage lanes | `run-tasks-in-parallel` **land-lanes** | |
| spawn many agents / `.worktrees/` / one issue per lane | `run-tasks-in-parallel` **setup-lanes** | |
| whole messy repo, every feature, backup main | `clean-repo-by-feature` | |

## Quality of code / structure

| You say… | Primary |
|----------|---------|
| deslop, AI slop, kill ceremony, ban payload/result (local/scope) | `simplify-code` |
| identify over-engineering whole repo, prove lean, fewer files/LOC same behavior | `simplify-repo-with-tests` |
| make readable / rename for clarity | `make-code-readable` |
| CODE-STYLE grill or compliance audit on existing repo | `code-style-existing-project` (grill vs audit mode) |
| brand-new empty project style | `code-style-new-project` |
| teach stack choices | `explain-my-stack` |
| plan / design grill | `question-my-plan` / `question-plan-with-docs` |

## Prove it works

| You say… | Primary |
|----------|---------|
| launch local, playwright, e2e, don’t deploy | `run-local-and-check` |
| scan/fill missing unit mocks e2e per feature (TDD) | `find-missing-tests` |
| over-engineering kill list + TDD parity + headless e2e | `simplify-repo-with-tests` |
| test-gap campaign worktrees PRs merge | `ship-missing-tests` |
| redeploy, is live, production smoke | `deploy-and-check` |
| /fix-bug, reproduce then fix, fix these bugs | `fix-bug` |

## Meta / skills / sessions

| You say… | Primary |
|----------|---------|
| which skill / refine my prompt / too many skills | **`which-skill`** (this) |
| fix this skill from feedback | `improve-skill` |
| scan sessions for repeated work | `find-repeated-prompts` |
| bench skill A vs B | `benchmark-agents` |
| turn what we just did into a skill | `save-as-skill` |
| sync skills to all agents | `install-skills` |

## Repo / platform utilities

| You say… | Primary |
|----------|---------|
| kill ports except metro | `free-ports` |
| clone all GH repos into Code | `clone-all-repos` |
| wrangler / D1 / KV ops | `manage-cloudflare` |
| README / AGENTS docs set | `write-readme` |
| Chrome Web Store listing SEO | `chrome-store-seo` |
| mobile store release | `release-mobile-app` |

## Agent artifact paths (anti-slop)

Campaign / audit MD is **not** product SSOT. Skills must write under **`docs/agent/<campaign>/<run-id>/`** (UTC `date -u +%Y-%m-%dT%H%M%SZ`; create if missing; set `CURRENT` pointer), never:

- root `TEST-GAP-*.md`, `LEAN-PROVE-*.md`, `*AUDIT*.md`, campaign boards
- fixed flat paths like `docs/agent/<campaign>/BOARD.md` that parallel agents overwrite
- product **`docs/agents/`** (plural — issue-tracker / triage / domain)

| Campaign | Dir |
|----------|-----|
| sdlc-tasks | `docs/agent/sdlc-tasks/<run-id>/` |
| test-gap / ship-missing-tests | `docs/agent/test-gap/<run-id>/` |
| simplify-repo-with-tests | `docs/agent/simplify-repo-with-tests/<run-id>/` |
| style audit | `docs/agent/style-audit/<run-id>/` |
| messy-repo matrix | `docs/agent/messy-repo/<run-id>/` |
| ux-journey | `docs/agent/ux-journey/<run-id>/` |
| benchmark | `docs/agent/benchmark/<run-id>/` |
| TEACH (stack grill) | `docs/learning/TEACH.md` |

Root stays for: README, AGENTS, CODE-STYLE, PROJECT, CONTEXT, LANGUAGE.

## Anti-patterns

- Using `clean-repo-by-feature` for a one-line string change  
- Using `deploy-and-check` when they said “run local only”  
- Creating a new skill for a one-off edit  
- Naming five primaries — pick **one** primary, rest supporting  
- Dropping agent report MD on the repository root  


## Template refined prompts

These strings are what should land **in the agent input** (STT inject) or be executed **same-turn** — not a multi-page plan.

**Branch + line edit + PR (no merge):**

```text
finish-and-push: create branch feat/<slug>, apply this exact text change: "<…>",
open PR to main, do not merge, report branch + PR URL + SHA.
```

**One feature all the way to main (tests + act + merge + reinstall):**

```text
/ship-one-feature <feature description>
/ship-one-feature #2
```

**Numbered tasks → one agent each → full SDLC:**

```text
/run-tasks-in-parallel
1. …
2. …
/run-tasks-in-parallel merge
1. …
```

**Scan test gaps (unit + mocks + e2e) then TDD fill; headless e2e default:**

```text
/find-missing-tests
/find-missing-tests scan-only
/find-missing-tests headed
/find-missing-tests surface=web
```

**Identify over-engineering; kill with parity tests; headless e2e default:**

```text
/simplify-repo-with-tests
/simplify-repo-with-tests scan-only
/simplify-repo-with-tests apply
/simplify-repo-with-tests headed
```

**Test gaps all the way: parallel lanes + merge (after gates):**

```text
/ship-missing-tests
/ship-missing-tests resume residual-only
/ship-missing-tests no-merge
/ship-missing-tests max-lanes=6
```

**Messy multi-feature cleanup:**

```text
clean-repo-by-feature: backup main, inventory features, one agent per feature,
issue + branch + PR each, no merge until I review.
```

**Unsure (advice only):**

```text
which-skill: here is my raw ask — <paste> — primary skill + paste-ready refined prompt only.
```

## Seamless UX (how to do this right)

```text
[STT hold-Shift release] or [typed draft]
        │
        ▼
  route-aware refine  (which-skill rules + preserve literals)
        │
        ▼
  insert into focused input  (type_text / caret — user sees it)
        │
        ▼
  user hits Enter  →  normal agent turn in SAME session
        │
        ▼
  primary skill runs (finish-and-push, simplify-code, …)
```

| Approach | Feels like | Use |
|----------|------------|-----|
| Refine → **input** → Enter | Talking to one agent | STT / pre-send (preferred) |
| Messy Enter → **same turn** silent route + execute | One reply, work happens | Typed freeform already sent |
| Separate “routing chat” then restart | Interrupt / context switch | **Avoid** |
| Manual Cmd+C / Cmd+V as the product | Clunky | Only internal to `type_text` |

Existing pieces:

- STT already pastes into the caret (`src/hooks/voice/worker/src/typing.rs`).
- Optional Shift double-tap refines **clipboard** (`refineMode=clipboard|both`).
- **Product wiring (mode A):** after **final STT transcript**, when `refineMode=dictation|both`, voice runs route-aware `refine_prompt.py` (default provider `codex` / model `gpt-5.3-codex-spark`), then `type_text(refined)` into the caret. See `src/hooks/voice/worker/TESTING.md`.
