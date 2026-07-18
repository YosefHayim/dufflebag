#!/usr/bin/env node
/** List large face-region paths in a body SVG trace. */
import fs from "node:fs";
import { argString, parseArgs } from "../../src/lib/index.js";

const args = parseArgs(process.argv.slice(2));
const svgPath = argString(args, "input") || "out/body2.svg";
const svg = fs.readFileSync(svgPath, "utf8");
const ps = svg.match(/<path[\s\S]*?\/>/g) || [];

const c = (t: string) => {
  const d = (t.match(/ d="([^"]*)"/) || [])[1] || "";
  const m = t.match(/transform="translate\(([-\d.]+),([-\d.]+)\)"/);
  const tx = m ? +m[1] : 0,
    ty = m ? +m[2] : 0;
  const n = d.match(/-?\d+\.?\d*/g)?.map(Number) || [];
  let a = 1e9,
    b = 1e9,
    X = -1e9,
    Y = -1e9;
  for (let i = 0; i + 1 < n.length; i += 2) {
    const x = n[i] + tx,
      y = n[i + 1] + ty;
    if (x < a) a = x;
    if (x > X) X = x;
    if (y < b) b = y;
    if (y > Y) Y = y;
  }
  return { cx: (a + X) / 2, cy: (b + Y) / 2, w: X - a, h: Y - b };
};
const f = (t: string) => (t.match(/fill="(#[0-9A-Fa-f]{6})"/) || [])[1];

let n = 0;
ps.forEach((p, i) => {
  const b = c(p);
  if (b.cx > 540 && b.cx < 860 && b.cy > 380 && b.cy < 600 && b.w > 40) {
    console.log(`#${i} ${f(p)} c=(${b.cx | 0},${b.cy | 0}) ${b.w | 0}x${b.h | 0}`);
    n++;
  }
});
console.log("total paths", ps.length, "big face paths", n);
