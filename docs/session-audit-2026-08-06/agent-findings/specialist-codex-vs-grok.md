# Specialist: Codex vs Grok (skill design)

Sources: `coverage-manifest.json`, `intent-refined.json`, `job-like-prompts.jsonl`, `syncAgentSkills/SKILL.md`.  
Corpus: **codex 921 / grok 380** prompts (~71/29). Claude/Cursor empty.

## Jobs: codex-heavy vs grok-heavy

| Bias | Intents / patterns | Evidence |
|------|--------------------|----------|
| **Codex-only** | `grill_me_family` (45), `duplicate_clone_repos` (7), `session_ops` (4) | `intent-refined` agents arrays are `["codex"]` only |
| **Codex-heavy** | Explicit skill invoke: `$grill-me-*`, `[$organized-commits](…/SKILL.md)`, `$refresh-agent-docs`; statusline; yt→skill authoring; early dufflebag voice bring-up | job-like: all `$grill-me` hits are codex; statuslines/codex install request |
| **Both (volume shared)** | `finish_ship_commit_push`, `code_style_docs`, `deslop`, `preview_and_prove`, `readme_agent_docs`, `mypr_product`, `cloudflare_stack`, `kill_ports_local_dev` | dual agents listed; workspaces mix Desktop/Code + `~/.grok/worktrees/…` |
| **Grok-heavy style** | MYPR parallel subagents (worktrees), scoped “Audit+deslop … No commit”, `/organized-commits`, skill/symlink meta, later STT/TTS CLI productization | grok chat_history + many `subagent-019…` workspaces; freeform deslop without `$` |

**Design takeaway:** same jobs often reappear on both agents, but **trigger packaging differs**: Codex = `$name` / markdown skill links; Grok = slash or freeform + subagent briefs.

## Dictation / voice / cmux

| Phase | Agent | Notes |
|-------|-------|--------|
| Install + cmux + hold-control STT + TTS “item” bug + multi-terminal spam hook | **Codex** | `voice_dufflebag` early history; cmux-focused |
| `dufflebag stt|tts on/off`, mic-off-delay, serial dictation queue, Parakeet HUD, frozen voice UI | **Grok** | later product CLI / architecture |
| Intent bucket | both | `voice_dufflebag`: 24 prompts, 7 sessions, agents `codex`+`grok`; no existing skill |

**Net:** artifact volume skews **Codex for bring-up/cmux**, **Grok for ops CLI and dictation architecture**. Skill (if created) must cover both invoke styles and cmux focus rules, not only model STT quality.

## Does `syncAgentSkills` need better dual-agent packaging?

**Yes.**

1. Skill copy lists Grok among targets but also warns not to claim Grok without verified integration — user still asks Grok whether `.agent` skills symlink to dufflebag (discovery uncertainty).
2. Codex users invoke skills by **`$id` / path**; Grok users often **do not** — they restate the job or use `/organized-commits`. Parity of folders ≠ parity of *use*.
3. High-repeat jobs already tagged “multi-agent coverage may be weak” (`finishAndShip`, grill family, deslop, previewAndProve) while both agents run those jobs.
4. Codex-only extras (statusline recipe) are agent-native; sync should report **provider matrix + smoke discovery**, not “synced everywhere” on copy alone.

**Improve:** official Grok target path + smoke; dual invoke cheatsheet (`$skill` vs freeform/slash); receipt proves *loadable* on codex **and** grok.

## Skills that effectively help only one agent

| Skill / area | Who benefits in practice | Why |
|--------------|--------------------------|-----|
| `grillMe*` / `grillMeCodeStyleWithDocs` | **Codex** | Intent `grill_me_family` codex-only; zero grok `$grill` in job-like |
| statuslines/codex (install path) | **Codex** | Agent-native UI |
| `finishAgentSessions` / session resume phrasing | **Codex-ish** | `session_ops` codex-only (devin resume text) |
| Freeform deslop / ship language | **Both** | Grok reimplements via scoped briefs; skill body helps if discovered |
| `syncAgentSkills` itself | **Meta both** | Only works if Grok packaging is real; currently the weak link |

Low-volume grok-only buckets (`blog_post`, `reuse_first`, `web_perf`) are noise, not “Grok-only skills.”

## Skill-design recommendations (short)

1. Dual-agent **invoke frontmatter** on every high-repeat skill: Codex `$id`, Grok freeform triggers + optional `/id`.
2. New or improved **voice/cmux** skill: both agents; focus-gated TTS, STT CLI.
3. Port grill triggers to Grok or accept grill as Codex-primary.
4. Harden `syncAgentSkills` Grok discovery smoke before claiming dual packaging.
