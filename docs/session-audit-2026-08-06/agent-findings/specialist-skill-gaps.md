# Specialist: NEW skill gaps (no/weak coverage)

Scope: intents flagged `create` in `intent-refined.json` + multi-session freeform jobs not owned by installed skills (`installed-skills.json`). Sources: job-like prompts, exact/fuzzy clusters, coverage-manifest (1301 prompts; codex+grok).

**Decision legend:** **CREATE** = new skill · **LEAVE** = keep freeform · **FOLD** = absorb into another skill/asset.

---

## CREATE (priority order)

### 1. `kill_ports_local_dev` — **CREATE** (strong)
- **Evidence:** 11 prompts / **9 sessions** (intent); fuzzy `c0243` 8/6, high confidence. Agents: codex+grok. WS: `Code`, `MYPR-App`.
- **Trigger (stable):** `kill all local ports` (+ optional `except metro` / `except 8081` / `except metro and launch <app>`).
- **Deterministic?** Yes: list listeners → kill non-allowlist → optional `launch <repo> local` → report remaining ports.
- **Why skill:** Short freeform, high reuse, zero product judgment; agents reinvent `lsof`/`kill` each time.
- **Not covered by:** nothing installed.

### 2. `cloudflare_stack` — **CREATE** (narrow ops skill)
- **Evidence:** 28 prompts / **19 sessions**; WS: MYPR, Oly, genshot, vybekiit. No matching skill (`deployAndProve` is ship/prove, not CF plumbing).
- **Trigger:** `wrangler`, `d1`, `R2`/`two-bucket`, CF proxy auth, migration drop/backup, `open-next`+CF.
- **Deterministic core:** auth (OAuth vs token), resource inventory, backup D1 before drop, re-init/migrate, remove unnecessary proxy, local launch + sync checklist.
- **Why skill:** Same hygiene loop across SaaS repos; today mixed with deslop/product so keep skill **ops-only** (no full re-architecture).
- **Scope guard:** hand structure/deslop to `deslopV2` / grill family; ship gate to `deployAndProve`.

### 3. `duplicate_clone_repos` (+ workspace bootstrap) — **CREATE**
- **Evidence:** 7 prompts / **7 sessions** (intent); fuzzy `c0008` 5/5. Freeform: “duplicate every repo on gh… into Code folder without installs”.
- **Adjacent jobs (same Mac-bootstrap arc, low n alone):** bulk `pnpm i` per Code child except npm-only (~2 sessions); `pull every repo remote branches… sync` (~2); org expand (vybekiit, genshot.dev).
- **Trigger:** `duplicate every repo` / `clone all gh orgs into Code` / `install via pnpm for each repo` / `pull every repo…sync`.
- **Deterministic?** Yes: `gh` list orgs → clone missing → skip install on clone → optional bulk pnpm (detect package manager) → optional fetch/pull + report deltas.
- **Why skill:** Repeatable workspace setup; overlaps weakly with `githubRepoMetadata` (metadata only) — do **not** overload that skill.
- **Shape:** one skill with modes: `clone-only` | `install` | `sync-pull`.

### 4. `repo_health_explain` — **CREATE** (light / optional)
- **Evidence:** fuzzy `c0038` **4 sessions** / 4 prompts. Near-exact freeform: purpose, unused deps, mid-merge/stale, structure fit (sometimes vs vendor docs).
- **Trigger:** `explain … this repo` + unused deps + stale/merges + structure logical.
- **Deterministic checklist:** purpose from README/manifests; dep graph orphans; dirty/mid-merge branches; tree vs stated purpose; ranked keep/drop.
- **Why:** multi-session freeform onboarding; weaker n than kill-ports but stable shape.
- **Overlap:** `reuseFirstAudit` is reuse audit only — different job.

---

## LEAVE / FOLD (do not skill yet)

### 5. `install_doctor` — **LEAVE** (bucket polluted)
- **Evidence:** 5 prompts / 5 sessions labeled create, but mixed jobs:
  1. pnpm install confusion / packageManager mismatch
  2. **react-doctor → score 100** gate before store upload (MYPR product)
  3. launch-store `doctor` CLI facade cleanup (product)
- **Deterministic?** Only (1) is generic; (2)(3) are app-specific.
- **Action:** leave freeform; if anything, a thin **package-manager doctor** step inside workspace bootstrap — not a mega “install_doctor”.

### 6. `voice_dufflebag` — **LEAVE** (product debug, not agent skill)
- **Evidence:** 24 prompts / **7 sessions** (high churn, few sessions); TTS/STT bugs, Control hold, word-highlight noise, accuracy, later CLI (`dufflebag stt/tts on/off`).
- **Trigger:** freeform voice bugs, not a reusable cross-repo procedure.
- **Why leave:** work is **building/fixing dufflebag itself**; a skill would document product TODOs, not a transferable agent job. Prefer product fixes + CLI docs.

### 7. `cmux` + voice focus — **FOLD / LEAVE**
- **Evidence:** same sessions as voice; “cmux multipane → TTS spam all panes”; want play only on focused pane + interrupt key.
- **Why not separate skill:** cmux-specific product behavior of dufflebag hooks; implement in product, not a new skill.

### 8. `statusline` setup — **LEAVE** (or **asset**, not skill)
- **Evidence:** ~3 freeform turns / 2 sessions (`/statusline show…`, edit folder+model+reasoning, “add to dufflebag… `statuslines/codex`”).
- **Why leave:** one-time Codex config; user already asked for **packaged statusline snippet**, not a multi-step agent workflow. Ship under dufflebag `statuslines/codex` template if missing.

### 9. bulk `pnpm` across Code / multi-repo pull-sync alone — **FOLD** into #3
- n too low for standalone skills; same bootstrap narrative as clone.

---

## Explicit non-gaps (out of this specialist)

| Intent | n sessions | Note |
|--------|------------|------|
| `mypr_product` | 153 | Product workstream, not a skill |
| `finish_ship_*` / grill / deslop / preview / deploy | high | **improve** existing skills (other specialist) |
| `unclassified` | 130 | Mixed one-offs |

---

## Recommended create queue

1. **kill_ports_local_dev** — ship first (clearest ROI).
2. **workspace_bootstrap** (clone + optional pnpm + pull-sync) — covers `duplicate_clone_repos` + bulk install/sync.
3. **cloudflare_ops** — D1 backup/drop/reinit, wrangler auth, proxy cleanup; stop before product deslop.
4. **repo_health_explain** — only if queue has capacity.

**Do not create:** voice_dufflebag, cmux voice, statusline skill, catch-all install_doctor.

---

## Trigger phrases (copy for future SKILL.md descriptions)

| Skill | Phrases |
|-------|---------|
| kill_ports | “kill all local ports”, “except metro”, “except 8081”, “launch X local after kill” |
| workspace_bootstrap | “duplicate every repo”, “clone into Code”, “pnpm for each repo”, “pull every repo…sync” |
| cloudflare_ops | “wrangler”, “d1 backup/drop/reinit”, “cf proxy”, “R2/buckets” |
| repo_health | “explain this repo”, “unused deps”, “stale merges”, “structure logical” |
