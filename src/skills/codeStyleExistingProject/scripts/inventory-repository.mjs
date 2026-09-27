#!/usr/bin/env node
/**
 * inventory-repository.mjs
 * Discover instruction docs, packages, and likely feature slices.
 * Read-only. Writes JSON to stdout (or --out path).
 *
 * Usage:
 *   node scripts/inventory-repository.mjs --root <path> [--out inventory.json]
 */

import fs from "node:fs";
import path from "node:path";

const IGNORE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
  "tmp",
  "tmp-oly-verify",
  "scraped-yt",
  ".worktrees",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

const DOC_NAMES = [
  "AGENTS.md",
  "CODE-STYLE.md",
  "CodeStyle.md",
  "code-style.rules.json",
  "PROJECT.md",
  "CONTEXT.md",
  "LANGUAGE.md",
  "README.md",
  "CLAUDE.md",
  "GEMINI.md",
];

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || process.cwd());
if (!fs.existsSync(root)) {
  console.error(`[ERR] root not found: ${root}`);
  process.exit(1);
}

const docs = [];
const packages = [];
const slices = [];
const sourceFiles = [];

walk(root, (absPath, relPath, stat) => {
  if (stat.isDirectory()) {
    const pkgJson = path.join(absPath, "package.json");
    if (fs.existsSync(pkgJson) && absPath !== root) {
      packages.push({
        path: rel(root, absPath),
        packageJson: rel(root, pkgJson),
      });
    }
    const base = path.basename(absPath);
    if (/(?:^|\/)(?:features|modules|domains|slices|app)(?:\/|$)/i.test(relPath) || base.startsWith("(")) {
      const children = safeList(absPath).filter((name) => {
        const child = path.join(absPath, name);
        try {
          return fs.statSync(child).isDirectory() && !IGNORE_DIR_NAMES.has(name);
        } catch {
          return false;
        }
      });
      if (children.length) {
        slices.push({
          path: rel(root, absPath),
          children: children.slice(0, 80),
        });
      }
    }
    return;
  }

  const base = path.basename(absPath);
  if (DOC_NAMES.includes(base)) {
    docs.push({
      name: base,
      path: rel(root, absPath),
      scope: rel(root, path.dirname(absPath)) || ".",
      bytes: stat.size,
    });
  }

  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/.test(base) && !base.endsWith(".d.ts")) {
    if (sourceFiles.length < 50000) {
      sourceFiles.push(rel(root, absPath));
    }
  }

  if (base === "package.json" && path.dirname(absPath) === root) {
    packages.unshift({ path: ".", packageJson: rel(root, absPath) });
  }
});

const adrRoots = ["docs/adr", "docs/adrs", "adr", "docs/decisions"];
for (const adr of adrRoots) {
  const abs = path.join(root, adr);
  if (fs.existsSync(abs)) {
    docs.push({
      name: "ADR-tree",
      path: adr,
      scope: adr,
      bytes: 0,
      note: "decision records directory present",
    });
  }
}

const topDocs = new Set(docs.filter((d) => d.scope === ".").map((d) => d.name));
const missingTop = [];
for (const expected of ["AGENTS.md", "CODE-STYLE.md", "README.md"]) {
  if (expected === "CODE-STYLE.md" && topDocs.has("CodeStyle.md")) continue;
  if (!topDocs.has(expected)) missingTop.push(expected);
}

const inventory = {
  root,
  generatedAt: new Date().toISOString(),
  docs,
  packages,
  slices: slices.slice(0, 200),
  sourceFileCount: sourceFiles.length,
  sourceSample: sourceFiles.slice(0, 40),
  missingTopLevelDocs: missingTop,
  contradictions: [],
};

const text = `${JSON.stringify(inventory, null, 2)}\n`;
if (args.out) {
  fs.writeFileSync(path.resolve(args.out), text, "utf8");
  console.error(`[INFO] wrote ${args.out}`);
} else {
  process.stdout.write(text);
}

function walk(dir, onEntry) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (IGNORE_DIR_NAMES.has(ent.name)) continue;
    if (ent.name.startsWith(".") && ent.name !== ".github") {
      if (ent.isDirectory()) continue;
    }
    const abs = path.join(dir, ent.name);
    const relPath = rel(root, abs);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    onEntry(abs, relPath, stat);
    if (stat.isDirectory()) walk(abs, onEntry);
  }
}

function rel(from, to) {
  const r = path.relative(from, to);
  return r || ".";
}

function safeList(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") out.root = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node scripts/inventory-repository.mjs --root <path> [--out file.json]");
      process.exit(0);
    }
  }
  return out;
}
