# Specialist: finish / ship / commit / push

**Intent:** `finish_ship_commit_push`  
**Volume (refined):** 125 prompts · 116 sessions · codex + grok · ~30 workspaces  
**Skills:** `finishAndShip`, `organizedCommits`  
**Verdict:** **improve** (do not leave; do not replace)

## Invocation: name vs freeform

| Mode | Skill | Frequency (audit) | Forms seen |
|------|--------|-------------------|------------|
| Freeform | (neither named) | **Dominant** | bare `git commit push` idioms |
| Named | `organized-commits` | Minority | `$organized-commits`, `[$organized-commits](…/SKILL.md)`, `/organized-commits` |
| Named | `finish-and-ship` | **Zero** in prompts | only listed as installed skill |

**Users almost never invoke `finish-and-ship` by name.** When they want quality history they sometimes name `organized-commits`; for routine close-out they type freeform git commands and expect the agent to act.

## Sanitized examples

### Freeform (default habit)

- `ok git commit push please.`
- `please git commit push to main`
- `ok nice git commit push`
- `nice now please git commit push`
- `git commit push please`
- `git commit push all unerleated locals chanes please`
- `fix please before we git commit push`
- `yes create commit snapshot continue full migration`

### Named skill (organized-commits only)

- `great job now do $organized-commits then push and ship (redploy)`
- `after finish all what i said please $organized-commits launch local, delete stale files… before we redploy and sync…`
- `/organized-commits and push to main.`
- `/organized-commits`

### Explicit anti-commit (parallel agents / scoped work)

- `… SSOT deslop only. No commit. Return files changed.`
- `NO git commit/add/push.` (worktree deslop scopes)
- `Do not commit/push.` (many MYPR subagent tickets)

### False-positive “ship” wording

- `…we ship it with tts and stt but not work…` → product/feature, not delivery skill

## Skill fit vs user language

| User says | Skill description claims | Gap |
|-----------|--------------------------|-----|
| `git commit push` / `commit push please` | Both skills mention commit/push/ship | Freeform still dominates; agent often skips full gates |
| `push to main` | Push when requested; no force-push protected | User authorizes main push casually; need gate + SHA proof |
| `$organized-commits` + redeploy + cleanup | organized-commits is git-only; finish-and-ship owns loop + deploy-and-prove | Named path is git skill; full “ship” needs finish-and-ship composition |
| `finish all… then organized-commits…` | finish-and-ship is outer loop | User names the *inner* skill, never the outer |
| `No commit` / `NO git commit/add/push` | Skills: only on explicit request | Must not auto-trigger on negation |

`finishAndShip` already composes `organized-commits`, `preview-and-prove`, `deploy-and-prove`. Content is right; **triggers and discoverability fail**.

## Failure modes (skill exists, user still repeats)

1. **Freeform never routes to skill** — same short phrase repeated across sessions (`git commit push please`, `ok nice git commit push`).
2. **finish-and-ship invisible** — zero name invocations; user has no habit for outer loop.
3. **Same session hybrid** — e.g. invoke `$organized-commits` for a good ship, later freeform `git commit push all unrelated locals` (bypasses organize + gates).
4. **Scope inflation in one turn** — commit + push + redeploy + delete stale + D1 backup; partial execution without finish-and-ship checklist → user re-asks.
5. **“Ship” collision** — product “ship TTS/STT” vs delivery ship pollutes auto-match.
6. **Parallel worktrees** — heavy “no commit” corpus; weak negation → risk of unwanted commits if auto-trigger is naive.
7. **Main-branch push as default** — freeform `push to main` without verification handoff language from the skill.

## Recommended improvements

1. **Auto-trigger on freeform close-out phrases** (case-insensitive, after intent work):  
   `git commit push`, `commit push please`, `ok nice git commit push`, `please git commit push`, `commit and push`, `push to main` (when work just completed).
2. **Map freeform commit+push → `finish-and-ship` outer** (which calls `organized-commits`); bare “organize commits” / `$organized-commits` → `organized-commits` only.
3. **Surface aliases in both descriptions** including exact user idioms and `/organized-commits`, `$organized-commits`, `/finish-and-ship`.
4. **Hard anti-triggers:** `no commit`, `do not commit`, `without commit`, `NO git commit/add/push`.
5. **Disambiguate “ship”:** require delivery context (commit/push/deploy/handoff), not product “ship feature”.
6. **One-line completion contract** agents must print (SHA, remote match, gate commands) so freeform pushes still get proof and user stops re-prompting.

## Leave vs improve

| Option | Why not / why |
|--------|----------------|
| leave | Volume high; freeform still dominates; finish-and-ship unused by name |
| create new | Skills already cover the job |
| **improve** | **Yes** — trigger phrases, composition default, anti-triggers, handoff proof |

## Sources

- `intent-refined.json` → `finish_ship_commit_push`
- `job-like-prompts.jsonl` / `clean-prompts*.jsonl` (sanitized samples above)
- `src/skills/finishAndShip/SKILL.md`, `src/skills/organizedCommits/SKILL.md`
