# Specialist: false positives (do NOT skill)

Skeptic pass over `exact-clusters.json`, `top-fuzzy-preview.json`, `intent-refined.json`, `job-like-prompts.jsonl`. These look high-count but encode no reusable job.

## 1. Acknowledgements / session glue

| Cluster / norm | Count (approx) | Why not a skill |
|---|---|---|
| `agreed b` / `agreed a` / `agreed. a` / `agreed. b` / `agrede. b` | 10+8+8+6+4 | Binary A/B pick for a *prior* grill question; content-free |
| `approved` | 6 | Gate ack; no procedure |
| `yes agreed.` / `agreed do it.` / `agreed with all` / `yes i agree` | 5+4+… | Conversation continuum |
| `keep going` / `try now.` / `proceed from where interrupted` | 4 each | Resume tokens; state is in the session, not a skill |
| `Say only hi` | 4 | Smoke/healthcheck of the harness |
| fuzzy `approve all recommendtation` / `proceed from where interrupted` | 4 | Same class |

**Harm if skilled:** auto-triggers on every “approved” and spams finish/write flows; zero transfer across tasks.

## 2. Grill-me multiple-choice answers (not “grill” jobs)

Same family as above, but freeform taste answers:

- `i would say next.js best practices.` / `i would say repo with just widget and fully next.js…` (exact ×5 each)
- `a but ban build or to or resolve`, `we got the open api… i would say a`, `yes i mean a`, `b but no ??`
- `and what about structure of files/folder tree show the prposed one` (follow-up turn)

These inflate `code_style_docs`, `grill_me_family`, `deslop`, `web_best_practices`. The *real* skill is already `grill-me-*`; answers are ephemeral picks.

**Harm:** a skill matching “i would say …” invents stack decisions without a grill context.

## 3. Injected system / skill bodies (harness noise)

| Source | ID / count | What it is |
|---|---|---|
| exact | norm count **16** | Full `<skill>grill-me-code-style-with-docs…</skill>` paste into user turn |
| exact | coach skill body ×**4** | Same for `grill-me-code-style-coach` |
| exact + fuzzy **c0370** | **11** / 12 sess | `System Prompt: You are a skill author for Grok Build…` + long YT transcript |
| exact | recommended_plugins + AGENTS.md + env ×**6** | Codex bootstrap blob, not a user job |

Also sits under intent `skill_authoring` / `code_style_docs`. Skill already exists on disk; re-authoring from session dumps duplicates SSOT and can drift.

**Harm:** “create skill from skill dump” circular skills; transcript→skill is a *product pipeline* (yt-captions), not a dufflebag habit skill.

## 4. MYPR mission paste (subagent fan-out)

Fuzzy **c0466** (8) + **c0500** (6):  
`MYPR monorepo… ## Mission Remove/slim identity mappers… ## Your ONLY paths …`

Variants differ only by path slices (`affiliates/**` vs `blog/**` vs `client/src/features/chat/**`). One-shot parallel worktrees, not a stable user phrase.

**Harm:** a “MYPR mission” skill would re-run mapper-kill on every MYPR session, ignore path locks, and fight finished cleanups. Product work belongs in tickets/CODE-STYLE, not a generic skill.

## 5. Error dumps / stack pastes

- `why i cant launch… pnpm… [ERROR] This project is configured to use npm` (in `mypr_product` examples)
- `fix Maximum update depth exceeded… Component Stack…` (exact cluster; also under finish_ship)
- production `Minified React error #185…` paste (`deploy_and_prove` examples)
- long terminal noise: `tsx: command not found` / `ENOTDIR … package.json` (exact ×2)

Repetition = same bug / same paste, not a workflow. Skills for “fix this stack” overfit one stack frame.

**Harm:** trigger on any “Error:” / “Component Stack” and thrash; true job is “debug current failure in context.”

## 6. `environment_context` only

Fuzzy **c0330** (16 sess / 19 prompts) + exact env-only clusters (×6, ×4):  
`<environment_context><cwd>…</cwd><shell>zsh</shell>…`

Agent/runtime injection, not user intent. Often sole “prompt” in a session record.

**Harm:** matching `<environment_context` is nonsensical as a skill; would fire on every Codex turn bootstrap.

## Intent-bucket pollution (do not “create” from these)

| Intent | Why inflated |
|---|---|
| `mypr_product` (rec: create) | Mix of real product asks + error dumps + mission templates + prop-drill one-offs |
| `grill_me_family` / `code_style_docs` | Skill-body inject + MC acks; skills already installed |
| `skill_authoring` | System-prompt + transcript pipelines |
| `unclassified` | Short acks (`ok so i did`, `Nooooooo`) |

## Rule of thumb

**Skill only if:** (1) user could re-issue the same *job* next month in another repo, (2) body is a procedure not a reply, (3) not harness/system text, (4) not a paste of logs/stacks/missions with path locks.

**Strip before skill mining:** `<environment_context`, `<recommended_plugins`, `<skill>`, `System Prompt:`, `## Mission`+`Your ONLY paths`, pure `agreed [ab]`, sole `approved`/`keep going`, stack traces, shell error dumps.
