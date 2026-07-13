# Pipeline runbook

Exact commands, schemas, and recipes for each step in `SKILL.md`. `BRIDGE=/Users/yosefhayimsabag/Desktop/Code/ai-browser-bridge/dist/bridge.js`. Always confirm the live CLI surface first — flags shift across bridge versions:

```bash
node "$BRIDGE" --help && node "$BRIDGE" ask --help && node "$BRIDGE" download --help
```

## Consult + write (steps 3)

Text turns go through the bridge with the model pinned. There is no "GPT-5.6" — the top picker labels are **GPT-5.5 Thinking** (use this for creative reasoning) and **GPT-5.5 Pro**.

```bash
node "$BRIDGE" ask "You are a trailer director. Here is the project brief: <BRIEF>. \
Propose a 20-second vertical trailer transcript (hook/stakes/turn/payoff/CTA) with a VO line per beat." \
  --provider chatgpt --model "GPT-5.5 Thinking" --json --timeout 300
```

Continue the SAME conversation for the critique rounds and the storyboard (`--conversation <idOrUrl>` — get it from `node "$BRIDGE" chat list`). Ask ChatGPT for the storyboard as **strict JSON** matching the `scenes` schema below plus one annotated contact-sheet image (chat bubbles) via `--images 1`.

## The manifest (SSOT for the build)

`scripts/manifest.mjs` owns the schema; the agent patches it as jobs land. Shape:

```jsonc
{
  "version": 1,
  "project": "vybekiit",
  "format": { "aspect": "9:16", "fps": 30, "width": 1080, "height": 1920, "targetSeconds": 24 },
  "creativeMode": "hybrid",              // hybrid | cinematic
  "conversation": "<chatgpt id/url>",    // holds the style bible
  "style": { "bibleImage": "build/bible.png", "refs": ["build/bible.png"] },
  "audio": { "voPath": null, "musicPath": null, "voice": null, "voProvider": null, "musicProvider": null },
  "scenes": [{
    "id": "s01", "order": 1, "beat": "hook", "durationSec": 2.5,
    "shot": "slow push-in, low angle, shallow DOF",
    "voLine": "You shipped it. Nobody came.",
    "caption": "You shipped it. Nobody came.",
    "musicCue": "sparse sub + ticking, tense, 90bpm",
    "source": "ai",                      // ai | screenshot
    "screenshot": null,                  // path when source=screenshot
    "motion": "clip",                    // clip | kenburns
    "motionEngine": "higgsfield",        // higgsfield | flow  (when motion=clip)
    "stillPath": null, "stillStatus": "pending",
    "clipPath": null, "clipJobId": null, "clipStatus": "pending"
  }],
  "variants": []
}
```

```bash
node scripts/manifest.mjs init  --dir <dir> --project <name> --seconds 24
node scripts/manifest.mjs show  --dir <dir>
node scripts/manifest.mjs pending-stills --dir <dir>   # ids still to generate
node scripts/manifest.mjs pending-clips  --dir <dir>
node scripts/manifest.mjs set   --dir <dir> --id s01 --key stillStatus --value done
node scripts/manifest.mjs set   --dir <dir> --id s01 --key clipPath --value build/clips/s01.mp4
```

`set` writes atomically and re-reads, so it is safe to resume after a crash: re-run the phase and only `pending-*` scenes get regenerated.

## Keyframes (step 6)

```bash
# Lock the bible first (one image), then batch the scenes in the same conversation:
node "$BRIDGE" ask "Generate exactly 10 images, numbered 1-10, one per scene, all matching the \
attached style + character reference. Scene 1: <SCENE1>. ... Scene 10: <SCENE10>." \
  --provider chatgpt --conversation <id> --attach build/bible.png --images 10 --timeout 300
node "$BRIDGE" download --json --out <dir>/build/stills
```

`download --json` prints `[{ id, path, bytes }]` and writes a `manifest.json` (the bridge's own, per conversation) listing every attachment with `id: "image-1"`, `role: "assistant"`. Map the newest N assistant images to scenes in order. **Verify count**: if fewer than N tiles returned, re-ask in the same conversation for only the missing indices ("regenerate images 4 and 7 only, same style"). Normalize to PNG if needed: `sips -s format png in.webp --out s04.png`.

## Motion (step 7)

Per scene `motionEngine`:

- **Higgsfield** — `generate_image` (if you want Higgsfield to restyle the still) → `generate_video` with the still as the first frame + the MOTION line as the prompt; poll `job_status` until `completed`; download the mp4 to `build/clips/<id>.mp4`. Recommended for hero/complex shots.
- **Flow/Veo** — `node "$BRIDGE" ask "<MOTION prompt>" --provider flow --attach build/stills/<id>.png --timeout 600` then `node "$BRIDGE" flow download --json --out <dir>/build/clips` (writes `<clipId>.mp4`; rename to `<id>.mp4`). Needs a Google AI Pro/Ultra plan; ~minutes/clip.

Write `clipPath` + `clipStatus=done` (or `clipJobId` + `queued`) to the manifest as each lands. Scenes with `motion: "kenburns"` need no clip — ffmpeg animates the still.

## Audio (step 8) — the fallback chain

Resolve each of VO and music down the chain; record which provider won in `audio.*Provider`.

1. **ElevenLabs** (best voice + music) — used when `ELEVENLABS_API_KEY` is set. Via its MCP if connected, else REST:
   ```bash
   # voiceover
   curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/<voice_id>?output_format=mp3_44100_128" \
     -H "xi-api-key: $ELEVENLABS_API_KEY" -H "content-type: application/json" \
     -d '{"text":"<full VO script>","model_id":"eleven_multilingual_v2"}' -o <dir>/build/audio/vo.mp3
   # music: POST https://api.elevenlabs.io/v1/music  (prompt = cue-sheet mood + total ms)
   ```
2. **Higgsfield** — `create_voice` / `generate_audio` for VO; `generate_audio` for the music bed (prompt from the cue sheet). Always available (MCP), no key.
3. **Local synth** (music only, no key, no credits): `node scripts/synth.mjs --out <dir>/build/audio/music.wav --seconds 24 --bpm 100 --mood epic`.

Produce ONE continuous VO track and ONE music bed spanning the whole trailer; `assembleCut.mjs` handles ducking + timing.

## Assemble, master, reframe (steps 9 & 11)

```bash
# rough cut — fast, no captions, no loudnorm
node scripts/assembleCut.mjs --manifest <dir>/manifest.json --mode rough --out <dir>/build/rough.mp4
# final — Ken-Burns stills, burned captions, VO ducked over music, loudnorm -14 LUFS / -1 dBTP
node scripts/assembleCut.mjs --manifest <dir>/manifest.json --mode final --out <dir>/build/master-9x16.mp4
# platform cuts from the 9:16 master (blurred-fill reframe)
node scripts/reframe.mjs --in <dir>/build/master-9x16.mp4 --all --outdir <dir>/build
```

`assembleCut.mjs` uses each scene's `clipPath` when present, else Ken-Burns on `stillPath` (or `screenshot`), concatenates in `order`, burns `caption` text in final mode, and mixes `audio.voPath` over a sidechain-ducked `audio.musicPath`. Caption burn-in needs an ffmpeg built with **libass**; without it the script writes a `<out>.srt` sidecar (upload it as the platform caption track) and warns. It fails loudly if a referenced media file is missing — fix the manifest, don't ship a gap.

## Gates (planpage)

Use the **planpage** skill for both. Gate 1 payload: the transcript + a table of scenes (all fields) + the annotated sheet image, with per-scene toggles and an Approve action. Gate 2 payload: the `rough.mp4` preview + a grid of per-scene clips + the `virality_predictor` score/notes, with "approve" or per-scene "regenerate" flags that map back to scene ids. Only these two moments block; everything else is autonomous.
