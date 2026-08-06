# Shards 08–11 — reusable jobs

## Coverage

| Shard | Approx. prompts | Agents | Dominant workspaces |
|-------|-----------------|--------|---------------------|
| 08 | ~59 | codex + grok | MYPR-App, Oly-App, launch-store, Code (voice), genshot |
| 09 | ~48 | codex + grok | MYPR-App (e2e/URL), Oly-App, launch-store, Code |
| 10 | ~63 | codex + grok | MYPR-App (mappers/e2e/AF-*), Oly-App, Code (voice/ports) |
| 11 | ~46 | codex + grok | MYPR-App (SSOT/URL/e2e), Oly-App (detectors), Code |

~216 lines total; codex often dual-sourced (history + session_jsonl) so unique user turns are lower. Heavy MYPR multi-agent parallel work + Oly detector cleanup + dufflebag voice/ops.

## Top reusable jobs

Named by **job**, not ticket. Penalized pure product one-offs (AF-*, yoga black-screen, logo SVGs).

1. **Promote wire schemas to shared + kill identity mappers**  
   Pattern: slice paths → move Zod/constants to `@*/shared/*` → point server validation + client models at SSOT → delete `toX` field-for-field clones / product type aliases / barrels.  
   Evidence: many parallel prompts (discounts, whatsapp, affiliates, admin, chat, media-coverage, membership). Cross-session, codified in CODE-STYLE (`contracts.meaningful-mapping`).  
   **Reusable beyond MYPR** for any monorepo shared-package cleanup.

2. **Code-style / deslop pass (ban generics, map-shims, prefixes, slop helpers)**  
   Freeform: ban `body/data/payload/result`, no `isRecord`, no `build/to/normalize` noise, early guards, no import-as, no backward-compat re-exports, emoji→ASCII, TECH.md.  
   Explicit `$grill-me-code-style-*` / `$organized-commits` in places.

3. **Finish → organized commits → ship/redeploy (with D1 care)**  
   `git commit push`, `$organized-commits` then push/ship, stale-file delete, D1 backup before drop/reinit, launch local before redeploy.

4. **Admin URL-as-state + Playwright deep-link matrices**  
   Inventory URL sync gaps → platform hooks (`useUrlQueryState`) → matrix specs (filters, role gates, expectUrlQuery helper). House style is expo-router query state; job is portable to any admin web app.

5. **E2E hygiene (Playwright web + Maestro native)**  
   Flake kill (no coordinate taps), edge-suite honesty tags, rename banned bindings in tests, throttle-for-e2e vs prod, fix suites before ship.

6. **Voice / TTS / STT reliability (dufflebag)**  
   Hold-ctrl dictation, mic primed, serial queue, HUD blink, phantom TTS, STT mishears. Multi-turn across shards 08–10.

7. **Kill local ports (except metro/8081) + relaunch**  
   Short, repeated freeform; no skill.

8. **Cloudflare / Wrangler / D1 hygiene**  
   Remove CF proxy, D1 drop+backup, redeploy readiness. Appears with ship flows.

9. **Read-only structured inventory / judgment review**  
   “Map everything related to X → DELETE/KEEP/REFACTOR”; CODE-STYLE judgment slices. Adjacent to `reuseFirstAudit` but broader (legacy-mode collapse, style conformance).

10. **Planpage: dump all remaining questions in one shot**  
    Explicit `$planpage` / “ask all remaining questions… one shot”.

11. **Duplicate GH org repos**  
    Low volume but clear job (vybekiit/genshot org clone).

12. **Web / Next.js best-practices structure**  
    Freeform “next.js best practices”, i18n naming, no `_components`.

## Skill recommendations

| Job | Action | vs installed | Notes |
|-----|--------|--------------|-------|
| Finish + organized commits + ship | **improve** | `finishAndShip`, `organizedCommits`, `deployAndProve` | Merge ship+D1-backup checklist; freeform “git commit push” rarely names skill |
| Grill / deslop / ban-generics | **improve** (+ **merge** family?) | `grillMe*`, `deslop`, `deslopV2` | Triggers weak; freeform style rules dominate. Consider one “style enforcement” entry |
| Web best practices | **improve** | `webBestPractices` | “next.js best practices” freeform |
| Planpage one-shot Q | **improve** | `planpage` | Trigger: “ask all remaining questions… one shot” |
| Worktree lint/cleanup | **improve** | `coordinateWorktrees` | “broad lint cleanup across dirty worktree” |
| Docs refresh | **leave** | `refreshAgentDocs`, `readmeEditor` | Present but sparse in these shards |
| Preview/prove / e2e prove | **improve** | `previewAndProve` | Playwright/Maestro paths underused by skill name |
| Shared-Zod / SSOT promote + identity-mapper strip | **create** | none | Highest-value new skill; path-scoped parallelizable |
| Kill ports (+ keep metro) | **create** | none | Tiny skill or shell helper |
| Voice STT/TTS doctor | **create** | none | dufflebag-local but high repeat |
| CF/Wrangler/D1 hygiene | **create** | none | Pair with `deployAndProve` or standalone |
| Repo/org duplicate | **create** (low pri) | none | Rare |
| Structured read-only inventory | **create** or **improve** | `reuseFirstAudit` | Generalize to DELETE/KEEP/REFACTOR inventories |
| Capture skill-from-transcript | **improve** | `captureWorkflow`, `syncAgentSkills` | Giant Uncle-Bob transcript→skill injections in 10–11 |

## Noise / non-skills

- Stack traces (“Maximum update depth…”) and keyboard-layout garbage (Hebrew-typed-as-English).
- Ack noise still present: “yes agreed”, “apply it.”, “Nooooooo”, “Just angry.”, “Reply with only: effort-medium”.
- **MYPR AF-\*** single tickets (AF-09, AF-12, AF-14, AF-30…): product backlog slices — not skills.
- Oly product bugs (black mirror, freeze on re-session, pose pass threshold): product QA, not reusable skill.
- Logo/SVG asset swaps, single-feature affiliate chart UX: one-offs.
- Pasted NotebookLM / YogaConvo2d walls: consult once, not a skill.
- `.bridge` path SSOT fix: dufflebag product bugfix, not a user job skill.

## Limitations

- Shards mix history+session duplicates; counts overstate unique prompts.
- Many grok prompts are **subagent-sliced** MYPR work (path-owned); job is real but encoded as orchestration, not user freeform.
- MYPR density can inflate “product” vs “portable”; SSOT-mapper and URL-as-state still generalize.
- No Claude/Cursor in corpus; codex/grok only.
- Did not re-run global clustering; local shard judgment only, cross-checked with `intent-refined.json` + `installed-skills.json`.
