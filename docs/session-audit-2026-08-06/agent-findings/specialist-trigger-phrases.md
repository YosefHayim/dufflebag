# Specialist trigger-phrase matrix (session-audit 2026-08-06)

Sources: `job-like-prompts.jsonl`, `intent-refined.json`, SKILL.md frontmatter under `src/skills/`.  
Goal: description rewrites so freeform language auto-routes without `$skill` / path links.

## Priority intents (prompt_count)

| Intent | n | Skills | Recommendation |
|--------|---|--------|----------------|
| finish_ship_commit_push | 125 | finishAndShip, organizedCommits | improve triggers + boundary |
| code_style_docs | 98 | grillMeCodeStyleWithDocs (+ family) | freeform triggers beyond `$` |
| deslop | 53 | deslopV2, deslop | capture plain “deslop” / AI-slop |
| preview_and_prove | 49 | previewAndProve | local launch / playwright / e2e |
| grill_me_family | 45 | grill* | fold into code-style rewrite |
| readme_agent_docs | 34 | readmeEditor | noisy bucket; narrow triggers |
| deploy_and_prove | 23 | deployAndProve | redploy / multi-domain / prove live |

---

## Matrix: seen freeform vs current description triggers

### 1. finishAndShip
**Current:** finish, ship, wrap up, commit and push, handoff, nothing unfinished.  
**Seen (dominant):** `please git commit push to main` · `ok git commit push please` · `nice now please git commit push` · `ok nice git commit push` · `fix please before we git commit push` · `git commit push all unerleated locals chanes please` · `after finish all what i said please…` · `push and ship (redploy)` (also deploy).  
**Gap:** Telegram-style “git commit push [to main]” never says “finish/wrap up”; bare “ship” often means product, not close-the-loop.

**Rewrite (1–2 sentences):**  
Use when the user wants the completed work closed out end-to-end: `git commit push`, push to main, wrap up after fixes, finish what was asked, or ship the local change set with verify + handoff. Prefer this over bare commit-only when they imply gates, leftovers, or “done after finish all”; hand pure commit-splitting to organized-commits; hand redeploy/live prove to deploy-and-prove.

### 2. organizedCommits
**Current:** commit, push, ship, organize commits, clean history, worktrees/salvage.  
**Seen:** `$organized-commits then push` · `/organized-commits and push to main` · explicit skill path links; freeform still mostly “git commit push…”.  
**Gap:** Overlaps finishAndShip on “commit/push/ship”; freeform rarely says “organize”.

**Rewrite:**  
Use when the user asks to organize commits, split/group by intent, conventional messages, clean up history/worktrees, or runs `$organized-commits` / `/organized-commits` (often then push). For one-shot “git commit push” without split/history talk, still run; if they want full verify+handoff+no leftovers, also apply finish-and-ship.

### 3. deployAndProve
**Current:** deploy, publish, release, promote, confirm latest is live.  
**Seen:** `push and ship (redploy)` · `before we redploy and sync` · `spawn sub agents to deploy each service…` · `Redeploy vybekiit landing… Prove: curl…` · `e2e production ready?` · `production demo not load` · `production ready… confirm the webhook worked` · **negation** `do not deploy. run local…`.  
**Gap:** “redploy” typo; multi-domain CF workers; “promote” false-fires on “promote schemas to shared”.

**Rewrite:**  
Use when the user asks to deploy, redeploy/redploy, publish a worker/site/service, or prove production/live (curl smoke, webhook, e2e production ready, multi-domain deploy). Do not use for “do not deploy / run local”, or for “promote” meaning lift types/schemas into a shared package.

### 4. previewAndProve
**Current:** launch, preview, QA, verify browser-visible flows (checkout, auth…).  
**Seen:** `qa fix via playwright…` · `did u do some tests to verify it? e.g. launch` · `launch local via tunnel… test e2e` · `do not deploy. run local i review` · `u checked it works proper…` · `confirm… verify it works e2e` · `launch local`.  
**Gap:** “preview” rare; “launch local”, playwright, e2e, “works proper” dominate.

**Rewrite:**  
Use when the user wants a real local/UI proof: launch local, run local, QA via playwright, e2e in browser/app, tunnel for test mode, or “did you verify/check it works” on a visible flow—not production deploy. Prefer this over deploy-and-prove when they say run local / do not deploy.

### 5. deslopV2
**Current:** deslop-v2, over-engineered, too much abstraction, simplify, flatten, kill ceremony, tool slop, `??`/wrappers/nesting…  
**Seen:** `huge deslop on the entire cord base` · `0 ai slop and 100% desloped` · `make it lean` · `ai slop` · `look for other stale files… safely deleted` · `do we over engineering here?` · `avoid/ban resolve, build, toMap, payload…` · `avoid ?? or ternary` · `no isRecord asString… ai slop` · single-use file delete.  
**Gap:** User says plain **deslop** / **AI slop**, not “deslop-v2”; often stacked with grill.

**Rewrite:**  
Use when the user wants a lean/deslop pass on structure or ceremony: deslop, full deslop, 0 AI slop, make it lean, over-engineering, kill wrappers/scripts/typegen, ban generic names (`payload`/`result`/`isRecord`/`resolve*`), avoid `??`/nested ternaries, delete stale/single-use files. After a grill locks `## Never`, apply this skill; if they want style docs from scratch, prefer grill-me-code-style-with-docs first.

### 6. grillMeCodeStyleWithDocs
**Current:** defining/updating style, structure, CLI conventions on an existing codebase (not empty).  
**Seen:** `$grill-me-code-style-with-docs` (many) · typo **gridme** · `full deslop on this entire repo… structure libraries deps` · `proper cleanup and $grill… following order code-style.md` · `make it leaner and thigtehn $grill…` · `add code-style.md` · `violates the code-style.md` · filename conventions + ban generic names.  
**Gap:** Freeform often omits “conventions”; leads with deslop/cleanup/lean + CODE-STYLE.md.

**Rewrite:**  
Use when the user wants an interactive style/structure grill on an existing repo: grill-me-code-style-with-docs, gridme, rebuild CODE-STYLE.md / structure docs, proper cleanup with conventions/filenames, or full-repo deslop that starts by deciding style (generic-name bans, deps, CLI). Prefer grill-me-code-style only for greenfield; after guide exists, mass kill of wrappers/ceremony → deslop-v2.

### 7. readmeEditor
**Current:** create/edit README, AGENTS.md, CLAUDE.md, copilot-instructions, llms.txt, landing/onboarding docs.  
**Seen (true docs jobs rare):** `agent.md is the ssot root for our agents` · write docs/`agent.md` per agent · create e2e/native README · TECH.md. Intent bucket polluted by “Rules: Agents.md, CODE-STYLE.md” on product fixes.  
**Gap:** Mentions of Agents.md as **rules to follow** must not route here.

**Rewrite:**  
Use when the user wants to create, rewrite, audit, or polish landing docs: README, AGENTS.md / agent.md as SSOT, CLAUDE.md, copilot-instructions, llms.txt, or project onboarding docs. Do not use merely because a task lists “Rules: Agents.md” or CODE-STYLE compliance.

---

## Cross-skill routing rules (from freeform)

| Freeform cluster | Prefer |
|------------------|--------|
| `git commit push` / `push to main` | finishAndShip (+ organizedCommits if split/history) |
| `$organized-commits` then push/redeploy | organizedCommits → deploy if redeploy |
| `redploy` / multi-domain deploy / production smoke | deployAndProve |
| `launch local` / playwright QA / e2e local | previewAndProve |
| `deslop` / AI slop / lean / ban resolve·payload | deslopV2 (grill first if no CODE-STYLE) |
| `$grill…` / gridme / write CODE-STYLE.md | grillMeCodeStyleWithDocs |
| Write/edit README or agent SSOT docs | readmeEditor |

## Highest-impact description edits (order)

1. **finishAndShip** — add exact “git commit push [to main]” language.  
2. **previewAndProve** — add launch local / playwright / e2e / run local.  
3. **deployAndProve** — add redploy/redeploy + exclude schema “promote” + respect “do not deploy”.  
4. **deslopV2** — lead with plain deslop / AI slop / make it lean.  
5. **grillMeCodeStyleWithDocs** — add gridme, full-repo deslop-for-style, CODE-STYLE.md rebuild.  
6. **organizedCommits** — de-emphasize bare “ship”; keep $ invocation.  
7. **readmeEditor** — exclude “Rules: Agents.md” product tasks.
