#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
/** Rig the robot arm: produce arm.png (green key) and body.png (arm hole filled). */
import { PNG } from "pngjs";
import { argString, inPoly, parseArgs } from "../../src/lib/index.js";

const args = parseArgs(process.argv.slice(2));
const srcPath = argString(args, "input") || "robot.png";
const outDir = argString(args, "out-dir") || "out";

const png = PNG.sync.read(fs.readFileSync(srcPath));
const { width: W, height: H } = png;

const ARM: [number, number][] = [
  [292, 452],
  [380, 452],
  [404, 498],
  [414, 562],
  [434, 618],
  [466, 688],
  [498, 748],
  [528, 798],
  [505, 840],
  [455, 830],
  [410, 808],
  [366, 758],
  [332, 694],
  [314, 628],
  [298, 556],
  [286, 488],
];

const px = (img: PNG, x: number, y: number): [number, number, number] => {
  const i = (y * W + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const setpx = (img: PNG, x: number, y: number, rgb: [number, number, number]) => {
  const i = (y * W + x) * 4;
  img.data[i] = rgb[0];
  img.data[i + 1] = rgb[1];
  img.data[i + 2] = rgb[2];
  img.data[i + 3] = 255;
};

const arm = new PNG({ width: W, height: H });
png.data.copy(arm.data);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!inPoly(x, y, ARM)) setpx(arm, x, y, [0, 255, 0]);

const body = new PNG({ width: W, height: H });
png.data.copy(body.data);
for (let y = 0; y < H; y++) {
  let lo = W,
    hi = -1;
  for (let x = 0; x < W; x++)
    if (inPoly(x, y, ARM)) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  if (hi < 0) continue;
  const sample = (x0: number, dir: number): [number, number, number] => {
    let x = x0;
    for (let k = 0; k < 48; k++) {
      const xc = Math.max(0, Math.min(W - 1, x));
      const [r, g, b] = px(png, xc, y);
      if (Math.max(r, g, b) > 150) return [r, g, b];
      x += dir;
    }
    return [240, 235, 248];
  };
  const left = sample(lo - 2, -1);
  const right = sample(hi + 2, +1);
  const mid = (lo + hi) / 2;
  for (let x = lo; x <= hi; x++) setpx(body, x, y, x < mid ? left : right);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "arm.png"), PNG.sync.write(arm));
fs.writeFileSync(path.join(outDir, "body.png"), PNG.sync.write(body));
console.log(`wrote ${outDir}/arm.png + ${outDir}/body.png`);
