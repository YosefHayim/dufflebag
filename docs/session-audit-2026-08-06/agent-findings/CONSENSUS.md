# CONSENSUS — session audit 2026-08-06

**Inputs:** shards 00–19 + specialists (finish-ship, grill-deslop, deploy-preview, skill-gaps, bulk-repo-ops, mypr-vs-reusable, false-positives, auditor-meta, priority-rank, session-ops, codex-vs-grok, web-quality).  
**Corpus:** ~1301 prompts (codex≈71% / grok≈29%); history↔session_jsonl inflates counts.

---

## Must improve

| Priority | Skill(s) | Agreed change |
|----------|----------|---------------|
| P0 | `finishAndShip` (+ bridge `organizedCommits`) | Freeform `git commit push` / `push to main` → outer finish loop; zero `$finish-and-ship` invokes. Anti-triggers: `no commit`, `NO git commit/add/push`. Composition to preview/deploy; completion = SHA + remote + gates. |
| P0 | `grillMeCodeStyleWithDocs`, `deslop`, `deslopV2` | Voice aliases (`$grill`, gridme), freeform “full deslop / ban payload…”, grill→deslop-v2 combo after planpage. Do **not** merge coach/review into with-docs. Optional later: merge deslop+deslopV2. |
| P0 | `agentSessionAuditor` | Strip env/skill XML; multi-label intents; parent-repo worktree normalize; scripted extract/cluster/report (cut 60% unclassified). |
| P1 | `previewAndProve` | Triggers: launch/relaunch local, tunnel e2e, browser QA, e2e-ready. Not: Playwright authoring, product “preview” UI. Named use = 0. |
| P1 | `deployAndProve` | Triggers: redeploy/redploy, cf:deploy, curl smoke, multi-site. Anti: “do not deploy / run local only.” Keep separate from preview and finish. |
| P1 | `syncAgentSkills` | Dual-agent packaging smoke (Codex `$id` vs Grok freeform/slash); prove loadable, not copy-only. |
| P2 | `planpage` | “ask all remaining questions… one shot”. |
| P2 | `coordinateWorktrees` | Freeform prune merged worktrees; N-branch + e2e gate fan-out. |
| P2 | `captureWorkflow` | Handoff: top create clusters → script+thin skill, product-agnostic params. |
| P2 | `deslopV2` / prove path | Optional: barrels/compat-alias ban; PASS/FAIL read-only verify role (or improve `reuseFirstAudit`). |

**Web quality:** leave `webBestPractices` / `webPerfCi` bodies; only add **negative** triggers so bare “next.js best practices” does not route there.

---

## Must create

| Priority | Skill | Why consensus |
|----------|-------|---------------|
| P0 | `killPortsLocalDev` | Unanimous; stable phrase; keep metro/8081; list→kill→optional relaunch. |
| P1 | `cloudflareOps` (wrangler/D1/proxy/backup) | Cross-repo (MYPR, Oly, genshot, vybekiit); not covered by deploy-and-prove prove loop. Ops-only. |
| P1 | `workspaceBootstrap` / `bulkGhCloneSync` | Duplicate GH user/orgs → `~/Desktop/Code`, optional bulk pnpm + pull-all-remotes report. Not `githubRepoMetadata`. |
| P2 | Monorepo SSOT pair: `promoteSharedZod` + `meaningfulMappingCleanup` | Highest structured MYPR wave; portable rules (shared wire Zod; no identity `toX`). Encode rules, **not** path-locked mission paste. |
| P2 optional | Thin `passFailVerify` | Read-only PASS/FAIL evidence contract for multi-agent fan-out — or fold into auditor/`reuseFirstAudit`. |

---

## Must NOT create

- **`mypr*` / whole `mypr_product` skill** — product spam + subagent fan-out, not one job.
- **AF-\* / Arik backlog executor** as product skill — tracker-agnostic “one item, no push, report SHA” may improve capture/finish only.
- **Voice/STT/TTS / cmux skill** — product debug of dufflebag (skill-gaps + false-product mix); fix product + CLI docs. (Shards wanted create; specialists overrule: leave.)
- **Third session-ops skill** — leave `finishAgentSessions` / auditor; optional trigger polish only.
- **Merge** preview↔deploy, or either fully into finish-and-ship; **merge** grill coach/review into with-docs; **new mega grill**.
- **install_doctor catch-all**, statusline skill (artifact exists), autorun expansion, blog/web_perf skills.
- Skills from **acks** (`agreed`/`approved`), **env_context**, skill-body pastes, stack dumps, YT-transcript→skill system dumps.

---

## Biggest evidence gaps

1. **Double-count** history + session_jsonl; raw prompt counts ≠ unique jobs/sessions.
2. **~60% unclassified** + keyword-polluted intents (readme_agent_docs, web_best_practices, session_ops “stale”).
3. **MYPR / grok subagent briefs** inflate “jobs” and workspaces (`~/.grok/worktrees/.../subagent-*`); parent-repo breadth unknown for SSOT/mapper skills.
4. **Shared-zod multi-repo demand unproven** outside MYPR waves — create only if rules stay product-agnostic.
5. **Named vs freeform:** finish/preview/deploy almost never `$named`; grill/organized-commits sometimes named (Codex-heavy) — trigger quality, not missing bodies.
6. **No Claude/Cursor** in corpus; Grok discovery/smoke weak vs Codex `$skill`.
7. **Voice create vs leave** split: volume high but ~7 sessions, dufflebag-product-bound.
8. Peer specialists written before full peer set; priority-rank predated shard/specialist nuance on voice/web/mypr.

---

## Execution order

1. Auditor pipeline quality → 2. finish/ship freeform triggers → 3. grill/deslop entry+combo → 4. kill-ports + CF ops + workspace bootstrap → 5. preview/deploy triggers → 6. monorepo SSOT skills if still multi-session after re-cluster.
