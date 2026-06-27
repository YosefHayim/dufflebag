#!/usr/bin/env node
/**
 * frames.mjs — render an animated page as a horizontal contact sheet, one cell per
 * timestamp, by SEEKING the animation timeline rather than waiting in real time.
 *
 * Why seek instead of sleep: `goto` then `waitForTimeout(t)` drifts by the page's
 * load/networkidle time, so short poses (a blink, a wave peak) are silently missed.
 * Seeking via the Web Animations API (`getAnimations().currentTime = t`) is exact and
 * reproducible — the same timestamps always produce the same frames.
 *
 * Usage:
 *   node frames.mjs <page.html|url> <out.png> [cell=300] [ms,ms,...=0]
 * Examples:
 *   node frames.mjs robot.html out/wave.png 360 0,300,600     # see a wave swing
 *   node frames.mjs robot.html out/blink.png 360 0,4416       # see the blink closed
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const [input, outPng, cellArg, msArg] = process.argv.slice(2);
if (!input || !outPng) {
  console.error('usage: node frames.mjs <page.html|url> <out.png> [cell] [ms,ms,...]');
  process.exit(2);
}
const cell = Number(cellArg || 300);
const stamps = (msArg || '0').split(',').map(Number);
const GAP = 12;
const url = /^(https?|file):\/\//.test(input) ? input : pathToFileURL(path.resolve(input)).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cell, height: cell }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle' });

const shots = [];
for (const t of stamps) {
  await page.evaluate((ms) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = ms;
    }
  }, t);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: cell, height: cell }, animations: 'allow' });
  shots.push(PNG.sync.read(buf));
}
await browser.close();

const W = stamps.length * cell + (stamps.length - 1) * GAP;
const sheet = new PNG({ width: W, height: cell });
sheet.data.fill(245);
shots.forEach((img, k) => {
  const ox = k * (cell + GAP);
  for (let y = 0; y < cell; y++)
    for (let x = 0; x < cell; x++) {
      const si = (y * cell + x) * 4;
      const di = (y * W + (x + ox)) * 4;
      sheet.data[di] = img.data[si];
      sheet.data[di + 1] = img.data[si + 1];
      sheet.data[di + 2] = img.data[si + 2];
      sheet.data[di + 3] = 255;
    }
});
fs.writeFileSync(outPng, PNG.sync.write(sheet));
console.log(`wrote ${outPng} (${stamps.length} frames @ ${stamps.join(',')}ms)`);
