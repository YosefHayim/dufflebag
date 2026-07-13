---
name: make-a-trailer
description: Direct a cinematic, viral-ready trailer for any project — reads the repo's own docs to derive the story, consults ChatGPT (GPT-5.5 Thinking) over ai-browser-bridge to write the transcript + storyboard, batch-generates the keyframes as ChatGPT images, animates them with Higgsfield or Flow/Veo, produces voiceover + music (ElevenLabs → Higgsfield → local synth), and assembles a 9:16 master + 16:9/1:1/4:5 platform cuts with ffmpeg — behind two planpage approval gates. Use when the user wants a trailer, promo, launch/teaser/hype video, commercial, sizzle reel, or cinematic short for a project to post on LinkedIn/YouTube/Instagram/TikTok, or says "make a trailer", "make a promo", "cinematic video", or "make it go viral". For a portfolio blog cover image use write-a-post; for store/marketing copy use cws-listing-seo.
---

# make-a-trailer

Point this at any project and it ships a cinematic vertical trailer for social — you approve **twice**, everything else runs hands-free.

## Ground rule

**One character, one world, two gates.** A trailer reads as *professional* when the face, style, and world stay identical across every scene and the whole cut lands one feeling — not when each frame is individually pretty. So: **lock a style + character bible before generating anything**, drive every image and clip from it, and record every job in a **resumable manifest** so a dead render resumes instead of re-spending credits. Claude directs; ChatGPT writes + draws; Higgsfield/Flow move; ffmpeg cuts. Never claim a step ran that didn't — the manifest is the truth.

## Engines (who does what)

| Job | Engine | How |
| --- | --- | --- |
| Story, transcript, storyboard, **keyframes** | **ChatGPT** (GPT-5.5 Thinking) via `ai-browser-bridge` | `bridge ask` (text) + `bridge ask --images` / `bridge download` (stills) |
| Motion (per scene) | **Higgsfield** `generate_video` *or* **Flow/Veo** `bridge ask --provider flow` | the storyboard tags each scene's engine |
| Voiceover + music | **ElevenLabs → Higgsfield → local synth** (fallback chain) | `reference/pipeline.md` → Audio |
| Virality check | **Higgsfield** `virality_predictor` | scored at Gate 2 |
| Assemble, caption, master, reframe | **ffmpeg** | `scripts/assembleCut.mjs`, `scripts/reframe.mjs` |
| Approval gates | **planpage** | storyboard + rough-cut review |

`ai-browser-bridge` CLI: `/Users/yosefhayimsabag/Desktop/Code/ai-browser-bridge/dist/bridge.js`. Exact commands, the manifest schema, and the audio chain live in **`reference/pipeline.md`**; cinematic shot/prompt vocabulary in **`reference/shot-language.md`**. ChatGPT & Gemini can *play* video/audio in-UI but the bridge has no export path for either — that's a v2 bridge change, not this skill.

## Preflight (once per machine / session)

```bash
BRIDGE=/Users/yosefhayimsabag/Desktop/Code/ai-browser-bridge/dist/bridge.js
# quit your normal Chrome first — the bridge drives its own profile
node "$BRIDGE" chrome start --provider chatgpt   # then sign in once
node "$BRIDGE" ask --help                         # confirm --model --attach --images --conversation --timeout
which ffmpeg ffprobe                               # required (an ffmpeg built with libass burns captions; else a .srt sidecar is written)
# Higgsfield MCP must be connected; ELEVENLABS_API_KEY optional (else the chain falls back to Higgsfield)
```

## The pipeline

Steps 1–3 and 5–9 are autonomous. You touch it only at 🚦.

1. **Ingest.** Read the target project's `AGENTS.md` / `README.md` / `CONTEXT.md` / `package.json` → derive purpose, audience, the pain it kills, the win. Inventory screenshots (`public/`, `docs/`, `assets/`, `screenshots/`, `.github/`, README image refs).
2. **Creative mode (auto).** Usable screenshots found → **hybrid narrative** (story beats + real screenshots at the reveal). None → **fully cinematic** (all AI scenes). Record it in the manifest.
3. **Consult + storyboard.** Claude ↔ ChatGPT: draft the transcript/VO → critique → refine (2–3 rounds), then have ChatGPT produce the storyboard (per scene: shot, expression, pose, environment, dramatic beat, music cue, VO line, **motion engine**, source = ai/screenshot) **and** one annotated storyboard sheet with chat bubbles. Write it all into `manifest.json` via `scripts/manifest.mjs`.
4. 🚦 **Gate 1 — storyboard.** Render the storyboard + annotated sheet with **planpage**; the user edits/approves scenes; the choice posts back. Nothing generates before this.
5. **Lock the bible.** One ChatGPT generation of the style + hero-character reference; save its image + conversation id in the manifest. Every later image attaches it.
6. **Keyframes (batched).** In that one conversation, generate the clean per-scene stills — **up to 10 per prompt**, explicitly numbered ("exactly 10 images, numbered 1–10, one per scene, all matching the attached refs"). After `bridge download --json`, **verify the tile count and auto-retry only the missing/off indices**; chunk >10 scenes into batches of 10 in the *same* conversation. Screenshot scenes skip generation.
7. **Motion.** Per scene tag: **Higgsfield** `generate_image`→`generate_video`, or **Flow/Veo** (`bridge ask --provider flow` → `bridge flow download`). Poll `job_status`; write each clip path + job id to the manifest as it lands (**resumable** — a rerun skips `done` scenes). Scenes left as `kenburns` get their motion in ffmpeg.
8. **Audio.** Voiceover from the chain (ElevenLabs → Higgsfield → none); music bed from the chain (ElevenLabs Music → Higgsfield `generate_audio` → `scripts/synth.mjs`). Match the cue sheet; paths → manifest.
9. **Rough cut + score.** `node scripts/assembleCut.mjs --manifest <dir>/manifest.json --mode rough --out <dir>/build/rough.mp4`, then Higgsfield `virality_predictor` on it.
10. 🚦 **Gate 2 — rough cut.** planpage before/after: the assembled preview + per-scene clips + the virality score; the user approves or flags scenes to regen (loop back to 6/7 for only those).
11. **Master + variants.** `assembleCut.mjs --mode final` (burn captions — needs an ffmpeg with libass, else a `.srt` sidecar is emitted; mix VO over ducked music; loudnorm to **−14 LUFS / ≤ −1 dBTP**) → 9:16 master; then `scripts/reframe.mjs` derives 16:9, 1:1, 4:5. Report every output path.

## Output layout

```
<project>/marketing/make-a-trailer/v<N>/
  manifest.json            # tracked — the resumable plan + job ledger
  storyboard.md            # tracked
  build/                   # git-ignored — stills, clips, audio, cuts, variants
```

**New run = new `v<N>` folder — never overwrite a prior trailer.** Add `build/` (and any media) to the project's `.gitignore`.

## Guardrails

- **Never model-process a logo** and never alter on-screen product/brand spelling — composite real logos in ffmpeg, don't regenerate them.
- **No imitation** of a real person, celebrity voice, composer, song, game, or film. Original audio only; the chain is royalty-free by construction.
- **Consistency or redo.** If the hero's face/style drifts, re-attach the bible (or regenerate only the off scenes) — don't ship a cut where the character changes.
- **The manifest is the source of truth.** Mark a scene `done` only after its file exists on disk. Report skipped/failed steps plainly.
- **Media stays git-ignored and local.** Trailers are large and per-project private until the user posts them.

## Files

- `reference/pipeline.md` — exact `bridge` commands, manifest schema, audio provider chain, Higgsfield calls, ffmpeg recipes, planpage gate payloads
- `reference/shot-language.md` — the viral-trailer structure, shot/camera/lighting vocabulary, and the SCENE/IDENTITY/STYLE/MOTION/NEG prompt-block scheme
- `scripts/manifest.mjs` — create/query/patch the resumable generation manifest (zero-dep)
- `scripts/assembleCut.mjs` — ffmpeg: scenes (clips or Ken-Burns stills) + captions + ducked VO/music → rough or mastered cut
- `scripts/reframe.mjs` — ffmpeg: derive 16:9 / 1:1 / 4:5 platform cuts from the 9:16 master
- `scripts/synth.mjs` — zero-dep local music-bed fallback (WAV) when no ElevenLabs / Higgsfield audio
