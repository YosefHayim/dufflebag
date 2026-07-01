# png-to-code

Convert a PNG design into pixel-perfect code — SVG, HTML/CSS, Tailwind, or React — using a measured screenshot-diff loop.

## Setup

From this directory's `scripts/` folder:

```bash
cd scripts
npm install
npx playwright install chromium
npm run typecheck
```

Run scripts from `scripts/` with `npx tsx src/...` or the npm shortcuts below.

## Core harness

| Script | Command | Purpose |
|--------|---------|---------|
| pixel-diff | `npm run diff -- --target design.png --input build.html` | Render + diff → ratio + hotspots |
| inspect-png | `npm run inspect -- --input design.png --at 40,120` | Dimensions, color samples, palette |
| frames | `npm run frames -- page.html sheet.png 300 0,300,600` | Animation contact sheet |

## PNG utilities (`src/png/`)

| Script | Purpose |
|--------|---------|
| `mask.ts` | Mask regions on a PNG before tracing |
| `crop.ts` | Crop + upscale a bbox for inspection |
| `regions.ts` | Column-projection band detection |
| `detectPurple.ts` | Connected-component violet feature detection |
| `extractBlob.ts` | Trace soft background blobs to SVG paths |

## HTML / SVG utilities

| Script | Path | Purpose |
|--------|------|---------|
| wrap | `src/html/wrap.ts` | Wrap SVG in sized HTML for diffing |
| embed-svg | `src/html/embedSvg.ts` | Build a responsive HTML viewer around an SVG |
| hand-clip | `src/png/handClip.ts` | Flood-fill hand silhouette for clip-path |

## Verification (`src/verify/`)

| Script | Purpose |
|--------|---------|
| `stitch.ts` | Side-by-side PNG compare sheet |
| `renderShot.ts` | Quick Playwright screenshot of HTML |

## Robot case study (`src/examples/robot/`)

Reference pipeline for an animated illustration. **Assets are local-only** — see [`demo/README.md`](demo/README.md).

| Script | Purpose |
|--------|---------|
| `rigArm.ts` | Split arm/body PNG layers |
| `compose.ts` | Assemble animated robot SVG + HTML |
| `armscan.ts` / `facescan.ts` | Debug SVG path overlap |
| `cropcmp.ts` | Visual mask quality check |

## SVGO

```bash
npx svgo --config scripts/svgo.config.mjs -i in.svg -o out.svg
npx svgo --config scripts/robot.svgo.config.mjs -i robot.svg -o robot.min.svg
```

## Output stack

Match the target repo's framework when one exists. Otherwise default to vanilla HTML + CSS + inline SVG. See `SKILL.md` stack detection.

## Docs

- [`SKILL.md`](SKILL.md) — agent workflow
- [`CONTEXT.md`](CONTEXT.md) — domain vocabulary and decisions
- [`TECH-GLOSSARY.md`](TECH-GLOSSARY.md) — technical term glossary
- [`reference/`](reference/) — decompose, rigging, animation, verification
