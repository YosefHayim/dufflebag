# Specialist: deploy-and-prove + preview-and-prove

## Corpus snapshot (`intent-refined.json`)

| Intent | prompts | sessions | existing skill | refined rec |
|--------|--------:|---------:|----------------|-------------|
| `preview_and_prove` | 49 | 41 | `previewAndProve` | improve |
| `deploy_and_prove` | 23 | 20 | `deployAndProve` | improve |
| `finish_ship_commit_push` (context) | 125 | 116 | `finishAndShip`, `organizedCommits` | improve |

Skills installed; high freeform volume despite good SKILL bodies.

## Named vs freeform

**Named invocations of either skill: 0** across audit files (`$deploy-and-prove`, `$preview-and-prove`, `deployAndProve`, `previewAndProve` SKILL links). Contrast: users routinely name `$grill-me-code-style-with-docs` and `$organized-commits`.

**All real demand is freeform.** Agents never get the skill by slash/name; only by description match (which is failing for user phrasing).

### Freeform deploy patterns (true + near)

- Multi-site: “spawn sub agents to **deploy** each service… genshot.dev, vybekiit.com…”
- CF prove loop: “**Redeploy** … `pnpm cf:deploy` … **Prove:** curl -sI … worker name, version ID, smoke”
- Ship chain: “$organized-commits then push and ship (**redploy**)”
- Gate-before: “before we **redploy** and sync… launch local”
- Prod bug: “**production demo** not load… Minified React error #185”
- Prod readiness: “production ready… confirm the webhook worked”
- Negative: “**do not deploy**. run local i review and confirm all.”

### Freeform preview / local-prove patterns

- “**launch local** please server and web” / “**relaunch local** i dont see it running”
- “**launch local via tunnel** so we can test e2e in test mode”
- “now do **qa fix via playwright** on why the colors ui ux on web…”
- “confirm if we actually verify it works **e2e production ready**”
- Orchestrator briefs: “e2e: …”, “verify e2e”, Playwright/Maestro authoring (often mis-bucketed)

### Bucket noise (do not optimize skills for these)

- Playwright **spec authoring / flake cleanup** (`waitForTimeout`, `force:true`) — tooling, not browser prove
- UI “preview” props/modals, recipient **preview** product features
- Transcript noise (“typically **deployed**” ML models)
- “Do NOT deploy” read-only probes

Rough true-job share after noise: ~half of each refined bucket; still enough for **improve**, not leave.

## Skill design vs usage

Both skills already encode the right “prove, don’t claim” loop and safety:

- **deploy-and-prove**: intended vs served identity, provider terminal state, independent readback, production smoke.
- **preview-and-prove**: real browser surface, durable outcome, console/network, no mock-as-proof.

Gap is **description/trigger surface**, not workflow quality. Frontmatter descriptions use formal verbs (deploy/publish/release/promote; launch/preview/QA) but users say: *redeploy, redploy, cf:deploy, production demo, is live, smoke statuses, launch local, relaunch, tunnel, playwright qa, e2e production ready*.

`finishAndShip` already **composes** both (workflow step 4: preview for UI; deploy only when authorized). That composition matches real chains: commits → push → ship (redeploy) / launch local first.

## Merge with finish-and-ship?

| Option | Verdict |
|--------|---------|
| **Full merge** into `finishAndShip` | **No.** Different authority (git push vs external deploy), different prove surfaces, and explicit “do not deploy / run local” must not collapse into ship. |
| **Keep separate + wire composition** | **Yes.** Finish stays orchestrator; optional handoff to preview or deploy when user language includes those prove modes. |
| **Merge deploy+preview into one skill** | **No.** Local browser vs production provider are different safety classes. |

## Recommendations

### 1. `previewAndProve` — **improve triggers** (primary)

Expand `description` freeform phrases: *launch local, relaunch, run local, tunnel for e2e, QA via playwright (against running app), verify in browser/UI, e2e production ready (behavior, not write tests)*.

Clarify **not for**: authoring Playwright/Maestro suites, deslop of e2e helpers, product “preview” UI.

Optional body note: “launch local / relaunch” is in-scope when the goal is to exercise a user-visible flow, not only “preview” as marketing word.

### 2. `deployAndProve` — **improve triggers** (primary)

Add: *redeploy/redploy, cf:deploy / wrangler deploy, production ready with prove, is live, worker/version ID, curl smoke, multi-domain deploy fan-out*.

Add **anti-triggers**: *do not deploy, run local only, read-only probe* → prefer `previewAndProve` / no deploy.

### 3. `finishAndShip` — **light improve, not merge**

When user says *ship (redeploy)* / *push and ship and redeploy*, require explicit handoff: organized commits + push, then `deploy-and-prove` if authorized.

When *ship* + *launch local first* / *do not deploy*, hand off to `preview-and-prove` only.

Keep: “commit and push does **not** authorize deploy.”

### 4. Leave skill internals

Workflows and verification checklists are solid. No merge, no rewrite of prove steps. Priority is **auto-trigger match** to freeform speech.

## Bottom line

| Skill | Named use | Freeform use | Action |
|-------|-----------|--------------|--------|
| `previewAndProve` | none | high (launch local, QA browser, e2e-ready) | **improve triggers** |
| `deployAndProve` | none | medium (redeploy, CF prove, multi-site) | **improve triggers** |
| Merge into `finishAndShip` | — | chains often | **leave separate**; strengthen composition only |
