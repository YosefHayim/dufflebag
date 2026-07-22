# Repeated Workflow Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add twelve evidence-backed workflow skills plus the missing `organized-commits` source, ship them through Dufflebag's catalog, and synchronize them globally to every detected agent.

**Architecture:** Each workflow is a pure skill in a camelCase directory under `src/skills/`; each public kebab-case ID is a catalog feature with an exact shipped-path allowlist. `organized-commits` becomes canonical source and is reused as a dependency by the broader shipping and worktree skills. No new runtime hooks or package dependencies are introduced.

**Tech Stack:** Markdown Agent Skills, TypeScript catalog data, Effect Schema validation, Vitest, Dufflebag's existing installer and provider adapters.

## Global Constraints

- Canonical authored source lives under `src/skills/<sourceDirectory>/`; generated provider projections are not source.
- Frontmatter names and public IDs use kebab-case; authored directories use camelCase.
- Descriptions begin with `Use when` and state trigger conditions with searchable user language.
- Each skill contains explicit safety, evidence, and verification gates; transcript auditing remains read-only and local by default.
- Every shipped path is declared in `src/catalog/featureCatalog.ts`.
- `pnpm verify` must pass before commit and push.
- Global synchronization runs only after the pushed source commit and uses receipt-backed Dufflebag installation.

---

### Task 1: Lock catalog and skill quality expectations

**Files:**
- Modify: `src/catalog/featureCatalog.test.ts`
- Modify: `src/skills/skills.test.ts`

**Interfaces:**
- Consumes: existing `featureCatalog`, `installedSkillsFor`, and frontmatter parser.
- Produces: failing expectations for thirteen canonical skills, exact shipped paths, trigger descriptions, workflow, and verification sections.

- [ ] Add the thirteen public IDs and camelCase source directories to the catalog fixtures.
- [ ] Add exact `SKILL.md` allowlists, plus `REFERENCE.md` for `organized-commits`.
- [ ] Add focused assertions that the new descriptions start with `Use when` and each body contains safety/workflow/verification guidance.
- [ ] Run `pnpm vitest run src/catalog/featureCatalog.test.ts src/skills/skills.test.ts` and confirm it fails because the catalog/source entries do not exist yet.

### Task 2: Canonicalize organized commits

**Files:**
- Create: `src/skills/organizedCommits/SKILL.md`
- Create: `src/skills/organizedCommits/REFERENCE.md`
- Modify: `src/catalog/featureCatalog.ts`

**Interfaces:**
- Consumes: the proven local `organized-commits` workflow currently present only in a generated provider directory.
- Produces: installable feature `organized-commits` with atomic commit, push, branch, and worktree safety rules.

- [ ] Move the complete workflow and reference into canonical source.
- [ ] Add its pure-skill catalog entry with shipped paths `SKILL.md` and `REFERENCE.md`.
- [ ] Run the focused catalog/skill tests and fix only organized-commits failures.

### Task 3: Add completion and delivery skills

**Files:**
- Create: `src/skills/finishAndShip/SKILL.md`
- Create: `src/skills/deployAndProve/SKILL.md`
- Create: `src/skills/coordinateWorktrees/SKILL.md`
- Modify: `src/catalog/featureCatalog.ts`

**Interfaces:**
- Consumes: repository instructions, verification commands, Git state, deployment provider surfaces, and `organized-commits` where installed.
- Produces: `finish-and-ship`, `deploy-and-prove`, and `coordinate-worktrees`; the first and third depend on `organized-commits`.

- [ ] Encode scope inventory, fresh verification, atomic history, remote confirmation, and clean handoff in `finish-and-ship`.
- [ ] Encode source/deployed identity, provider monitoring, live readback, smoke behavior, and rollback evidence in `deploy-and-prove`.
- [ ] Encode writer coordination, worktree inventory, backups, patch-ID overlap checks, staged integration, reachability proof, and non-destructive cleanup in `coordinate-worktrees`.
- [ ] Add catalog entries and run the focused tests after each skill.

### Task 4: Add product and repository proof skills

**Files:**
- Create: `src/skills/previewAndProve/SKILL.md`
- Create: `src/skills/reuseFirstAudit/SKILL.md`
- Create: `src/skills/envConfigContract/SKILL.md`
- Create: `src/skills/rtlUiAudit/SKILL.md`
- Modify: `src/catalog/featureCatalog.ts`

**Interfaces:**
- Consumes: real local app behavior, repository searches, official ecosystem sources, environment reads, and locale-specific UI evidence.
- Produces: four portable workflow skills with explicit proof artifacts and stop conditions.

- [ ] Write browser-visible proof, safe test-data, console/network, persistence, and screenshot rules for `preview-and-prove`.
- [ ] Write internal-first search, compatibility/license/security comparison, and build-versus-reuse decision evidence for `reuse-first-audit`.
- [ ] Write complete environment inventory, one schema boundary, server/client separation, secret redaction, migration, and invalid-input tests for `env-config-contract`.
- [ ] Write locale activation, logical CSS, bidi isolation, directional asset, keyboard order, responsive viewport, and screenshot verification for `rtl-ui-audit`.
- [ ] Add catalog entries and run the focused tests after each skill.

### Task 5: Add agent-operations skills

**Files:**
- Create: `src/skills/agentSessionAuditor/SKILL.md`
- Create: `src/skills/syncAgentSkills/SKILL.md`
- Create: `src/skills/mcpOauthOnboarding/SKILL.md`
- Modify: `src/catalog/featureCatalog.ts`

**Interfaces:**
- Consumes: discoverable local session stores, Dufflebag source/receipts/provider formats, and official MCP CLI configuration/authentication surfaces.
- Produces: privacy-safe prompt clustering, receipt-backed cross-agent synchronization, and user-scope MCP OAuth verification workflows.

- [ ] Write a read-only coverage manifest, user-prompt-only extraction, local redaction, fuzzy clustering, confidence, and prioritization contract for `agent-session-auditor`.
- [ ] Write canonical-source checks, additive feature preservation, detected provider planning, native-format parity, doctor, and provider smoke checks for `sync-agent-skills`.
- [ ] Write existing-config inspection, explicit user scope, browser-consent boundary, authenticated-status check, harmless tool call, and restart guidance for `mcp-oauth-onboarding`.
- [ ] Add catalog entries and run the focused tests after each skill.

### Task 6: Capture and recover cross-session work

**Files:**
- Create: `src/skills/captureWorkflow/SKILL.md`
- Create: `src/skills/finishAgentSessions/SKILL.md`
- Modify: `src/catalog/featureCatalog.ts`

**Interfaces:**
- Consumes: a recently completed workflow, local agent session evidence, current repository state, `agent-session-auditor`, and `finish-and-ship`.
- Produces: a repeatable workflow-capture skill and a safe cross-agent unfinished-session recovery skill.

- [ ] Write stable-versus-variable extraction, smallest reusable asset selection, clean-state replay, negative-path testing, and side-effect gates for `capture-workflow`.
- [ ] Write cross-agent coverage, incomplete-intent classification, stale/duplicate rejection, repository-state reconciliation, safe ownership, resume, and completion proof for `finish-agent-sessions`.
- [ ] Add catalog entries, dependencies, and run focused tests after each skill.

### Task 7: Evaluate and verify the complete bag

**Files:**
- Modify only when an evaluation exposes a concrete omission in one of the thirteen skill files.

**Interfaces:**
- Consumes: the recorded baseline scenarios and the authored skills.
- Produces: green evaluations showing the skills close the baseline gaps.

- [ ] Re-run the same scenario families with fresh agents explicitly using the relevant new skills.
- [ ] Compare outputs against baseline omissions and refine only demonstrated gaps.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm verify` and retain the fresh result.

### Task 8: Commit, push, and synchronize globally

**Files:**
- Generated: `README.md` if the pre-commit hook refreshes the catalog table.
- Global receipt-backed provider artifacts outside the repository after push.

**Interfaces:**
- Consumes: a verified working tree and the Dufflebag CLI built from the pushed commit.
- Produces: reviewable Git history on `origin/main`, globally installed skills for every detected provider, and doctor/parity evidence.

- [ ] Inspect the full diff and split documentation/catalog/test changes only where they represent independently reviewable intent.
- [ ] Commit with why/what/impact bodies, inspect the index and regenerated README, and re-run affected verification if the hook changes source.
- [ ] Push `main` and confirm local/remote SHA parity.
- [ ] Read the existing global receipt, preserve its feature set, add the thirteen canonical skills, and run the non-interactive global install using detected agents.
- [ ] Run global doctor plus native destination/parity checks; report detected, installed, skipped, and unsupported providers without claiming unsupported Grok integration.
