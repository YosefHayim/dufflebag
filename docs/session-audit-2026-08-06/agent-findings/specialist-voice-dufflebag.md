# Specialist: dufflebag install + TTS/STT/voice/cmux control-hold

## Verdict

**Create skill `dufflebag-doctor` (primary).** Also ship product bugfixes for quality/UX; docs alone are not enough.

| Path | Action | Why |
|------|--------|-----|
| Skill `dufflebag-doctor` | **CREATE** | Recurring freeform “install TTS/STT not work / hold-control / diagnose” with **zero** matching skill (`intent-refined`: `voice_dufflebag` → create; 24 prompts / 7 sessions refined; 38 bucket) |
| Product bugfixes | **DO** (not skill) | TTS saying “item”/markup, hold-UI thrash, STT misses, cmux multi-pane spam, mystery TTS process — code fixes |
| Install / voice docs | **Improve lightly** | Checklist feed for doctor skill; docs alone won’t stop agent re-debug loops |
| Leave alone | **No** | High repeat pain; plans already exist under `docs/superpowers/*dictation*` / `unified-agent-voice` |

## Evidence (job-like + clean-prompts)

Dominant sessions: codex `019fb4e8-…`, `019fb815-…`; grok `019fd629-…`, `019fcbfd-…`, `019fc356-…`. Workspaces: `dufflebag`, Code root.

**Install / “is it installed correctly?”**
- `pnpm i` “Already up to date” + `tsx: command not found` + `node_modules missing`
- “installed dufflebag … ship with tts and stt but not work can u double check”
- “is dufflebag installed glob i run it but not work”
- UI freeze on voice-on; “maybe a node still running”

**Control-hold + cmux + STT**
- “hold the control … in cmux … didnt show the animation and the voice and stt me”
- “holding control still not stt me”
- “voice UI appears starting microphone…” missing
- hold-control animation “hot reloading tons of times”
- cmux multi-terminal: auto-response hook spams TTS across 5–20 panes; want focus-gated play + interrupt key + auto-pause STT

**TTS quality (product)**
- TTS keeps saying “item”
- reads TUI noise (`bg blue`, `text white`) as speech
- “tts and i dont know from where da fk its speaking”
- per-word crunch / dorecord audio check

**STT quality + CLI ergonomics**
- “hell how r u” → “Hello, our leader.”
- misses text; dictionary boost / no-speech never type (ordered dictation work)
- “dufflebag stt on/off” / “tts on/off” / `stt mic-off-delay <n>`
- “not tts voice on but just stt on?”

**Statusline (adjacent packaging)**
- `/statusline` context+model+folder; “add in the dufflebag … statuslines/codex”

## Skill vs product vs docs

| Theme | Type | Skill can absorb? |
|-------|------|-------------------|
| pnpm false-success, missing deps, binary PATH, stale node, model download | Install doctor | **Yes — checklist** |
| stt/tts on/off status, which process is speaking | Diagnose | **Yes** |
| cmux + control-hold expected behavior / focus caveats | Diagnose + docs | **Yes (partial)** |
| TTS markup/item, UI thrash, STT accuracy, focus-gated TTS | Product | **No — fix code** |
| `statuslines/codex` template layout | Packaging | Thin skill step or template |

## Recommended skill: `dufflebag-doctor`

**Triggers:** “tts/stt not work”, “installed dufflebag”, “hold control”, “cmux voice”, “where is tts speaking”, “mic-off-delay”, “voice freeze”.

**Do (read-only first, then guided fix):**
1. Install health: `node_modules`, package manager lock, CLI entry (`tsx`/bin), voice worker binary, model files, permissions (mic).
2. Process map: list voice/TTS/STT/node PIDs; stop orphans; report which path is speaking.
3. Mode matrix: STT-only vs TTS-only vs both; how control-hold should behave in/out of cmux.
4. Reproduce hold-control once; report UI animation, mic prime, transcript, errors.
5. Optional: symlink skills check (overlaps `syncAgentSkills`).

**Do not:** re-architect dictation, swap STT models without ask, commit unless asked.

## Product backlog (not skill)

1. Don’t TTS markup / “item” tokens  
2. Debounce hold-control UI (no thrash)  
3. cmux: TTS only on focused pane + interrupt  
4. STT: dictionary boost, no-speech never type, mic-off-delay  
5. Split narrate off dictate critical path (user-ordered)  
6. Stable CLI: `dufflebag stt|tts on|off`, status

## Noise to ignore

- history ↔ session_jsonl dupes  
- Oly-App “voice accuracy” detector (product, not dufflebag voice)  
- YT transcript → skill system prompts  
- bare “Nooooooo” / partial STT greets  

## Bottom line

**Skill opportunity first** (`dufflebag-doctor`) to stop re-teaching install/diagnose/control-hold. **Product bugfix work continues in parallel** for quality. **Improve install docs only as the skill’s SSOT checklist**, not as the main fix. Do not leave.
