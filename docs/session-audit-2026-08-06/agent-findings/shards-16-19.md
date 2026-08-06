# Shards 16–19 — Reusable jobs

## Coverage

| Shard | ~rows | Agents | Dominant workspaces |
|-------|------:|--------|---------------------|
| 16 | ~44 | codex + grok | MYPR-App, launch-store, Code, the-ascendars |
| 17 | ~83 | codex + grok | MYPR-App, vybekiit, Oly-App, ebay-mcp, YosefHayim |
| 18 | ~54 | codex + grok | MYPR-App, Oly-App, ebay-mcp, Code |
| 19 | ~80 | codex + grok | MYPR-App, Oly-App, vybekiit recovery worktree, the-ascendars |

**~260 lines total** (history.jsonl ↔ session_jsonl duplicates inflate counts). Unique user intents much lower after dedupe. Heavy multi-agent subagent tasking on MYPR (path-scoped missions, PASS/FAIL verify, AF-* one-item fixes).

## Top reusable jobs

Ranked by cross-session reuse potential (not raw volume). Project one-offs penalized.

1. **Code-style grill + deslop + ban generics**  
   Explicit `$grill-me-code-style-with-docs`, full-repo deslop, ban `payload|result|data|raw|body`, ban `??`/`||`, no prop→useState default, no nested ternary, no barrels, schema-over-interfaces. Parallel rename slices: server / client platform / scripts+infra.  
   *Evidence:* s17 grill start; s17–19 rename-banned-bindings; s18 naming/early-return; s19 “0 ai slop” structure.

2. **PASS/FAIL read-only verify slice**  
   Template: search paths → assert SSOT/exhaustive maps/no stale strings → **PASS/FAIL** → **Do NOT edit**. Beats (15→25), icons, i18n keys, barrel deletes, e2e hardcodes. Ideal multi-agent fan-out.  
   *Evidence:* many s16/s18/s19 grok verify prompts.

3. **Ship: organized commits + push + local prove**  
   `/organized-commits`, “push to remote”, “commit snapshot”, “do not deploy — run local”, “launch local via tunnel”, CF deploy + curl prove, TestFlight rebuild/upload.  
   *Evidence:* s16–19 ship phrases; s17 redeploy vybekiit-com; s16 TestFlight + AuthKey.

4. **Kill ports / relaunch local**  
   “kill all local ports except metro”, “kill ports local please all”, “relaunch it local”. Short, high-frequency, no skill.  
   *Evidence:* s19 (multiple).

5. **Multi-worktree parallel features**  
   N feature branches + worktrees + spawn N agents + e2e gate before PR.  
   *Evidence:* s16 channel/playlist scrape filters; s17 ebay-mcp “proceed until finish with sub agents”.

6. **Shared-wire / identity-mapper deslop (monorepo contract)**  
   Promote Zod wire schemas to shared package; delete identity mappers and `export type Old = New` aliases; SSOT imports. Pattern reusable; content MYPR-heavy.  
   *Evidence:* s16–18 path-scoped mapper + shared-zod missions.

7. **Feedback backlog: one AF-* item**  
   Fix ONE AF-XX from docs; acceptance; Agents.md/CODE-STYLE; exact commit msg; no push; report SHA.  
   *Evidence:* s16 AF-10/20; s17 AF-06 — MYPR-specific source file, reusable orchestration shell.

8. **GH multi-repo clone/sync**  
   Duplicate all GH repos into Code (no install); pull every remote branch and report deltas.  
   *Evidence:* s17 duplicate; s19 pull-all-remotes.

9. **Voice STT/TTS fix**  
   Hold-control UI, STT accuracy, TTS noise words (“bg blue”), mic layer bugs.  
   *Evidence:* s16–18 voice threads.

10. **E2E hardening tooling**  
    Strip `waitForTimeout`/`force:true`; Maestro native scripts/matrix; offline coach-GIF audit (Oly).  
    *Evidence:* s16 Maestro; s17 e2e bulk reduce; s18–19 pose audits.

## Skill recommendations

| Job | vs installed | Action | Why |
|-----|--------------|--------|-----|
| Grill + deslop + ban generics | `grillMeCodeStyle*`, `deslop`, `deslopV2` | **improve** | Still freeform despite `$skill` links; bake banned-name lists, slice fan-out, no-comment-first rules into triggers/completion |
| PASS/FAIL verify slice | none clear (`reuseFirstAudit` weak fit) | **create** | High multi-agent reuse; fixed output contract; stack-agnostic |
| Organized commits / push / local-or-deploy prove | `organizedCommits`, `finishAndShip`, `deployAndProve`, `previewAndProve` | **improve** | Mix of `/organized-commits`, “push”, CF prove, TestFlight, “don’t deploy run local” — weak auto-trigger and prove steps |
| Kill ports + relaunch | none | **create** | Tiny, repeated, clear phrase surface |
| Multi-worktree parallel | `coordinateWorktrees` | **improve** | Users describe freeform; skill should auto-plan N branches/agents/e2e gates |
| Shared-zod / mapper SSOT | overlaps deslop / code-style | **leave** or thin **improve** deslop | Strong in MYPR only; encode as monorepo checklist inside deslop, not new skill |
| AF-* one-item fix | none | **create** (light) | Reusable shell: pick item → accept → commit no-push; source doc path param |
| GH clone/sync all repos | `githubRepoMetadata` partial | **create** or **improve** metadata skill | Duplicate-without-install + pull-all-branches report |
| Voice STT/TTS | none | **create** | Recurring dufflebag install/debug job |
| E2E sleep/force cleanup | `previewAndProve` | **improve** | Playwright anti-patterns + native Maestro not in skill |
| React-doctor → 100 | none | **create** (install_doctor family) | Quality gate loop until score target |
| Judgment review of large diff | `grillMeCodeStyleReview` | **improve_or_trigger** | READ-ONLY slice reviews match skill; rarely invoked by name |

## Noise / non-skills

- Acknowledgments: “agreed”, “keep going”, “continue”, “approve”, “yes i do proceed”, “well progress?”
- Stack-trace pastes as “fix …” (TS2345, React #185, Metro syntax) — one-off debug, not a job
- Pure MYPR product: PostHog reverse proxy snippet, guest Lemon checkout, beat rename content, AF acceptance details
- Oly detector modes / CDN holdLandmarks / face-square ROI — product-specific
- the-ascendars commercial video / batch CDP — project one-off
- Skill-from-YouTube-transcript system prompt (s19) — authoring one-shot; use `captureWorkflow` / `syncAgentSkills` if anything
- Gibberish / short noise (“גןג ו גם”, “both i dont like”, “classnames only” mid-grill)

## Limitations

- history + session_jsonl duplicates; counts are not unique-session estimates
- Many grok rows are **orchestrator-written subagent briefs**, not raw user phrasing — still signal for *job shape*, weaker for *trigger phrases*
- MYPR dominates; reusable pattern may look stronger than true cross-repo demand
- No workspace on most codex history rows — harder to attribute stack
- Intent-refined labels (deslop, grill_me, kill_ports, deploy, voice, duplicate_clone) align; PASS/FAIL verify and AF-one-item are under-labeled there and worth promoting
