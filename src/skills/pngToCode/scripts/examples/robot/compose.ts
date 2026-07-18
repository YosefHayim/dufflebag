// Compose the animated robot from a clean two-layer trace (robot case study).
import fs from "node:fs";
import path from "node:path";
import { argString, parseArgs } from "../../src/lib/index.js";

const args = parseArgs(process.argv.slice(2));
const outDir = argString(args, "out-dir") || "out";
const rel = (name: string) => path.join(outDir, name);

const read = (file: string) => fs.readFileSync(file, "utf8");
const paths = (svg: string) => svg.match(/<path[\s\S]*?\/>/g) || [];
const fillOf = (tag: string) => (tag.match(/fill="(#[0-9A-Fa-f]{6})"/) || [])[1] || "#000000";
const isGreen = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  return g > 150 && r < 120 && b < 120;
};
const centerOf = (tag: string) => {
  const d = (tag.match(/ d="([^"]*)"/) || [])[1] || "";
  const m = tag.match(/transform="translate\(([-\d.]+),([-\d.]+)\)"/);
  const tx = m ? +m[1] : 0,
    ty = m ? +m[2] : 0;
  const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) || [];
  let minX = 1e9,
    minY = 1e9,
    maxX = -1e9,
    maxY = -1e9;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i] + tx,
      y = nums[i + 1] + ty;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
};

// Eyes and sparkles are small features. A region hit on a LARGE path (e.g. the whole
// head+body path, whose centroid happens to land in a region) must be rejected, or it
// gets pulled on top of everything and hides the face.
const SMALL = (c: { w: number; h: number }) => c.w < 150 && c.h < 150;

// Eye irises + glints (measured from the trace). Mouth sits below and is excluded.
const EYE_L = { x0: 600, x1: 655, y0: 455, y1: 520, ox: 623, oy: 486 };
const EYE_R = { x0: 745, x1: 805, y0: 455, y1: 525, ox: 769, oy: 491 };
const inEye = (e: { x0: number; x1: number; y0: number; y1: number }, c: { cx: number; cy: number }) =>
  c.cx >= e.x0 && c.cx <= e.x1 && c.cy >= e.y0 && c.cy <= e.y1;

// Sparkle centers (from connected-component detection); twinkle each in place.
const SPARKLES = [
  { cx: 1008, cy: 220, dur: 3.2, delay: 0 },
  { cx: 1056, cy: 343, dur: 2.4, delay: -0.8 },
  { cx: 1035, cy: 687, dur: 2.8, delay: -1.5 },
  { cx: 239, cy: 787, dur: 2.2, delay: -0.5 },
];
const nearSparkle = (c: { cx: number; cy: number }) => SPARKLES.findIndex((s) => Math.abs(c.cx - s.cx) < 45 && Math.abs(c.cy - s.cy) < 55);

// The wave pivots at the WRIST (where the palm narrows into the forearm). Only the hand
// turns; the planted forearm hides the junction, so the rock never opens a gap. Measured
// from the hand trace, the palm meets the forearm at ~{355,678}.
const WRIST = { x: 355, y: 678 };

// The soft lavender BACKGROUND cloud (the amoeba behind the robot) was missing from the base
// trace — and the strict pixel diff is blind to it, because pale lavender (#f4edfd) vs page
// white (#fefefe) falls under pixelmatch's colour threshold (it scored ~1% while a whole element
// was gone). extract-blob.ts rebuilds it from robot.png as a path; we lay it BEHIND everything,
// softly blurred to match the feathered original. The robot's opaque paths cover the part of the
// blob inside its footprint, so only the true background cloud shows through.
const blobPaths = paths(read(rel("blob.svg")));

// The base trace opens with a full-canvas near-white page fill. It must render BELOW the blob,
// or it paints over the cloud — so we pull it out and draw it first, then blob, then the robot.
const isNearWhite = (hex: string) =>
  parseInt(hex.slice(1, 3), 16) > 248 && parseInt(hex.slice(3, 5), 16) > 248 && parseInt(hex.slice(5, 7), 16) > 248;

// --- classify body paths into page-bg / eyes / sparkles / base ---
const leftEye: string[] = [],
  rightEye: string[] = [],
  restBase: string[] = [];
const sparkleBuckets: string[][] = SPARKLES.map(() => []);
let pageBg = "";
for (const tag of paths(read(rel("base.svg")))) {
  const c = centerOf(tag);
  if (!pageBg && c.w > 1000 && c.h > 1000 && isNearWhite(fillOf(tag))) pageBg = tag;
  else if (SMALL(c) && inEye(EYE_L, c)) leftEye.push(tag);
  else if (SMALL(c) && inEye(EYE_R, c)) rightEye.push(tag);
  else restBase.push(tag);
}

for (const tag of paths(read(rel("body2.svg")))) {
  const c = centerOf(tag);
  const s = nearSparkle(c);
  if (SMALL(c) && s >= 0) sparkleBuckets[s].push(tag);
}

const handPaths = paths(read(rel("hand.svg"))).filter((tag) => !isGreen(fillOf(tag)));
const handClip = (read(rel("hand-clip.svg")).match(/<path[\s\S]*?\/>/) || [""])[0];

const sparkleEls = SPARKLES.map(
  (s, i) =>
    `<g class="twinkle" style="animation-duration:${s.dur}s;animation-delay:${s.delay}s;transform-origin:${s.cx}px ${s.cy}px">\n${sparkleBuckets[i].join("\n")}\n</g>`,
).join("\n");

const style = `
  .bot { animation: float 5s ease-in-out infinite; }
  /* The hand rocks side-to-side about the wrist (view-box space): a natural "hello". It
     rocks twice in the first ~58% then HOLDS upright, so it greets and pauses. */
  .wave { animation: wave 3.4s ease-in-out infinite; transform-box: view-box; transform-origin: ${WRIST.x}px ${WRIST.y}px; }
  .eye { animation: blink 4.6s ease-in-out infinite; transform-box: view-box; }
  .eye-l { transform-origin: ${EYE_L.ox}px ${EYE_L.oy}px; }
  .eye-r { transform-origin: ${EYE_R.ox}px ${EYE_R.oy}px; }
  .twinkle { animation-name: twinkle; animation-timing-function: ease-in-out; animation-iteration-count: infinite; transform-box: view-box; }
  @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
  @keyframes wave {
    0% { transform: rotate(0deg); }
    9% { transform: rotate(-13deg); }  /* rock out (away from face) */
    22% { transform: rotate(9deg); }   /* rock in */
    35% { transform: rotate(-13deg); } /* rock out */
    48% { transform: rotate(9deg); }   /* rock in */
    58% { transform: rotate(0deg); }   /* settle upright */
    100% { transform: rotate(0deg); }  /* hold ~42% of the cycle */
  }
  @keyframes blink { 0%,92%,100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
  @keyframes twinkle { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.78); opacity: 0.5; } }
  /* Drifting aurora: soft violet/pink glows that slide and bloom over the lavender cloud,
     each on its own slow out-of-phase loop. They rest at opacity 0, so a frozen or
     reduced-motion view falls back to the exact original cloud — the motion is layered on
     top of the 1:1 still, never baked into it. */
  .au { opacity: 0; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
  .au1 { animation-name: drift1; animation-duration: 19s; }
  .au2 { animation-name: drift2; animation-duration: 24s; }
  .au3 { animation-name: drift3; animation-duration: 29s; }
  @keyframes drift1 { 0%,100% { transform: translate(0,0); opacity: 0; } 35% { transform: translate(34px,-22px); opacity: 0.55; } 70% { transform: translate(-16px,16px); opacity: 0.32; } }
  @keyframes drift2 { 0%,100% { transform: translate(0,0); opacity: 0; } 40% { transform: translate(-28px,20px); opacity: 0.5; } 72% { transform: translate(22px,-12px); opacity: 0.28; } }
  @keyframes drift3 { 0%,100% { transform: translate(0,0); opacity: 0; } 50% { transform: translate(20px,24px); opacity: 0.42; } }
  @media (prefers-reduced-motion: reduce) { .bot,.wave,.eye,.twinkle,.au { animation: none !important; } }
`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254">
<style>${style}</style>
<defs>
<filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="glow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="26"/></filter>
<radialGradient id="auA"><stop offset="0%" stop-color="#c4b5fd"/><stop offset="100%" stop-color="#c4b5fd" stop-opacity="0"/></radialGradient>
<radialGradient id="auB"><stop offset="0%" stop-color="#f0abfc"/><stop offset="100%" stop-color="#f0abfc" stop-opacity="0"/></radialGradient>
<radialGradient id="auC"><stop offset="0%" stop-color="#ddd6fe"/><stop offset="100%" stop-color="#ddd6fe" stop-opacity="0"/></radialGradient>
<clipPath id="handClip" clipPathUnits="userSpaceOnUse">${handClip}</clipPath>
</defs>
<g class="bot">
${pageBg}
<g class="blob" filter="url(#soft)">
${blobPaths.join("\n")}
</g>
<g class="aurora" filter="url(#glow)">
<ellipse class="au au1" cx="320" cy="540" rx="230" ry="190" fill="url(#auA)"/>
<ellipse class="au au2" cx="250" cy="720" rx="200" ry="170" fill="url(#auB)"/>
<ellipse class="au au3" cx="470" cy="640" rx="210" ry="180" fill="url(#auC)"/>
</g>
${restBase.join("\n")}
<g class="eye eye-l">
${leftEye.join("\n")}
</g>
<g class="eye eye-r">
${rightEye.join("\n")}
</g>
<g class="sparkles">
${sparkleEls}
</g>
<g class="wave" clip-path="url(#handClip)">
${handPaths.join("\n")}
</g>
</g>
</svg>`;

const svgOut = argString(args, "svg-out") || "robot.svg";
const htmlOut = argString(args, "html-out") || "robot.html";

fs.writeFileSync(svgOut, svg);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Robot — animated SVG</title>
<style>
  html,body { margin:0; height:100%; }
  body { display:grid; place-items:center; background:#ffffff; }
  .stage { width:min(80vmin,620px); aspect-ratio:1; }
  .stage svg { width:100%; height:100%; display:block; }
</style>
</head>
<body>
  <div class="stage">${svg}</div>
</body>
</html>`;
fs.writeFileSync(htmlOut, html);

console.log(
  `blob: ${blobPaths.length} | base: ${restBase.length} | eyes L/R: ${leftEye.length}/${rightEye.length} | ` +
    `sparkles: ${sparkleBuckets.map((b) => b.length).join(",")} | hand: ${handPaths.length} (clipped to silhouette)`,
);
console.log(`wrote ${svgOut} + ${htmlOut}`);
