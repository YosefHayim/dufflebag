# MYPR product spam vs reusable workflows

Sources: `intent-refined.json` (`mypr_product` = 158 prompts / 153 sessions) + MYPR-heavy rows in `job-like-prompts.jsonl` (workspace `MYPR-App` / `code-mypr-app/*` worktrees).

**Rule:** do not create a `mypr*` skill. Product one-shots stay in-repo; only cross-repo jobs get skills.

---

## 1) MYPR-only — do NOT create skills

| Item | Why leave |
|------|-----------|
| **AF-\* Arik feedback tickets** (AF-14 carousel, AF-24 WhatsApp help, AF-27 journalist field, AF-28 popup types, AF-29 dual AI docs, AF-30 managers gap, …) | One backlog doc (`docs/arik-feedback-v2.md`); acceptance + commit msgs are product-specific. Volume is parallel ticket spam, not a reusable job. |
| **Customer PDF / Gmail Hebrew notes triage** | One customer artifact; read-PDF-then-plan is freeform, not a skill. |
| **Notifications settings + jump messages / in-app popups e2e “prove all 60”** | MYPR product surfaces + demo admin/user roles; use existing `previewAndProve` / `deployAndProve` freeform. |
| **Native Firebase / GA4 Phase 2, Amplitude consent wiring** | One analytics plan phase; paths and “do not” list are app-specific. |
| **Play Console certs, SHA, AAB → Downloads, manual upload then API check** | Store release ops for this app; not a dufflebag skill. |
| **R2 assets hash uniqueness, LemonSqueezy catalog, WhatsApp Meta ops UI** | Infrastructure/product domains owned by MYPR. |
| **Admin Users analytics chart drilldown, pitch wizard features, blog cover, dual AI architecture** | Feature implementation tickets. |
| **npm vs pnpm “project configured to use npm” launch failures** | One-off package-manager mismatch; not a stable workflow. |
| **Play Store screenshot script dimensions** | One marketing asset job. |
| **Maestro native scripts / CORE_MATRIX for MYPR only** | Scaffolding is useful, but the owned paths + package scripts are repo-local; no second consumer yet. |
| **Whole-bucket `mypr_product` → create** (intent-refined) | **Reject.** High count is product + parallel subagents, not missing skill. |

---

## 2) Workflows that appeared inside MYPR but generalize

| Workflow | Signal in MYPR | Action |
|----------|----------------|--------|
| **Identity / meaningful-mapping cleanup** | Many path-sliced missions: delete `toX` field-for-field DTO clones; keep Date→ms, redaction, real UI transforms; update `IDENTITY_MAPPERS.md` | **CREATE** skill (e.g. `meaningfulMappingCleanup`). Rule: mappers must rename/redact/validate/transform — not copy. |
| **Shared Zod promotion (contracts.shared-zod)** | Waves: promote wire schemas + const/z.enum to `@pkg/shared/*`; client `z.infer`; domain `Date` stays server; `timestamp()` on wire | **CREATE** skill (e.g. `promoteSharedZod`). Applies to any client/server/shared monorepo. |
| **Compat alias / barrel deletion + consumer rewire** | Delete `@/api` barrels and `export type Old = New` shims; keep intentional HTTP op names (`GetXResponse`); fix imports to models/contracts/shared; typecheck gate | **CREATE** small skill or **improve** `deslopV2` with explicit “no barrels / no compat renames / SSOT imports” checklist. Prefer improve if deslop already owns structure cleanup. |
| **Prop-drill / god-screen reduction** | Parallel jobs: admin editors, chat thread, pitch wizard — feature-local microstore/context, **not** global Zustand | **CREATE** skill (e.g. `reducePropDrilling`) with house defaults: screen-scoped store, draft object + actions. |
| **Path-sliced monorepo cleanup orchestration** | Parent assigns exclusive globs (`server/src/billing/**` only), report format (kept/removed), no-commit | **CREATE** thin orchestrator skill or doc in `captureWorkflow` / worktree coord: exclusive paths + verify subagent. Not MYPR-specific. |
| **Verify-only PASS/FAIL audit subagent** | “DELETED must not exist… Return PASS/FAIL with evidence” after barrel/mapper waves | **CREATE** or fold into orchestrator as “verifier” role (read-only, evidence quotes). |
| **Admin URL-state / deep-link filter Playwright matrix** | Journalists + users filter specs: deep link ↔ UI ↔ reload modal | **IMPROVE** `previewAndProve` (or small e2e-matrix recipe): URL param matrix + session inject helpers — pattern, not MYPR paths. |
| **Single-item feedback fix loop** | Template: Fix ONE AF-N, rules refs, commit message, do not push, report SHA | **IMPROVE** `captureWorkflow` / optional recipe — tracker-agnostic “one backlog item, no scope creep.” Do **not** encode AF-* or arik-feedback. |
| **Kill local ports (except metro)** | Appears with MYPR + genshot | **CREATE** tiny `killPortsLocalDev` if not covered elsewhere (already flagged create in intent-refined). |
| **Finish/ship, deslop, grill, deploy/prove** | Heavy use *from* MYPR workspaces | **IMPROVE** triggers only — skills exist; MYPR volume is usage, not new product skill. |

---

## Priority (if building next)

1. **CREATE** `meaningfulMappingCleanup` + `promoteSharedZod` (highest MYPR repetition, clear SSOT rules).  
2. **CREATE** `reducePropDrilling` (repeated parallel screens).  
3. **IMPROVE** `deslopV2` (barrels/compat) and/or thin path-sliced orchestrator + verifier.  
4. **IMPROVE** `previewAndProve` for URL filter matrices.  
5. **Never** skill-ize AF-\*, Play upload, analytics phases, or “mypr product.”

---

## Bottom line

`mypr_product` is **product spam + cleanup waves mis-bucketed as one intent**. Split: leave product tickets; extract mapping/shared-zod/prop-drill/barrel-orchestrator jobs that Oly, launch-store, vybekiit, etc. can reuse.
