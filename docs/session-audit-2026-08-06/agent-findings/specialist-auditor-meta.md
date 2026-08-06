# Meta: captureWorkflow / autorun / agentSessionAuditor

**Verdict (this audit volume):** improve **agentSessionAuditor** hard; light **captureWorkflow** handoff; **leave autorun**.

## Audit volume that forced the re-run

| Signal | Value |
|---|---|
| Prompts extracted | 1301 (codex 921, grok 380) |
| Exact multi-session | 378 |
| Fuzzy clusters | 319 |
| Unclassified after intent refine | **782 (60%)** |
| Top named intents | mypr 158, finish_ship 125, code_style 98, deslop 53 |
| Skills for the three meta skills | prose SKILL.md only (no scripts/) |

User is re-running auditor because prior skill capture did not stop repeated jobs — not because autorun failed.

## agentSessionAuditor — **improve** (P0)

Quality bugs visible in this run, not just missing features:

1. **Extraction leaks** — fuzzy preview treats `<environment_context>`, injected `<skill>` XML, plugin lists as user jobs (e.g. c0330 “high” conf, 16 sessions). Rule exists (“user-authored only”) but parsers miss wrappers.
2. **Intent rules too coarse** — keyword buckets mis-assign multi-intent prompts (ship+TTS, deslop+grill, deploy+notifications). Overlap: code_style_docs / deslop / grill_me_family share near-identical examples.
3. **60% unclassified** — largest “leave” bucket is a pipeline fail, not true one-offs. Need second-pass: workspace+fuzzy cluster → job label, not bag-of-words alone.
4. **Worktree inflation** — many “workspaces” are `~/.grok/worktrees/.../subagent-*`; normalize to parent repo before ranking breadth.
5. **No durable scripts** — skill is flow prose; this audit used ad-hoc extract/shard/cluster. Re-runs will keep costing full agent time.

**Concrete improvements**

| Area | Do |
|---|---|
| Scripts | `scripts/extract.ts`, `cluster.ts`, `intent-map.ts`, `report.ts` — coverage JSON + clusters + refined intents + specialist shards |
| Filters | Drop env/skill/plugin wrappers; stricter ack/retry strip; strip terminal paste noise when only shell transcript |
| Clustering | Keep Jaccard; add “reject if >40% placeholder tokens”; merge clusters that share ≥2 high-IDF job verbs; separate product-name buckets (mypr, oly) from job verbs |
| Intent | Seed map from installed skill names + aliases; multi-label allowed; require human review only for create/improve top-N |
| Report template | Fixed sections: coverage, top jobs, create/improve/leave, false-cluster list, “capture next” queue with example paths |
| Specialist pack | Emit `agent-findings/` brief per top intent (≤100 lines) so parallel review is the default, not a one-off |

## captureWorkflow — **improve lightly** (P1)

Leave core capture rules (smallest asset, clean-state replay). Add auditor integration:

- When auditor recommends **create**, default form is often **script + thin skill**, not skill-only judgment flow.
- Post-audit step: for each P0 create/improve cluster with ≥N unique sessions, run capture against one proven session’s successful path (not the whole cluster text).
- Explicit anti-pattern: do not capture “mypr product” as one skill — capture stable jobs (kill-ports, finish-ship, wrangler/d1) with product-agnostic params.

Without this handoff, auditor volume will keep rising while skills stay prose.

## autorun — **leave**

- Zero signal in intent-refined that the compact/autopilot loop caused repeated work.
- Audit is read-only multi-agent analysis; autorun’s Ghostty compact loop does not fix clustering or skill gaps.
- Do not expand autorun scope for skill authoring or audit fan-out.

## Priority order

1. Auditor extract filters + intent multi-label (cuts false “improve” and shrinks unclassified).
2. Scripted pipeline + report template (makes re-audit cheap).
3. Capture handoff from top create queue (kills ports, finish-ship triggers, CF/d1 ops, voice install doctor).
4. Leave autorun; leave low-volume skills (blog, web_perf, reuse_first).

## Done when

- Re-audit of same stores: unclassified &lt;25%, zero env/skill XML in top fuzzy, parent-repo workspace counts, report + shards generated without re-prompting the full workflow.
- At least 2 captureWorkflow outputs from this audit’s create list ship as scripts with clean-state replay evidence.
