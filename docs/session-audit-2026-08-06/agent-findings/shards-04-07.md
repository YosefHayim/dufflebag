# Reusable jobs — shards 04–07

## Coverage

- **Shards:** clean-shard-04 … 07 (~¼ of 20-shard split).
- **Volume:** ~260 lines total; ~half codex (history + mirrored session_jsonl), ~half grok chat_history. Expect ~1.5–2× inflation from history↔session_jsonl duplicates.
- **Agents:** codex + grok only.
- **Workspaces (job-like):** MYPR-App (dominant), launch-store, Oly-App, dufflebag, yt-caption-mini, Code root, YosefHayim, the-ascendars, vybekiit recovery worktree; many AF-* rows are grok **subagent** worktrees under `code-mypr-app`.
- **Cross-check:** `intent-refined.json` + installed skills (34 names).

## Top reusable jobs

Named by **job**, not prompt wording. Counts are unique-ish (ignore history/session dupes).

| Job | Signal in 04–07 | Cross-repo? | Notes |
|-----|-----------------|-------------|--------|
| **Grill + full-repo deslop** | High: same “`$grill-me-code-style-with-docs` from beginning / full deslop / ban result·payload·data·raw·isRecord” spawned across many sessions; follow-ups ban `??`, default exports, backward-compat re-exports, build/resolve/normalize* helpers | Yes | Template is copy-pasted; approval turns are noise around it |
| **Code-style ban-list enforcement** | Medium-high: “no generic vars”, “readable > smart”, module pure-purpose, PascalCase tsx, no emoji | Yes | Often mid-grill answers, not skill invocation |
| **Shared-contract SSOT / slim identity mappers** | High in MYPR: promote unions→`@mypr/shared`, deslop feature-local API types, remove pure `to*` copies path-sliced | Pattern yes; corpus is MYPR | Wave of structured agent briefs; reusable monorepo job if de-MYPR’d |
| **Organized commit + push** | Explicit `/organized-commits and push to main` | Yes | Short trigger, skill already named |
| **Voice / STT / TTS doctor** | Install “already up to date but node_modules missing”; TTS says “item”; STT mishears; hold-control UI thrash; mic-off-delay; freeze / stale node | dufflebag-centric | Matches `voice_dufflebag` intent bucket |
| **Install / CLI doctor** | pnpm claims up-to-date, `tsx` missing, ENOTDIR on main.ts; “is dufflebag installed glob” | Yes | Overlaps install_doctor intent |
| **Planpage one-shot Qs** | “ask all remaining questions in planpage so i can one shot” | Yes | Freeform + skill name |
| **Worktree prune after merge** | Erase worktrees already on remote main (e.g. yt-captions-mini-*) | Yes | Freeform; skill exists |
| **Skill install audit** | “are .agent skills symlinked to all dufflebag skills?” | Tooling | Maps to syncAgentSkills |
| **Focused verify gate** | typecheck PASS/FAIL only; run named specs; read-only ranked suspects | Yes | Subset of previewAndProve |
| **React-doctor ship gate** | Install react-doctor; block Android/TestFlight until 100 | Mobile repos | install_doctor / mobile gate |
| **GitHub repo metadata** | `/github-repo-metadata` | Yes | Already a skill |

**Penalized (project one-offs, not skill-worthy alone):** MYPR AF-NN feedback tickets, WhatsApp chart drilldown, prop-drill admin forms, Oly pose/motion QA, cold-outreach product strategy, YT header/cookie explain, single hyperlink merge (YosefHayim), store screenshot dimensions, plainsender rename.

## Skill recommendations

| Job | vs installed | Action | Why |
|-----|--------------|--------|-----|
| Grill + deslop + ban-list | `grillMeCodeStyle*`, `deslop`/`deslopV2` | **improve** | High freeform + `$grill-me…` despite skills; weak auto-trigger; bake banned names (`result/payload/data/raw/body`, `isRecord`, `build*/resolve*/normalize*`, default exports, `??`) + “readable > smart” into deslopV2/grill exit criteria |
| Organized commit/push | `organizedCommits`, `finishAndShip` | **improve** | Still short freeform `/organized-commits and push`; couple push/main policy + pre-commit typecheck |
| Voice STT/TTS | none | **create** (`voiceDoctor` / dufflebag voice) | Recurring install + quality + UI freeze; no skill |
| Install/CLI doctor | none | **create** (`installDoctor`) | node_modules/tsx/pnpm false-success + “is X installed”; fold react-doctor gate as optional mobile path |
| Planpage one-shot | `planpage` | **improve** | Exact phrase used; skill should one-shot remaining questions by default |
| Worktree prune | `coordinateWorktrees` | **improve** | User says “erase merged worktrees + confirm” freeform |
| Skill symlink audit | `syncAgentSkills` | **improve** | Doctor: verify machine `.agent` ↔ dufflebag skill set |
| Shared Zod / identity slim | partial: `reuseFirstAudit`, deslop family | **create** thin `monorepoContractSsot` **or improve** deslop | Path-scoped promote unions + kill identity mappers is repeated wave pattern; keep product-agnostic |
| Focused verify PASS/FAIL | `previewAndProve` | **improve** | Triggers for typecheck-only / named tests / read-only loop hunt |
| github-repo-metadata | `githubRepoMetadata` | **leave** | Invoked by name |
| AF-* ticket runner | none | **leave** | MYPR customer feedback packaging; capture as project playbook not dufflebag skill |
| Grill family sprawl | 7 grill* skills | **merge** (optional) | Same job surfaces as grill + deslop + ban-list; consider collapse coach/review into with-docs |

## Noise / non-skills

- Acks: “agreed”, “i approve”, “keep going”, “do it please”, “yes continue”.
- history.jsonl ↔ session_jsonl near-duplicates of the same turn.
- Screenshot-only UI nits; partial phrases (“ix failing holds…”).
- Product monologues (CRM outreach, Oly accuracy narrative).
- Subagent **AF-*** briefs (reusable *template shape*, not a cross-product skill).
- Injected “System Prompt + full YT transcript → skill files” (yt-caption pipeline one-off).
- Stack/install pastes when not framed as a repeatable doctor job.

## Limitations

- Shards 04–07 only; no global rank without other shard findings.
- Codex workspace often null → hard to score multi-repo vs single-repo.
- Keyword overlap inflates grill/deslop vs code_style buckets (same prompts).
- Subagent task text is synthetic user; good for templates, weak for “user said skill name” stats.
- Did not re-score fuzzy clusters; qualitative job merge only.
