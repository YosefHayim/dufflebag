#!/usr/bin/env node
/** List SVG paths overlapping the arm region in a trace file. */
import fs from "node:fs";
import { argString, parseArgs } from "../../src/lib/index.js";

const args = parseArgs(process.argv.slice(2));
const svgPath = argString(args, "input") || "out/trace1.svg";
const svg = fs.readFileSync(svgPath, "utf8");
const paths = svg.match(/<path[\s\S]*?\/>/g) || [];

const meta = (tag: string) => {
  const d = (tag.match(/ d="([^"]*)"/) || [])[1] || "";
  const m = tag.match(/transform="translate\(([-\d.]+),([-\d.]+)\)"/);
  const tx = m ? +m[1] : 0,
    ty = m ? +m[2] : 0;
  const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) || [];
  let a = 1e9,
    b = 1e9,
    c = -1e9,
    e = -1e9;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i] + tx,
      y = nums[i + 1] + ty;
    if (x < a) a = x;
    if (x > c) c = x;
    if (y < b) b = y;
    if (y > e) e = y;
  }
  return { minX: a, minY: b, maxX: c, maxY: e, w: c - a, h: e - b, n: nums.length / 2 };
};

const fillOf = (t: string) => (t.match(/fill="(#[0-9A-Fa-f]{6})"/) || [])[1] || "?";
const R = [260, 460, 545, 1070];
const overlap = (b: ReturnType<typeof meta>) => b.maxX >= R[0] && b.minX <= R[2] && b.maxY >= R[1] && b.minY <= R[3];

paths.forEach((p, i) => {
  const b = meta(p);
  const f = fillOf(p);
  if (overlap(b)) console.log(`#${i} f=${f} bb=(${b.minX | 0},${b.minY | 0} ${b.w | 0}x${b.h | 0}) pts=${b.n}`);
});
console.log("total paths", paths.length);
