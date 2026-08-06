# Route Request — freeform → skill map

Use this as a quick lookup. Prefer **one primary** skill.

## Delivery & git

| You say… | Primary | Notes |
|----------|---------|--------|
| git commit push, wrap up, open PR, report when done | `finish-and-ship` | Topic branch by default; no remote delete |
| split commits, conventional messages only | `organized-commits` | Outer loop still finish-and-ship if “done” means handoff |
| new branch + small edit + PR | `finish-and-ship` | Not messy-repo-orchestrator |
| merge many worktrees / salvage lanes | `coordinate-worktrees` **land-lanes** | |
| spawn many agents / `.worktrees/` / one issue per lane | `coordinate-worktrees` **setup-lanes** | |
| whole messy repo, every feature, backup main | `messy-repo-orchestrator` | |

## Quality of code / structure

| You say… | Primary |
|----------|---------|
| deslop, AI slop, lean, kill ceremony, ban payload/result | `deslop-v2` |
| make readable / rename for clarity | `deslop` |
| CODE-STYLE from scratch on existing repo | `grill-me-code-style-with-docs` |
| brand-new empty project style | `grill-me-code-style` |
| teach stack choices | `grill-me-stack` |
| plan / design grill | `grill-me` / `grill-with-docs` |

## Prove it works

| You say… | Primary |
|----------|---------|
| launch local, playwright, e2e, don’t deploy | `preview-and-prove` |
| redeploy, is live, production smoke | `deploy-and-prove` |

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

## Anti-patterns

- Using `messy-repo-orchestrator` for a one-line string change  
- Using `deploy-and-prove` when they said “run local only”  
- Creating a new skill for a one-off edit  
- Naming five primaries — pick **one** primary, rest supporting  

## Template refined prompts

These strings are what should land **in the agent input** (STT inject) or be executed **same-turn** — not a multi-page plan.

**Branch + line edit + PR (no merge):**

```text
finish-and-ship: create branch feat/<slug>, apply this exact text change: "<…>",
open PR to main, do not merge, report branch + PR URL + SHA.
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
- Optional Control double-tap refines **clipboard** (`prompt_refinement` review mode).
- Next product step: after **final STT transcript**, run route-aware refine, then `type_text(refined)` so the input shows the ready prompt—no separate session.
