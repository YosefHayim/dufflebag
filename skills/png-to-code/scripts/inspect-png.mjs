#!/usr/bin/env node
/**
 * inspect-png.mjs — read a target PNG's dimensions, sample exact hex colors at
 * given pixels, and/or report a dominant-color palette. Use during decomposition
 * so specs (canvas size, colors) are measured from pixels, not guessed.
 *
 * Examples:
 *   node inspect-png.mjs --input design.png
 *   node inspect-png.mjs --input design.png --at 40,120 --at 200,64
 *   node inspect-png.mjs --input design.png --palette 12
 */
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';

/** Parse argv; `--at` may repeat and is collected into an array. */
function parseArgs(argv) {
  const args = { at: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    let value = true;
    if (next !== undefined && !next.startsWith('--')) {
      value = next;
      i++;
    }
    if (key === 'at') args.at.push(value);
    else args[key] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  console.error('usage: node inspect-png.mjs --input <file.png> [--at x,y ...] [--palette N]');
  process.exit(2);
}

const file = path.resolve(args.input);
const png = PNG.sync.read(fs.readFileSync(file));

const toHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const clamp = (v, max) => Math.max(0, Math.min(max, v));

const colorAt = (x, y) => {
  const cx = clamp(x, png.width - 1);
  const cy = clamp(y, png.height - 1);
  const idx = (cy * png.width + cx) * 4;
  return {
    x: cx,
    y: cy,
    hex: toHex(png.data[idx], png.data[idx + 1], png.data[idx + 2]),
    rgba: [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]],
  };
};

const out = { file, width: png.width, height: png.height };

if (args.at.length) {
  out.samples = args.at.map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return colorAt(x, y);
  });
}

if (args.palette) {
  const n = Number(args.palette) || 8;
  const counts = new Map(); // 5-bit-per-channel buckets group near-identical colors
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 8) continue; // skip transparent pixels
    const r = png.data[i] & 0xf8;
    const g = png.data[i + 1] & 0xf8;
    const b = png.data[i + 2] & 0xf8;
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  out.palette = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({
      hex: toHex((key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff),
      pct: +((count / total) * 100).toFixed(1),
    }));
}

console.log(JSON.stringify(out, null, 2));
