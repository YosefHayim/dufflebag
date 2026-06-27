#!/usr/bin/env node
/**
 * pixel-diff.mjs — render a build with Playwright, screenshot it, and pixel-diff
 * it against a target PNG. Prints a JSON report (mismatch ratio + hotspot grid)
 * and writes a diff image.
 *
 * This is the convergence engine of the png-to-code skill: drive `ratio` toward
 * ~0 by fixing the top hotspot each iteration. The screenshot is taken at the
 * target PNG's pixel dimensions (viewport, deviceScaleFactor 1) so the two images
 * compare 1:1 without resizing.
 *
 * Exit code: 0 if pass (ratio < max-ratio), 1 if fail, 2 on usage/IO error.
 */
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Parse `--key value` and `--flag` argv into a plain object. */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function fail(message) {
  console.error(`pixel-diff: ${message}`);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
if (!args.target || !args.input) {
  fail(
    'usage: node pixel-diff.mjs --target <design.png> --input <build.html|url> ' +
      '[--out diff.png] [--threshold 0.1] [--max-ratio 0.001] [--width W] [--height H] [--no-freeze]',
  );
}

const targetPath = path.resolve(args.target);
if (!fs.existsSync(targetPath)) fail(`target not found: ${targetPath}`);

const target = PNG.sync.read(fs.readFileSync(targetPath));
const width = args.width ? Number(args.width) : target.width;
const height = args.height ? Number(args.height) : target.height;
const colorThreshold = args.threshold ? Number(args.threshold) : 0.1;
const maxRatio = args['max-ratio'] ? Number(args['max-ratio']) : 0.001;
const outPath = path.resolve(args.out || 'diff.png');
const freeze = !args['no-freeze'];

const url = /^(https?|file):\/\//.test(args.input)
  ? args.input
  : pathToFileURL(path.resolve(args.input)).href;

let actual;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
  });
  if (freeze) {
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important;}',
    });
  }
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width, height } });
  actual = PNG.sync.read(shot);
} finally {
  await browser.close();
}

if (actual.width !== target.width || actual.height !== target.height) {
  fail(
    `screenshot ${actual.width}x${actual.height} != target ${target.width}x${target.height}; ` +
      `set --width/--height to the target's pixel size`,
  );
}

const diff = new PNG({ width, height });
// AA pixels are ignored (includeAA:false). Changed pixels are painted pure red
// (diffColor); unchanged pixels come out desaturated. pixelmatch always writes
// opaque output, so hotspots are detected by the red diff color, not by alpha.
const diffColor = [255, 0, 0];
const diffPixels = pixelmatch(target.data, actual.data, diff.data, width, height, {
  threshold: colorThreshold,
  includeAA: false,
  diffColor,
});
fs.writeFileSync(outPath, PNG.sync.write(diff));

// Hotspot grid: where the differences cluster, so the next fix is targeted.
const cols = 8;
const rows = Math.max(1, Math.min(16, Math.round((cols * height) / width)));
const cellW = width / cols;
const cellH = height / rows;
const cellCounts = new Array(rows * cols).fill(0);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    const isDiff =
      diff.data[p] === diffColor[0] && diff.data[p + 1] === diffColor[1] && diff.data[p + 2] === diffColor[2];
    if (!isDiff) continue;
    const c = Math.min(cols - 1, Math.floor(x / cellW));
    const r = Math.min(rows - 1, Math.floor(y / cellH));
    cellCounts[r * cols + c]++;
  }
}
const hotspots = cellCounts
  .map((count, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x0 = Math.round(c * cellW);
    const y0 = Math.round(r * cellH);
    const w = Math.round((c + 1) * cellW) - x0;
    const h = Math.round((r + 1) * cellH) - y0;
    return { count, pct: +((count / (w * h)) * 100).toFixed(2), bbox: { x: x0, y: y0, w, h } };
  })
  .filter((cell) => cell.count > 0)
  .sort((a, b) => b.count - a.count)
  .slice(0, 5);

const ratio = diffPixels / (width * height);
const report = {
  target: targetPath,
  input: url,
  dimensions: { width, height },
  diffPixels,
  ratio: +ratio.toFixed(5),
  ratioPct: +(ratio * 100).toFixed(3),
  maxRatio,
  pass: ratio < maxRatio,
  threshold: colorThreshold,
  diffImage: outPath,
  hotspots,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
