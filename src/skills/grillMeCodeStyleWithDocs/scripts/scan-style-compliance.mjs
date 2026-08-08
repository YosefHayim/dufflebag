#!/usr/bin/env node
/**
 * scan-style-compliance.mjs
 * Deterministic style / naming / shallow-layer scan. Read-only.
 *
 * Usage:
 *   node scripts/scan-style-compliance.mjs --root <path> [--out findings.json]
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
  "scraped-yt",
  ".worktrees",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "plugins",
]);

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const DEFAULT_BANNED_LOCALS = new Set([
  "result",
  "response",
  "data",
  "body",
  "payload",
  "row",
  "raw",
  "json",
  "item",
  "tmp",
  "temp",
  "value",
  "output",
  "input",
  "obj",
  "arr",
  "val",
  "res",
  "ret",
]);

const FRAMEWORK_ALLOW = new Set([
  "Response",
  "Request",
  "Headers",
  "FormData",
  "URLSearchParams",
  "Buffer",
  "Error",
  "Promise",
  "Map",
  "Set",
  "Array",
  "Object",
  "JSON",
  "console",
  "process",
  "module",
  "exports",
  "require",
  "window",
  "document",
  "globalThis",
]);

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || process.cwd());
if (!fs.existsSync(root)) {
  console.error(`[ERR] root not found: ${root}`);
  process.exit(1);
}

const projectBanned = loadBannedFromCodeStyle(root);
const bannedLocals = new Set([...DEFAULT_BANNED_LOCALS, ...projectBanned]);

const findings = [];
const stats = { filesScanned: 0, linesScanned: 0 };

for (const name of ["CODE-STYLE.md", "AGENTS.md"]) {
  const alt = name === "CODE-STYLE.md" ? "CodeStyle.md" : null;
  const present = fs.existsSync(path.join(root, name)) || (alt && fs.existsSync(path.join(root, alt)));
  if (!present) {
    findings.push({
      ruleId: "docs.missing",
      severity: "high",
      path: name,
      symbol: null,
      evidence: `Top-level ${name} not found under ${root}`,
      confidence: "mechanical",
      remediation: `Add ${name} (or document why this package inherits parent docs).`,
    });
  }
}

const rulesJsonPath = path.join(root, "code-style.rules.json");
const codeStylePath = ["CODE-STYLE.md", "CodeStyle.md"].map((n) => path.join(root, n)).find((p) => fs.existsSync(p));
if (fs.existsSync(rulesJsonPath) && codeStylePath) {
  try {
    const rulesDoc = JSON.parse(fs.readFileSync(rulesJsonPath, "utf8"));
    const md = fs.readFileSync(codeStylePath, "utf8");
    const rules = Array.isArray(rulesDoc.rules) ? rulesDoc.rules : [];
    for (const rule of rules) {
      const id = rule.id || rule.ruleId;
      if (!id) continue;
      if (!md.includes(id) && !md.includes(`[rule:${id}]`)) {
        findings.push({
          ruleId: "docs.orphan-rule",
          severity: "medium",
          path: "code-style.rules.json",
          symbol: id,
          evidence: `Rule id "${id}" present in JSON but not referenced in ${path.basename(codeStylePath)}`,
          confidence: "mechanical",
          remediation: "Add the rule card to CODE-STYLE.md or remove the orphan id.",
        });
      }
    }
  } catch (err) {
    findings.push({
      ruleId: "docs.missing",
      severity: "low",
      path: "code-style.rules.json",
      symbol: null,
      evidence: `Failed to parse code-style.rules.json: ${err.message}`,
      confidence: "mechanical",
      remediation: "Fix JSON syntax.",
    });
  }
}

walk(root, (absPath, relPath, stat) => {
  if (!stat.isFile()) return;
  const ext = path.extname(absPath);
  if (!SOURCE_EXT.has(ext)) return;
  if (absPath.endsWith(".d.ts")) return;

  let text;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return;
  }
  stats.filesScanned += 1;
  const lines = text.split(/\r?\n/);
  stats.linesScanned += lines.length;

  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  const codeish = nonEmpty.filter((l) => !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));
  if (codeish.length > 0 && codeish.length <= 12) {
    const exportOnly = codeish.every(
      (l) =>
        /^export\s+\{/.test(l) ||
        /^export\s+\*\s+from/.test(l) ||
        /^export\s+\{[^}]+\}\s+from/.test(l) ||
        /^export\s+type\s+\{/.test(l) ||
        /^import\s+/.test(l) ||
        /^export\s+type\s+\*/.test(l),
    );
    if (exportOnly && codeish.some((l) => /from\s+['"]/.test(l))) {
      findings.push({
        ruleId: "structure.shallow-passthrough",
        severity: "low",
        path: relPath,
        symbol: null,
        evidence: codeish.slice(0, 4).join(" | "),
        confidence: "mechanical",
        remediation: "Inline re-exports at the consumer or give this module real domain behavior.",
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;

    const decl = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?\s*=/);
    if (decl) {
      const name = decl[1];
      if (bannedLocals.has(name) && !FRAMEWORK_ALLOW.has(name)) {
        findings.push({
          ruleId: "naming.no-generic-local",
          severity: "medium",
          path: relPath,
          symbol: name,
          line: lineNo,
          evidence: line.trim().slice(0, 200),
          confidence: "mechanical",
          remediation: `Rename \`${name}\` to the domain concept it holds.`,
        });
      }
    }

    const paramHits = [...line.matchAll(/\(([^)]*)\)\s*(?::\s*[^{\n]+)?\s*=>/g)];
    for (const m of paramHits) {
      flagParams(m[1], relPath, lineNo, line, findings, bannedLocals);
    }
    const fnHits = [...line.matchAll(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)];
    for (const m of fnHits) {
      flagParams(m[1], relPath, lineNo, line, findings, bannedLocals);
    }

    const mapper = line.match(
      /\b(?:function\s+|const\s+|let\s+|export\s+(?:async\s+)?function\s+|export\s+const\s+)((?:to|build|resolve)[A-Z][A-Za-z0-9_]*)\b/,
    );
    if (mapper) {
      findings.push({
        ruleId: "naming.no-vague-mapper",
        severity: "medium",
        path: relPath,
        symbol: mapper[1],
        line: lineNo,
        evidence: line.trim().slice(0, 200),
        confidence: "mechanical",
        remediation:
          "If this only reshapes data, collapse into the domain operation; otherwise rename with a domain verb.",
      });
    }
  }
});

const MAX = 2000;
const truncated = findings.length > MAX;
const limited = truncated ? findings.slice(0, MAX) : findings;

const report = {
  root,
  generatedAt: new Date().toISOString(),
  stats,
  bannedLocals: [...bannedLocals].sort(),
  findingCount: findings.length,
  truncated,
  findings: limited,
};

const text = `${JSON.stringify(report, null, 2)}\n`;
if (args.out) {
  fs.writeFileSync(path.resolve(args.out), text, "utf8");
  console.error(`[INFO] ${findings.length} findings; scanned ${stats.filesScanned} files → ${args.out}`);
} else {
  process.stdout.write(text);
}

function flagParams(paramList, relPath, lineNo, line, findingsList, banned) {
  if (!paramList || !paramList.trim()) return;
  const parts = paramList
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (part.startsWith("...") || part.startsWith("{") || part.startsWith("[")) continue;
    const name = part.replace(/\?$/, "").split(":")[0].trim();
    if (!name || !banned.has(name)) continue;
    findingsList.push({
      ruleId: "naming.no-generic-local",
      severity: "medium",
      path: relPath,
      symbol: name,
      line: lineNo,
      evidence: line.trim().slice(0, 200),
      confidence: "mechanical",
      remediation: `Rename parameter \`${name}\` to a domain name.`,
    });
  }
}

function loadBannedFromCodeStyle(rootDir) {
  const extra = new Set();
  for (const name of ["CODE-STYLE.md", "CodeStyle.md"]) {
    const p = path.join(rootDir, name);
    if (!fs.existsSync(p)) continue;
    const md = fs.readFileSync(p, "utf8");
    const avoid = md.match(/Avoid:\s*([^\n]+)/i);
    if (avoid) {
      for (const token of avoid[1].matchAll(/`([^`]+)`/g)) {
        const t = token[1].trim();
        if (/^[a-z][a-z0-9_]*$/.test(t)) extra.add(t);
      }
    }
  }
  return extra;
}

function walk(dir, onFile) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (IGNORE_DIR_NAMES.has(ent.name)) continue;
    if (ent.name.startsWith(".") && ent.isDirectory() && ent.name !== ".github") continue;
    const abs = path.join(dir, ent.name);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(abs, onFile);
    else onFile(abs, path.relative(root, abs) || ".", stat);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") out.root = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--inventory") out.inventory = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node scripts/scan-style-compliance.mjs --root <path> [--out findings.json]");
      process.exit(0);
    }
  }
  return out;
}
