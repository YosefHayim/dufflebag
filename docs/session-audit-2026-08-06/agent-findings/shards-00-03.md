# Shards 00-03 findings

## Coverage

| Metric | Value |
|--------|-------|
| Shards | `clean-shard-00` … `03` |
| Rows | ~248 total (~60–72/shard) |
| Agents | **codex** (~60%) + **grok** (~40%) |
| Sources | codex `history.jsonl` + `session_jsonl` (often 1:1 dupes); grok `chat_history` |
| Workspaces (sample) | MYPR-App (dominant), Oly-App, genshot, launch-store, yt-caption-mini, Code root |
| Note | Codex history/session pairs inflate counts; frequencies below use **unique-ish prompts** after de-dupe |

Installed skills used for gap analysis: `finishAndShip`, `organizedCommits`, `deslop`/`deslopV2`, `grillMe*`, `previewAndProve`, `deployAndProve`, `webBestPractices`, `refreshAgentDocs`, `reuseFirstAudit`, `rtlUiAudit`, `captureWorkflow`, `syncAgentSkills`, etc.

## Top reusable jobs (ranked)

### 1. SSOT contracts collapse (identity mappers + alias ban)
- **Freq (shards):** ~18–25 prompts; multi-session wave of scoped feature folders
- **Agents:** grok (primary), codex (style bans that feed it)
- **Examples:**
  - `Remove redundant identity/DTO mappers… ONLY paths client/src/features/membership/** …`
  - `fix no backward comapiblities export type { … } … spawn 20 agents`
- **Confidence:** high
- **Skill action:** **improve** `deslop`/`deslopV2` (+ optional **merge** with grill code-style “no identity mapper / no Old=New alias” rules). Not MYPR-only: workflow is path-scoped SSOT cleanup + report.

### 2. Code-style / anti-slop gate (grill turns)
- **Freq:** ~15–20 short decision turns + full deslop lists
- **Agents:** codex (grill dialogue), grok (apply)
- **Examples:**
  - `avoid and ban resolve, build, toMap data,response,result,body,payload`
  - `avoid comments… code should be readable by proper naming`
- **Confidence:** high
- **Skill action:** **improve** `grillMeCodeStyle*` / `deslopV2` (auto-trigger on ban lists, `??`/`isRecord`, comment policy). Family already large — **merge** coach/review variants if docs diverge.

### 3. Single-ticket ship (AF-style one item, commit no push)
- **Freq:** ~8–10 templated subagent tasks
- **Agents:** grok subagents
- **Examples:**
  - `Fix ONE item: **AF-07 — Login CTAs…** … Do NOT push. Report summary, files, SHA`
  - `Fix ONE item: **AF-27 — Message-to-journalist field clarity** …`
- **Confidence:** high (pattern); content is product backlog
- **Skill action:** **create** `singleTicketShip` (acceptance + scope lock + conventional commit + no-push + verify) **or improve** `finishAndShip` with a “one finding only” mode. Encode the *template*, not AF IDs.

### 4. Read-only audit / PASS-FAIL inventory
- **Freq:** ~10–15
- **Agents:** grok
- **Examples:**
  - `Read-only audit… identity drift… max 15 items… Do NOT edit`
  - `run typecheck for the shared package… Return PASS/FAIL`
- **Confidence:** high
- **Skill action:** **improve** `reuseFirstAudit` (or **create** thin `passFailAudit`) for grep/typecheck/i18n parity checklists. Distinct from implement-then-prove.

### 5. Commit → push → ship / organized commits
- **Freq:** ~5–8 unique (higher if counting session dupes)
- **Agents:** codex (+ ship variants on grok)
- **Examples:**
  - `ok git commit push please.` / `please git commit push to main`
  - `do [$organized-commits] then push and ship (redploy)`
- **Confidence:** high
- **Skill action:** **improve** `finishAndShip` + `organizedCommits` (freeform “git commit push” rarely names the skill).

### 6. Local e2e / Playwright prove
- **Freq:** ~4–6
- **Agents:** grok
- **Examples:**
  - `spawn sub agents… run e2e verify works properly via local`
  - `Extend or create Playwright e2e… adminUrlEntityPaths.spec.ts`
- **Confidence:** med–high
- **Skill action:** **improve** `previewAndProve` (spawn-per-suite, seed specs, checklist docs).

### 7. Multi-target deploy / release prove
- **Freq:** ~3–5
- **Agents:** grok
- **Examples:**
  - `spawn sub agents to deploy each service… genshot.dev, vybekiit.com…`
  - `ok do new build and release new version to testflight`
- **Confidence:** med
- **Skill action:** **improve** `deployAndProve` (multi-domain fan-out + artifact confirm).

### 8. Kill ports / local dev reset
- **Freq:** ~2–3 in these shards (corpus-wide higher per `intent-refined`)
- **Agents:** codex, grok
- **Examples:**
  - `kill all local ports running`
  - `kill please all local ports except 8081`
- **Confidence:** high (phrase stable)
- **Skill action:** **create** `killLocalPorts` (preserve metro/8081 by default).

### 9. Framework best-practices lean (Next / Effect)
- **Freq:** ~4–6
- **Agents:** codex
- **Examples:**
  - `repo with just widget and fully next.js. best practices`
  - `follow the best practices of effect. and make it lean`
- **Confidence:** med
- **Skill action:** **improve** `webBestPractices` (Effect schema SSOT, unified route error wrapper, no package.json for CLIs already on PATH).

### 10. URL-as-state / deep-link platform roll-out
- **Freq:** ~8 (MYPR-heavy)
- **Agents:** grok
- **Examples:**
  - `Wire Admin WhatsApp workspace URL state using… useUrlQueryState`
  - `Read-only scan… admin detail MODALS… without reflecting entity id in URL`
- **Confidence:** med (reusable SPA job; current volume is one product)
- **Skill action:** **leave** until seen outside MYPR, **or create** only if other shards show same pattern multi-repo.

### 11. Transcript / scrape → agent skill authoring
- **Freq:** ~2–3 (+ yt-caption CLI work)
- **Agents:** codex
- **Examples:**
  - System prompt: transcript → “reusable, minimal skill-style implementation”
  - `…scrape… generate… skill… agent=grok/codex…`
- **Confidence:** med
- **Skill action:** **improve** `captureWorkflow` / `syncAgentSkills` (pipeline: scrape → skill.md + metrics).

## Skill recommendations

| Priority | Action | Target | Why (shards 00–03) |
|----------|--------|--------|--------------------|
| P0 | improve | `deslopV2` + grill code-style | Largest real workstream: SSOT, mapper purge, alias ban, naming bans |
| P0 | improve | `finishAndShip` / `organizedCommits` | Freeform “git commit push” + one-ticket SHA report never auto-trigger |
| P1 | create | `singleTicketShip` | Repeated AF-template is a general backlog executor |
| P1 | create | `killLocalPorts` | Tiny, high-clarity, zero product coupling |
| P1 | improve | `reuseFirstAudit` | Many “Do NOT edit / PASS-FAIL” audits |
| P2 | improve | `previewAndProve`, `deployAndProve` | e2e fan-out + multi-domain / TestFlight |
| P2 | improve | `webBestPractices` | Next/Effect lean refactors mid-session |
| — | leave | `rtlUiAudit`, `writeAPost`, `planpage` | Weak/absent signal in these shards |
| — | leave | pure Oly pose / one-off analytics phases | Product facts, not portable jobs |

## Noise / non-skills

- Smoke / harness: `Say only hi`, `Reply with only: effort-low|high`
- Chat crumbs: `try now.`, `agreed with b`, `approve all`, `i would say`, `check now`
- Codex **history+session_jsonl double-count** of the same utterance
- MYPR-only one-off feature builds (Firebase Phase 2, beat renames, single AF semantics) unless templated as job #3
- Oly black-mirror / detector product debugging (unless generalized to “customer-feedback QA vs docx”)
- Pasted secrets / env tokens (ops, not skill content)
- `/statusline` TUI cosmetics

## Limitations

- Only **20%** of clean shards; ranks may shift when 04–19 land.
- Codex dual sources inflate raw row counts; job freqs are approximate.
- Heavy MYPR subagent volume can look like “jobs” when they are fan-out of one parent plan.
- No Claude/Cursor stores in coverage manifest.
- Intent-refined global counts used only as cross-check, not as primary evidence.
