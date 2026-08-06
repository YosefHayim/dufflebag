# Specialist: README / agent docs / GH metadata / web best practices

Audit: `intent-refined.json` + `job-like-prompts.jsonl` (2026-08-06). Skills: `readmeEditor`, `refreshAgentDocs`, `githubRepoMetadata`, `webBestPractices`.

## Intent hygiene (important)

Refined buckets overstate demand for these skills:

| Intent | Counts | Reality |
|--------|--------|---------|
| `readme_agent_docs` | 34 prompts · 34 sessions · **20 workspaces** | Mostly AF-* subagent tasks that *cite* `Agents.md` as rules — not doc authoring. Real skill hits: `[$refresh-agent-docs]`, `/refresh-agent-docs`, SSOT notes (`agent.md is the ssot`). |
| `web_best_practices` | 28 · 22 · **2 workspaces** | Almost all false positives: “Next.js / Effect best practices”, structure/i18n, e2e hygiene — not the 7-dim site audit. |
| (none) | — | `githubRepoMetadata` not mapped; explicit `/github-repo-metadata` once (`yt-caption-mini`). |
| (none) | — | `readmeEditor`: no slash / `$` invocation found in clean prompts. |

Do **not** treat refined `recommendation: improve` on these buckets as product proof without re-labeling.

## Explicit skill usage (true positives)

- `/refresh-agent-docs` — `yt-caption-mini`
- `/github-repo-metadata` — same session, portfolio onboarding style
- `[$refresh-agent-docs]` — launch-store cleanup checklist item (bundled with code cleanup)
- AGENTS consumption high across MYPR worktrees; **authoring/refresh rare**
- Grill-me-code-style-with-docs already refreshes AGENTS digests → competes with `refreshAgentDocs`

## Cross-repo breadth

Portfolio spans MYPR, launch-store, Oly, dufflebag, yt-caption-mini, genshot, vybekiit, etc. These four skills are **portable by design** (inspect repo → write meta files / audit site). Actual explicit runs cluster on **small public/tooling repos** at setup time, not high-frequency product work. High workspace_count on `readme_agent_docs` is false breadth (subagent clones citing Agents.md).

## Per-skill: improve vs leave

### readmeEditor — **LEAVE**
Mature: artifact split, inspect-first, style matrix, grill + map, hard anti-hype rules, solid refs (`artifacts`, `readme-styles`, `examples`). Under-used, not broken. No session pressure for feature work. Optional later: one-line handoff from grill-me “landing docs still missing.”

### refreshAgentDocs — **LEAVE** (tiny clarity only if editing anyway)
Solid contract: fetch official sources via `sources.json` + script, AGENTS SSOT, thin adapters, plan-before-write. Real but rare use. Overlap with grill-me digest updates is intentional layering (grill = style; refresh = vendor/layout sync). Skip multi-repo batch unless portfolio onboarding becomes a repeated job.

### githubRepoMetadata — **LEAVE**
Small, complete: official GH sources, description shape, topics rules, before/after, `gh repo edit` apply. One intentional use matches a rare discoverability job. Do not grow scope.

### webBestPractices — **LEAVE**
Strong package: 7 dimensions, zero-dep `auditSite.mjs`, templates (llms.txt, security headers), exemplars, handoff to `webPerfCi`. Session “best practices” noise ≠ this skill. Do **not** expand based on refined improve. Optional hygiene only: description keywords so framework-structure prompts don’t claim this skill.

## Priority order (if any work later)

1. Re-bucket intents (exclude “Rules: Agents.md” product tasks; split framework-BPs from site audit).
2. Nothing else required for these four skills from this audit.

## Summary table

| Skill | Rec | Why |
|-------|-----|-----|
| readmeEditor | leave | Complete; low intentional demand |
| refreshAgentDocs | leave | Works; rare; grill-me covers digest side |
| githubRepoMetadata | leave | Complete; rare intentional use |
| webBestPractices | leave | Complete; refined “improve” is false positive |

**Bottom line:** Meta/docs skills are in good shape. Audit signal is consumption of AGENTS as law for product agents, not demand to rewrite meta skills. Invest elsewhere (finish/ship, grill-me/deslop, product jobs).
