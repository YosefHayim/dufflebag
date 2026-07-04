#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
/** Scale arm/body PNGs and stitch for mask quality check. */
import { PNG } from "pngjs";
import { argString, parseArgs } from "../../src/lib/index.js";

const args = parseArgs(process.argv.slice(2));
const outDir = argString(args, "out-dir") || "out";

const scale = (src: string, name: string, S = 460) => {
  const p = PNG.sync.read(fs.readFileSync(src));
  const o = new PNG({ width: S, height: S });
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const sx = ((x * p.width) / S) | 0,
        sy = ((y * p.height) / S) | 0;
      const si = (sy * p.width + sx) * 4,
        di = (y * S + x) * 4;
      o.data[di] = p.data[si];
      o.data[di + 1] = p.data[si + 1];
      o.data[di + 2] = p.data[si + 2];
      o.data[di + 3] = 255;
    }
  fs.writeFileSync(name, PNG.sync.write(o));
};

scale(path.join(outDir, "arm.png"), path.join(outDir, "arm-chk.png"));
scale(path.join(outDir, "body.png"), path.join(outDir, "body-chk.png"));
const a = PNG.sync.read(fs.readFileSync(path.join(outDir, "arm-chk.png")));
const b = PNG.sync.read(fs.readFileSync(path.join(outDir, "body-chk.png")));
const W = 460 * 2 + 16;
const c = new PNG({ width: W, height: 460 });
c.data.fill(240);
const paste = (img: PNG, ox: number) => {
  for (let y = 0; y < 460; y++)
    for (let x = 0; x < 460; x++) {
      const si = (y * 460 + x) * 4;
      const di = (y * W + x + ox) * 4;
      c.data[di] = img.data[si];
      c.data[di + 1] = img.data[si + 1];
      c.data[di + 2] = img.data[si + 2];
      c.data[di + 3] = 255;
    }
};
paste(a, 0);
paste(b, 476);
fs.writeFileSync(path.join(outDir, "mask-chk.png"), PNG.sync.write(c));
console.log("ok");
