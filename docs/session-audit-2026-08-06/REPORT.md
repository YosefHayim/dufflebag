# Agent Session Audit Report

**Date:** 2026-08-06  
**Machine:** local Mac (`yosefhayimsabag`)  
**Scope:** all local Codex + Grok sessions since this Mac (~2026-07-30 onward)  
**Goal:** prove which user prompts are *repeatable jobs*, then recommend **create / improve / leave** for dufflebag skills  
**Method:** local-only extract → normalize → cluster → intent map → **20 analysis agents** (5 shard packs + 15 specialists) → consensus

This report is **evidence-backed and sanitized**. No raw transcript dumps. Paths, URLs, UUIDs redacted.

---

## 1. Executive verdict

You do have strong repeatable work. Most of it is **not “missing skills”** — it is **skills that exist but do not auto-trigger on freeform language**.

| Action | What |
|--------|------|
| **Improve first (P0)** | `finishAndShip` + `organizedCommits`, grill/deslop family, `agentSessionAuditor` pipeline |
| **Create (P0–P1)** | `killPortsLocalDev`, `cloudflareOps`, `workspaceBootstrap` (bulk GH clone + optional pnpm) |
| **Create later (P2)** | Thin monorepo SSOT helpers (`promoteSharedZod`, `meaningfulMappingCleanup`) — rules only, not MYPR path locks |
| **Do not create** | “MYPR skill”, AF-ticket skill, voice/cmux product skill, install_doctor catch-all, ack/env/stack “skills” |

**Execution order**

1. Improve auditor extract/cluster quality (so future audits are cheap)  
2. Freeform triggers for ship / grill / deslop  
3. Create kill-ports + CF ops + workspace bootstrap  
4. Freeform triggers for preview/deploy prove  
5. Optional monorepo SSOT skills after re-cluster without MYPR subagent inflation  

---

## 2. Coverage (honest)

| Agent | Store | Sessions / files | User prompts extracted | Notes |
|-------|--------|------------------|------------------------|-------|
| **Codex** | `~/.codex/history.jsonl` + `~/.codex/sessions/**/*.jsonl` | 77 session files; 960 history lines | **921** unique after dedupe | Dominant corpus (~71%) |
| **Grok** | `~/.grok/sessions/**/chat_history.jsonl` | 458 session dirs | **380** | Includes many MYPR worktree subagents |
| **Claude Code** | — | 0 | 0 | Skills installed under `~/.claude`; **no session store** on this Mac |
| **Cursor** | — | 0 | 0 | Not installed / no store |
| **ai-browser-bridge** | `Desktop/Code/.bridge/sessions` | 4 | 0 | Empty events |

**Totals after normalize + session-level dedupe:** **1,301** user prompts; **378** exact multi-session prompts; **319** fuzzy clusters (pre-noise filter).

### Extraction rules

- User-authored only (history text, Codex `user` / `user_message`, Grok `user` with `<user_query>` body)  
- Drop synthetic/system reminders, permission blobs, multi-agent bootstrap  
- Drop short acks (`yes`, `continue`, `ok`)  
- Redact secrets, URLs, UUIDs, home paths  
- Normalize: lower-case, collapse whitespace, number placeholders  

### Clustering method

| Layer | Method | Thresholds |
|-------|--------|------------|
| Exact | Normalized string equality across sessions | — |
| Fuzzy | Token Jaccard ×0.55 + bigram Jaccard ×0.45 | 0.42 long / 0.55 short prompts |
| Intent | Keyword rules mapped to installed skills | Multi-label possible; see limitations |
| Agents | 20 Grok subagents on shards + specialists | Local files only; no hosted embeddings |

### Limitations (why this is not “all sessions ever”)

1. **New Mac window** — only ~1 week of local history (2026-07-30 → 2026-08-06).  
2. **No Claude/Cursor transcripts** on disk.  
3. **History + session_jsonl double-count risk** — unique-session counts are safer than raw prompt counts.  
4. **Grok MYPR subagent fan-out** inflates session/workspace counts (`~/.grok/worktrees/.../subagent-*`).  
5. **~60% “unclassified”** under keyword intents until better multi-label + noise strip (auditor improve).  
6. Clustering was **local lexical**; no embeddings (privacy default).  

---

## 3. Proof: top repeatable jobs

Counts are **unique sessions** unless noted. Examples are redacted.

### 3.1 Ship / commit / push — **IMPROVE** `finishAndShip` + `organizedCommits`

| Metric | Value |
|--------|-------|
| Prompts / sessions | **125 / 116** |
| Agents | Codex + Grok |
| Existing skills | `finishAndShip`, `organizedCommits` |
| Named `$finish-and-ship` | **~0** |
| Named `organized-commits` | Occasional |

**Sanitized freeform (repeated):**

- `ok git commit push please.`  
- `please git commit push to main`  
- `ok nice git commit push`  
- `fix please before we git commit push`  

**Why improve, not create:** skills exist; users never name the outer finish loop. Freeform bypasses gates. Failure mode: same-session hybrid (skill then bare git).

**Concrete skill changes**

- Description triggers: `git commit push`, `push to main`, `ship it`, `wrap up and push`  
- Anti-triggers: `no commit`, `NO git commit/add/push`  
- Completion: commit SHA + remote + checks (not “files changed”)  
- Bridge: freeform close-out → `finishAndShip` which owns `organizedCommits`  

---

### 3.2 Full-repo grill + deslop — **IMPROVE** grill/deslop family

| Intent | Sessions | Notes |
|--------|----------|-------|
| `code_style_docs` | **96** | Often names `$grill-me-code-style-with-docs` |
| `deslop` | **53** | Coupled to grill in the same prompt |
| `grill_me_family` | **45** | **Codex-only** named invokes |

**Exact multi-session proof (top cluster):**  
**20 sessions** with the same voice-broken slug:

> I would like you to preform with me `$grill-me-code- style-with-docs` from the begining so we can do a full deslop on this entire repo… ban generic `result`/`payload`/`data`/`raw`…

Also: **16 sessions** pasting the full `grill-me-code-style-with-docs` SKILL body (invocation workaround). Freeform typo **“gridme”** appears.

**Why improve, not create:** capability exists; entry is voice-hostile and skill zoo is confusing.

**Concrete skill changes**

- Short aliases: `$grill`, `$grill-style`, accept `gridme`  
- Freeform: “full deslop”, “0 ai slop”, “ban payload/response/data”  
- Combo path: grill-with-docs → planpage decisions → `deslopV2`  
- Optional later: merge `deslop` + `deslopV2`; keep coach/review as lifecycle peers  

---

### 3.3 Preview / deploy prove — **IMPROVE** triggers only

| Skill | Sessions (intent) | Named `$` hits | Freeform |
|-------|-------------------|----------------|----------|
| `previewAndProve` | ~41 | **0** | launch/relaunch local, playwright QA, e2e ready |
| `deployAndProve` | ~20 | **0** | redeploy/redploy, cf:deploy, curl smoke, multi-site |

**Do not merge** into each other or into finish-and-ship (different authority: commit ≠ prod deploy ≠ local browser).

---

### 3.4 Kill local ports — **CREATE** `killPortsLocalDev`

| Metric | Value |
|--------|-------|
| Prompts / sessions | **11 / 9** |
| Encoding clarity | **Max** (near-identical phrase) |

**Proof phrase:** `kill please all local ports except 8081` / `kill all local ports except metro`.

Deterministic workflow: list listening ports → kill except allowlist (metro/8081) → optional relaunch. Safety: confirm before kill; never silent.

---

### 3.5 Bulk workspace bootstrap — **CREATE** `workspaceBootstrap` (or `bulkGhCloneSync`)

Evidence clusters:

- “duplicate every repo we got on our gh… into the Code folder” (**3+ sessions**)  
- “also duplicate our two org e.g. vybekiit and genshot”  
- Follow-on: bulk `pnpm` install for Code folder (skip npm-only)  
- Pull-all remotes + report deltas  

**Not** `githubRepoMetadata` (About/topics only). High safety: no silent overwrite/rm.

---

### 3.6 Cloudflare ops — **CREATE** `cloudflareOps` (ops-only)

| Metric | Value |
|--------|-------|
| Intent sessions | **~19** |
| Repos | MYPR, Oly, genshot, vybekiit |

Wrangler / D1 / proxy / seed-backup hygiene — distinct from “deploy and prove live”. Keep out of `deployAndProve` body.

---

### 3.7 Monorepo SSOT / identity mappers — **CREATE thin rules skills (P2)** or improve deslop

Highest **structured** MYPR wave (parallel agents, path-sliced briefs):

- Promote shared Zod / kill identity `toX` mappers  
- `contracts.meaningful-mapping`  
- Read-only PASS/FAIL verify slices for multi-agent fan-out  

**Consensus:** encode **portable rules**, not path-locked MYPR mission paste.  
**Do not** create a mega `mypr_product` skill (153 sessions is product spam + subagent inflation).

---

### 3.8 Voice / dufflebag TTS-STT — **LEAVE as product work** (optional doctor later)

| Metric | Value |
|--------|-------|
| Prompts / sessions | **24 / 7** |
| Scope | dufflebag product + cmux hold-control |

Shards wanted a skill; specialists overruled: this is **product debug** (install false-success, hold-control STT dead, TTS says “item”). Fix product + CLI doctor checklist; do **not** skill-ize cmux focus bugs. Optional later: thin `dufflebagDoctor` if install loops continue after product fixes.

---

### 3.9 Docs / web quality / session-ops — **LEAVE** (mostly)

| Area | Verdict | Why |
|------|---------|-----|
| `readmeEditor`, `refreshAgentDocs`, `githubRepoMetadata` | leave | Mature; rare intentional use; intent buckets polluted by “Agents.md rules” tickets |
| `webBestPractices`, `webPerfCi` | leave | “next.js best practices” ≠ a11y/CSP audit — add **negative** triggers only |
| `finishAgentSessions` | leave | True resume volume ~4 sessions; “stale” keyword polluted counts |
| `autorun` | leave | No evidence it caused repeated work |

---

## 4. False positives (do not skill-ize)

From skeptic agent + exact clusters:

| Class | Examples | Why harmful as skills |
|-------|----------|----------------------|
| Acknowledgements | `agreed a/b`, `approved`, `keep going` | No procedure |
| Grill MC answers | `i would say next.js best practices` | Inflates web/style intents |
| Injected harness | `<environment_context>`, full `<skill>` XML (×16), plugin lists | Not user jobs |
| MYPR mission paste | Path-locked multi-agent templates | Project one-offs |
| Error dumps | Metro/pnpm stacks, React max update depth | Debug paste, not workflow |
| Skill-author system dumps | “You are a skill author…” + transcript | Meta tooling noise |

---

## 5. Codex vs Grok (skill packaging)

| Pattern | Codex | Grok |
|---------|-------|------|
| Named `$grill-me-*` | Heavy | Rare |
| Freeform ship/deslop | Both | Both |
| Parallel worktrees / path-sliced briefs | Lower | MYPR-dominant |
| Voice/cmux bring-up | Early install loops | Later STT/TTS CLI productization |

**Improve `syncAgentSkills`:** prove skills are **loadable** on both agents (not copy-only). Folder parity ≠ discovery parity.

---

## 6. Multi-agent fan-out (this audit)

**20 agents** wrote findings under `agent-findings/`:

| Group | Files |
|-------|--------|
| Shard packs | `shards-00-03.md` … `shards-16-19.md` (5) |
| Specialists | finish-ship, grill-deslop, deploy-preview, skill-gaps, docs-meta, mypr-vs-reusable, codex-vs-grok, voice-dufflebag, session-ops, bulk-repo-ops, auditor-meta, priority-rank, false-positives, trigger-phrases, web-quality |
| Consensus | `CONSENSUS.md` |

Shard agents and specialists **agreed** on ship/grill/deslop improve and kill-ports create. They **disagreed** on voice skill (shards create vs specialists leave) — consensus = leave product work, optional doctor later.

---

## 7. Prioritized skill actions (final)

| Rank | Action | Skill | Evidence | Why not alternative |
|-----:|--------|-------|----------|---------------------|
| 1 | **improve** | `finishAndShip` (+ `organizedCommits`) | 125p / 116s; freeform git ship; **0** `$finish-and-ship` | Don’t create a third ship skill |
| 2 | **improve** | `grillMeCodeStyleWithDocs` (+ aliases) | 20 exact sessions + 16 skill pastes + freeform deslop combo | Don’t create mega-grill; keep coach/review separate |
| 3 | **improve** | `deslop` / `deslopV2` | 53s; always coupled to structure/naming bans | Optional merge later; not deslopV3 |
| 4 | **improve** | `agentSessionAuditor` | This run was expensive prose; 60% unclassified; noise clusters | Add scripts + filters; don’t leave |
| 5 | **create** | `killPortsLocalDev` | 9s; identical phrase | Tiny, deterministic, high friction save |
| 6 | **create** | `cloudflareOps` | ~19s; multi-repo CF/D1/wrangler | Not fold into deploy-and-prove only |
| 7 | **create** | `workspaceBootstrap` | GH duplicate + bulk pnpm + pull-all | Not `githubRepoMetadata` |
| 8 | **improve** | `previewAndProve` | ~41s; 0 named; launch/e2e language | Don’t merge with deploy |
| 9 | **improve** | `deployAndProve` | ~20s; redeploy/curl prove | Keep separate from ship |
| 10 | **improve** | `syncAgentSkills` | Codex `$` vs Grok freeform/slash gap | Dual-agent smoke, not more copy |
| 11 | **create (P2)** | `promoteSharedZod` + `meaningfulMappingCleanup` | Strong MYPR wave; portable rules | Not `mypr_product` mega-skill |
| 12 | **leave** | voice/cmux, session-ops, web quality, readme family, autorun | See §3.8–3.9 | Product fix or mature enough |

### Suggested description rewrites (highest ROI)

**finishAndShip** — also match: “git commit push”, “push to main”, “ship it after fix”, “wrap up and push”.  

**previewAndProve** — also match: “launch local”, “relaunch”, “playwright QA”, “e2e ready”, “prove in browser”.  

**deployAndProve** — also match: “redeploy”, “cf:deploy”, “is it live”, “curl smoke”, “multi-site deploy”.  

**deslopV2** — also match: plain “deslop”, “ai slop”, “make it lean”, ban-list language.  

**grillMeCodeStyleWithDocs** — also match: `$grill`, `gridme`, “code-style from the beginning”, “full deslop + structure”.  

Full matrix: `agent-findings/specialist-trigger-phrases.md`.

---

## 8. Artifacts index

```
docs/session-audit-2026-08-06/
  REPORT.md                 ← this file
  coverage-manifest.json
  prompts.jsonl             ← all extracted (redacted)
  clean-prompts.jsonl
  job-like-prompts.jsonl
  intent-refined.json
  exact-clusters.json
  fuzzy-clusters.json
  installed-skills.json
  clean-shard-00.jsonl … 19
  agent-findings/
    CONSENSUS.md
    shards-*.md
    specialist-*.md
```

---

## 9. What “proof” means here

A cluster is a **skill opportunity** only if:

1. **≥2 unique sessions** (preferably ≥5)  
2. **Stable trigger** language (freeform or named)  
3. **Deterministic workflow** (checklist / gates / scripts)  
4. **Not** acknowledgements, injected harness, or project mission paste  

Under that bar:

- **Ship, grill+deslop, kill-ports, CF ops, workspace bootstrap** clear the bar.  
- **MYPR product volume** does not clear the bar as one skill.  
- **Existing skills with zero `$name` hits** clear the bar as **improve triggers**, not create.

---

## 10. Recommended next step

If you want this turned into code next, the highest-ROI sequence is:

1. Patch skill **description triggers** (finish / grill / deslop / preview / deploy) in `src/skills/*/SKILL.md`  
2. Scaffold **`killPortsLocalDev`** skill (tiny)  
3. Scaffold **`workspaceBootstrap`** + **`cloudflareOps`**  
4. Add **auditor scripts** under `agentSessionAuditor/` so the next scan is one command  
5. `sync-agent-skills` + dual-agent smoke  

Say which of those to implement first (or “do 1–3”).
