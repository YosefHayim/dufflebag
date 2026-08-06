# Specialist priority rank — top 10 skill actions

**Source:** `intent-refined.json` + `coverage-manifest.json` + `installed-skills.json`  
**Findings dir:** empty (no peer specialist notes yet)  
**Scoring:** repetition × cross-agent breadth × cross-repo breadth × encoding clarity − one-off penalty  
**Corpus:** 1301 prompts (codex 921, grok 380); exact multi-session 378; fuzzy clusters 319

| rank | action | skill | evidence summary | priority score intuition | why not the alternative |
|---:|---|---|---|---|---|
| 1 | **improve** | `finishAndShip` (+ bridge `organizedCommits`) | 125 prompts / 116 sessions / 2 agents / ~30 workspaces; freeform “git commit push” / “fix then commit push” still dominates despite skills | **~95** — highest reusable ship loop | Don’t create a third ship skill; triggers/completion + multi-agent install are weak, not missing product |
| 2 | **merge** | grill code-style family → **`grillMeCodeStyleWithDocs` canonical** (`grillMeCodeStyle`, `Coach`, `Review` → thin aliases) | `code_style_docs` 98/96/2/~23 + `grill_me_family` 45/45 (codex-heavy); users name `$grill-me-code-style-with-docs` + full-repo deslop | **~90** — huge volume, skill sprawl | Don’t improve four peers in parallel; merge reduces choice paralysis and fixes weak auto-trigger |
| 3 | **merge + improve** | `deslop` + `deslopV2` → one skill; wire “full deslop” → grill-with-docs then execute | 53/53/2/4 repos; examples explicitly couple deslop + grill structure/naming bans | **~85** — clear job, overlaps rank 2 | Don’t create “deslopV3”; dual deslop confuses; leave only if merge lands first |
| 4 | **improve** | `previewAndProve` | 49/41/2/9 workspaces; QA/playwright/log-repeat/UI prove language without skill name | **~80** — prove-before-ship is a stable job | Don’t fold into `deployAndProve` yet (local/preview vs prod); tighten triggers first |
| 5 | **create** | `cloudflareStack` (wrangler / D1 / CF proxy / seed-backup) | 28/19/2/4 product repos (MYPR, Oly, genshot, vybekiit); **no skill** | **~78** — cross-repo stack pattern, no coverage | Don’t bolt onto `deployAndProve` only — CF/D1 migration+backup is a distinct playbook |
| 6 | **create** | `killLocalPorts` | 11/9/2/2; near-identical “kill all local ports except metro/8081” | **~72** — medium volume, **max encoding clarity** | Don’t leave as ad-hoc shell; tiny skill, huge friction savings vs inventing each session |
| 7 | **improve** | `deployAndProve` | 23/20/2/6 repos; prod/e2e “confirm it works” / webhook / re-seed | **~70** — real multi-repo, skill under-hit | Don’t create “prod-e2e” sibling; improve gates + when-to-use vs preview |
| 8 | **improve** | `webBestPractices` | 28/22/2/2 (MYPR, launch-store); Next structure / i18n / no `_components` | **~65** — clear but **narrow repo breadth** | Don’t create nextjs-structure skill; extend triggers + checklist for this stack |
| 9 | **improve_or_trigger** | `planpage` | 9/9/2/3; explicit “ask all questions in planpage one shot” | **~60** — low volume, **crystal name invoke** | Don’t create planpage-batch; skill exists — fix auto-trigger / one-shot Q round |
| 10 | **create** | `voiceInstallDoctor` (dufflebag TTS/STT hold-to-talk) | 24 prompts / **7 sessions** / 2 agents / dufflebag+Code; install, STT miss, TTS “item”, hold-Control UI thrash | **~55** — product-critical but **session-concentrated** | Don’t leave uncodified while shipping voice; one-off penalty for dufflebag-only scope |

## Explicit non-top-10 decisions

| intent | action | why deferred |
|---|---|---|
| `mypr_product` (158/153) | **leave** (do not create one mega-skill) | Mixed jobs: package-manager launch, customer PDF, e2e notifs, prop-drilling — high volume, **low encoding as one skill**; split later into e2e-verify / feedback-PDF only if clusters re-clean |
| `unclassified` (782) | **leave** | Auditor already: mixed one-offs |
| `readme_agent_docs` (34/34/20 ws) | **leave / re-bucket** | Examples are mostly AF tickets + type-boundary work, not README/docs — **evidence contamination**; fix clustering before improve |
| `duplicate_clone_repos` | **leave** | 7 sessions, codex-only, weak examples |
| `worktrees_coord` | **leave** (later trigger pass) | 7 sessions; `coordinateWorktrees` exists |
| `install_doctor` | **leave** | 5 sessions; confuses pnpm/dufflebag install vs react-doctor |
| `session_ops`, `skill_authoring` | **leave** | Low volume; skills already present |
| `blog_post`, `reuse_first`, `web_perf` | **leave** | 1–2 sessions; skills sufficient |

## Execution order (decisive)

1. **Ship loop** (rank 1) — biggest daily tax.  
2. **Grill/deslop consolidation** (ranks 2–3) — stop skill zoo, one path for “clean this repo.”  
3. **Prove stack** (ranks 4, 7) — preview then deploy.  
4. **New stack/util skills** (ranks 5–6) — CF + kill ports.  
5. **Polish** (ranks 8–10) — web practices, planpage trigger, voice doctor.

**Do not** invent skills for MYPR-as-a-bucket or unclassified until re-clustering reduces mixed intents.
