/**
 * dupIndex — the agent-agnostic AST core behind the `dedup-guard` feature.
 *
 * It answers one cross-file question: "does the function body or object-type
 * shape I'm about to write already exist in this repo?" — which a single pending
 * edit can't answer alone. It builds a repo-wide index of (a) object-type
 * signatures and (b) function-body fingerprints, so every consumer (the Claude
 * PreToolUse hook, the Cursor afterFileEdit hook, the `dedup check` command)
 * stays a thin matcher on top of it. Ported from Oly-App's `dupIndex.cjs`
 * (docs/adr/0024 there documents the deliberate max-recall stance), generalized
 * to any repo and to dufflebag's ESM, zero-bundled-dependency payload model.
 *
 * WHY `typescript` IS NOT BUNDLED: a faithful, rename-proof fingerprint needs a
 * real TS parse, but dufflebag's hook payload must stay dependency-free. So we
 * resolve the **guarded repo's own** `typescript` at runtime ({@link
 * loadTypeScript}) — every TS repo already has it, and dedup only makes sense in
 * a TS repo anyway. Compile-time types come from dufflebag's devDependency via
 * a type-only import (erased at build), so the shipped JS carries no `typescript`
 * reference of its own. If the repo has no `typescript`, callers fail open.
 *
 * FAIL-SOFT: every entry point degrades to "no findings" on any internal error
 * (missing `typescript`, unreadable file, parser quirk) — a guard must never
 * brick legitimate editing because of its own bug.
 */

import { createHash } from "node:crypto";
import { type Dirent, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import type * as TS from "typescript";

/** A declaration's location, used both as a match target and for display. */
export interface Decl {
  name: string;
  /** Repo-relative POSIX path. */
  file: string;
  /** 1-based line of the declaration. */
  line: number;
  /** True when the declaration's line carries a `// dup-ignore` escape hatch. */
  ignored?: boolean;
}

/** An object-type (interface / type-literal) entry: its name + canonical shape signature. */
export interface TypeEntry {
  name: string;
  sig: string;
  line: number;
  ignored?: boolean;
}

/** A named-function entry: its name + alpha-canonical body fingerprint. */
export interface FnEntry {
  name: string;
  fp: string;
  line: number;
  ignored?: boolean;
}

/** Everything extracted from one source text. */
export interface ExtractResult {
  types: TypeEntry[];
  fns: FnEntry[];
}

/** The two lookup maps that make duplicate detection O(1) per candidate. */
export interface DupIndex {
  /** type signature → every declaration with that shape. */
  typeSig: Map<string, Decl[]>;
  /** function body fingerprint → every declaration with that body. */
  fnFp: Map<string, Decl[]>;
}

/** A single duplicate finding: a candidate declaration that collides with an existing one. */
export interface DupHit {
  kind: "function" | "type";
  name: string;
  /** 1-based line within the candidate text. */
  line: number;
  existing: Decl;
}

/**
 * Directory names never worth indexing in any repo (generated output, vendored
 * deps, VCS, native build trees). Repo-specific additions come from the caller
 * (e.g. VybeKiit adds `templates`, which holds intentional near-duplicate
 * scaffolds). Kept generic — none of Oly-App's app-specific entries leak in.
 */
export const DEFAULT_SKIP_DIRS: readonly string[] = [
  "node_modules",
  ".git",
  ".claude",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".vercel",
  ".svelte-kit",
  ".expo",
  "ios",
  "android",
  "Pods",
];

const CACHE_VERSION = 1;
/** A `.ts`/`.tsx` source file (not a `.d.ts` ambient declaration). Works on a basename or a full path. */
export const isSourcePath = (name: string): boolean =>
  // e.g. "foo.ts", "bar.tsx" — not "foo.js" or "foo.d.ts"
  /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);
const normalizeWhitespace = (text: string): string =>
  // e.g. "a \n\t b" → "a b"
  text.replace(/\s+/g, " ").trim();

/**
 * Resolve and load the guarded repo's own `typescript`. Returns null (→ caller
 * fails open) when the repo has no `typescript` installed — expected for non-TS
 * or dependency-free repos, where dedup simply can't run.
 */
export function loadTypeScript(repoRoot: string): typeof TS | null {
  try {
    const require = createRequire(path.join(repoRoot, "noop.js"));
    const resolved = require.resolve("typescript", { paths: [repoRoot] });
    return require(resolved) as typeof TS;
  } catch {
    return null;
  }
}

/**
 * The repo root to index: Claude/Codex set `CLAUDE_PROJECT_DIR`; otherwise fall
 * back to the provided cwd (the `dedup check` command passes its target path).
 */
export function resolveRepoRoot(cwd: string = process.cwd()): string {
  return process.env.CLAUDE_PROJECT_DIR || cwd;
}

/** Parse the `dufflebagDedupSkipDirectories` value (comma/space list) into extra skip-dir names. */
export function parseSkipList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    // e.g. "vendor, generated  tmp" → ["vendor","generated","tmp"]
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Absolute path → repo-relative POSIX path (stable cache + display key). */
export function relFromAbs(repoRoot: string, absPath: string): string {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

// ── Type signatures ─────────────────────────────────────────────────────────

/** Canonical, order-independent signature of an object type's members. */
function canonicalMembers(ts: typeof TS, members: readonly TS.TypeElement[], sourceFile: TS.SourceFile): string {
  const parts: string[] = [];
  for (const member of members) {
    if (ts.isPropertySignature(member) && member.name) {
      const name = member.name.getText(sourceFile);
      const optional = member.questionToken ? "?" : "";
      const readonly = (member.modifiers ?? []).some((mod) => mod.kind === ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
      const typeText = member.type ? normalizeWhitespace(member.type.getText(sourceFile)) : "any";
      parts.push(`${readonly}${name}${optional}:${typeText}`);
    } else {
      parts.push(normalizeWhitespace(member.getText(sourceFile)));
    }
  }
  parts.sort();
  return parts.join(";");
}

/** Heritage (`extends A, B`) folded in so `extends X {a}` and a bare `{a}` don't collide. */
function heritageToken(node: TS.InterfaceDeclaration, sourceFile: TS.SourceFile): string {
  if (!node.heritageClauses || node.heritageClauses.length === 0) return "";
  const bases: string[] = [];
  for (const clause of node.heritageClauses) {
    for (const type of clause.types) bases.push(normalizeWhitespace(type.getText(sourceFile)));
  }
  bases.sort();
  return `|H:${bases.join(",")}`;
}

/** Type/interface object-shape signature for `node`, or null if it isn't one. */
function typeSignature(ts: typeof TS, node: TS.Node, sourceFile: TS.SourceFile): { name: string; sig: string } | null {
  if (ts.isInterfaceDeclaration(node)) {
    return { name: node.name.text, sig: canonicalMembers(ts, node.members, sourceFile) + heritageToken(node, sourceFile) };
  }
  if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
    return { name: node.name.text, sig: canonicalMembers(ts, node.type.members, sourceFile) };
  }
  return null;
}

// ── Function fingerprints ────────────────────────────────────────────────────

/** Collect the identifier text of every binding name (handles destructuring). */
function collectBindingNames(ts: typeof TS, name: TS.BindingName | undefined, set: Set<string>): void {
  if (!name) return;
  if (ts.isIdentifier(name)) {
    set.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingNames(ts, element.name, set);
  }
}

/** Every name BOUND inside the function (params, locals, nested fn names, catch vars). */
function collectBound(ts: typeof TS, params: readonly TS.ParameterDeclaration[], body: TS.Node): Set<string> {
  const set = new Set<string>();
  for (const param of params) collectBindingNames(ts, param.name, set);
  const walk = (node: TS.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      collectBindingNames(ts, node.name, set);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      set.add(node.name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      collectBindingNames(ts, node.variableDeclaration.name, set);
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return set;
}

/**
 * Alpha-canonical structural fingerprint of a function body. Two bodies that
 * differ only by formatting, comments, or a consistent rename of locals/params
 * produce the same string; a changed operator, literal, or free name does not.
 */
function fingerprintBody(ts: typeof TS, params: readonly TS.ParameterDeclaration[], body: TS.Node): string {
  const bound = collectBound(ts, params, body);
  const placeholder = new Map<string, string>();
  let paramCount = 0;
  let localCount = 0;
  const seed = (name: TS.BindingName | undefined): void => {
    if (!name) return;
    if (ts.isIdentifier(name)) {
      if (!placeholder.has(name.text)) placeholder.set(name.text, `P${paramCount++}`);
    } else {
      for (const element of name.elements) if (ts.isBindingElement(element)) seed(element.name);
    }
  };
  for (const param of params) seed(param.name);

  const ser = (node: TS.Node | undefined): string => {
    if (!node) return "";
    if (ts.isIdentifier(node)) {
      if (bound.has(node.text)) {
        let ph = placeholder.get(node.text);
        if (!ph) {
          ph = `L${localCount++}`;
          placeholder.set(node.text, ph);
        }
        return `#${ph}`;
      }
      return `@${node.text}`;
    }
    if (ts.isStringLiteralLike(node)) return `S${JSON.stringify(node.text)}`;
    if (ts.isNumericLiteral(node)) return `N${node.text}`;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
    if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
    if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
    if (ts.isPropertyAccessExpression(node)) return `PA(${ser(node.expression)}.${node.name.text})`;
    if (ts.isBinaryExpression(node)) return `B${node.operatorToken.kind}(${ser(node.left)},${ser(node.right)})`;
    if (ts.isPrefixUnaryExpression(node)) return `U${node.operator}(${ser(node.operand)})`;
    if (ts.isPostfixUnaryExpression(node)) return `PU${node.operator}(${ser(node.operand)})`;
    let out = `K${node.kind}(`;
    let first = true;
    ts.forEachChild(node, (child) => {
      out += (first ? "" : ",") + ser(child);
      first = false;
    });
    return `${out})`;
  };

  return `A${params.length}|${ser(body)}`;
}

/** A NAMED function-like (declaration, assigned arrow/expr, method) → its name + fingerprint, or null. */
function functionFingerprint(ts: typeof TS, node: TS.Node): { name: string; fp: string } | null {
  if (ts.isFunctionDeclaration(node) && node.name && node.body) {
    return { name: node.name.text, fp: fingerprintBody(ts, node.parameters, node.body) };
  }
  if (ts.isMethodDeclaration(node) && node.name && node.body) {
    return { name: node.name.getText(), fp: fingerprintBody(ts, node.parameters, node.body) };
  }
  if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) {
    const init = node.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body && node.name) {
      return { name: node.name.getText(), fp: fingerprintBody(ts, init.parameters, init.body) };
    }
  }
  return null;
}

// ── Extraction + index assembly ──────────────────────────────────────────────

/** Parse `text` once and pull every type + function entry, with 1-based lines. */
function extractEntries(ts: typeof TS, text: string, fileName: string): ExtractResult {
  // e.g. "Button.tsx" → TSX; "util.ts" → TS
  const scriptKind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName || "snippet.tsx", text, ts.ScriptTarget.Latest, true, scriptKind);
  const types: TypeEntry[] = [];
  const fns: FnEntry[] = [];
  const lines = text.split("\n");
  const lineOf = (node: TS.Node): number => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const ignoredAt = (line: number): boolean => (lines[line - 1] ?? "").includes("dup-ignore");
  const visit = (node: TS.Node): void => {
    const t = typeSignature(ts, node, sourceFile);
    if (t) {
      const line = lineOf(node);
      types.push({ ...t, line, ignored: ignoredAt(line) });
    }
    const f = functionFingerprint(ts, node);
    if (f) {
      const line = lineOf(node);
      fns.push({ ...f, line, ignored: ignoredAt(line) });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { types, fns };
}

/** Extract entries from an in-memory snippet (a pending edit's added text). Fail-soft. */
export function extractFromText(ts: typeof TS, text: string, fileName: string): ExtractResult {
  try {
    return extractEntries(ts, text, fileName);
  } catch {
    return { types: [], fns: [] };
  }
}

/** Recursively collect indexable source files under `dir`, honoring the skip set. */
function listSourceFiles(dir: string, skip: Set<string>, out: string[]): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skip.has(entry.name) || entry.name.startsWith("cdk.out")) continue;
      listSourceFiles(full, skip, out);
    } else if (entry.isFile() && isSourcePath(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Per-file cache record: stat key + the file's extracted entries. */
interface CachedFile extends ExtractResult {
  key: string;
}
interface CacheShape {
  version: number;
  files: Record<string, CachedFile>;
}

/** Cache lives in node_modules/.cache (a conventional, already-gitignored spot); falls back to tmp. */
function cacheFile(repoRoot: string): string {
  const base = existsSync(path.join(repoRoot, "node_modules"))
    ? path.join(repoRoot, "node_modules", ".cache", "dufflebag")
    : path.join(tmpdir(), "dufflebag-dupindex");
  const id = createHash("sha1").update(repoRoot).digest("hex").slice(0, 12);
  return path.join(base, `dupIndex-${id}.json`);
}

function readCache(file: string): CacheShape {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object") {
      const cache = parsed as CacheShape;
      if (cache.version === CACHE_VERSION && cache.files) return cache;
    }
  } catch {
    /* missing or torn — rebuild */
  }
  return { version: CACHE_VERSION, files: {} };
}

function writeCache(file: string, cache: CacheShape): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, file);
  } catch {
    /* best-effort: a failed cache write only costs the next run a re-parse */
  }
}

/** Options for {@link buildIndex} — pass a preloaded `ts` to avoid re-resolving it. */
export interface BuildIndexOptions {
  repoRoot: string;
  /** Extra directory names to skip, merged with {@link DEFAULT_SKIP_DIRS}. */
  skipDirs?: readonly string[];
  /** Preloaded TypeScript; resolved from `repoRoot` when omitted. */
  ts?: typeof TS | null;
}

/**
 * Build (or incrementally refresh) the repo-wide index. Unchanged files are
 * served from a `size:mtime`-keyed cache, so steady-state cost is a stat() sweep
 * plus a parse of whatever just changed. Returns empty maps when `typescript`
 * can't be loaded (caller fails open).
 */
export function buildIndex(options: BuildIndexOptions): DupIndex {
  const { repoRoot } = options;
  const ts = options.ts ?? loadTypeScript(repoRoot);
  const empty: DupIndex = { typeSig: new Map(), fnFp: new Map() };
  if (!ts) return empty;

  const skip = new Set<string>([...DEFAULT_SKIP_DIRS, ...(options.skipDirs ?? [])]);
  const cachePath = cacheFile(repoRoot);
  const cache = readCache(cachePath);
  const files = listSourceFiles(repoRoot, skip, []);
  const nextFiles: Record<string, CachedFile> = {};
  let dirty = false;

  for (const full of files) {
    const rel = relFromAbs(repoRoot, full);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    const key = `${stat.size}:${Math.round(stat.mtimeMs)}`;
    const cached = cache.files[rel];
    if (cached && cached.key === key) {
      nextFiles[rel] = cached;
      continue;
    }
    try {
      nextFiles[rel] = { key, ...extractEntries(ts, readFileSync(full, "utf8"), full) };
    } catch {
      nextFiles[rel] = { key, types: [], fns: [] };
    }
    dirty = true;
  }
  if (!dirty) {
    for (const rel in cache.files) {
      if (!(rel in nextFiles)) {
        dirty = true;
        break;
      }
    }
  }
  if (dirty) writeCache(cachePath, { version: CACHE_VERSION, files: nextFiles });

  const index = empty;
  const push = (map: Map<string, Decl[]>, key: string, value: Decl): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const rel in nextFiles) {
    for (const t of nextFiles[rel].types) push(index.typeSig, t.sig, { name: t.name, file: rel, line: t.line, ignored: t.ignored });
    for (const f of nextFiles[rel].fns) push(index.fnFp, f.fp, { name: f.name, file: rel, line: f.line, ignored: f.ignored });
  }
  return index;
}

/**
 * Match the declarations in a pending edit's `addedText` against the repo index.
 * Used by the live hooks. A line carrying `// dup-ignore` is skipped. A function
 * is reported against any OTHER location (a same-file sibling counts; the
 * function's own name+file is excluded so editing it in place can't self-trip);
 * a type is reported against any DIFFERENT file. Capped at `limit` hits.
 */
export function findDuplicatesInAddedText(
  ts: typeof TS,
  index: DupIndex,
  repoRoot: string,
  filePath: string,
  addedText: string,
  limit = 5,
): DupHit[] {
  const { types, fns } = extractFromText(ts, addedText, filePath);
  if (types.length === 0 && fns.length === 0) return [];

  const currentRel = relFromAbs(repoRoot, filePath);
  const lines = addedText.split("\n");
  const ignored = (line: number): boolean => (lines[line - 1] ?? "").includes("dup-ignore");
  const hits: DupHit[] = [];

  const seenFn = new Map<string, FnEntry>();
  for (const fn of fns) {
    if (ignored(fn.line)) continue;
    const matches = (index.fnFp.get(fn.fp) ?? []).filter((e) => !(e.file === currentRel && e.name === fn.name));
    const earlier = seenFn.get(fn.fp);
    if (matches.length === 0 && !earlier) {
      seenFn.set(fn.fp, fn);
      continue;
    }
    const existing = matches[0] ?? { name: earlier!.name, file: currentRel, line: earlier!.line };
    hits.push({ kind: "function", name: fn.name, line: fn.line, existing });
    if (hits.length >= limit) return hits;
  }

  const seenType = new Map<string, TypeEntry>();
  for (const type of types) {
    if (ignored(type.line)) continue;
    const matches = (index.typeSig.get(type.sig) ?? []).filter((e) => e.file !== currentRel);
    const earlier = seenType.get(type.sig);
    if (matches.length === 0 && !earlier) {
      seenType.set(type.sig, type);
      continue;
    }
    const existing = matches[0] ?? { name: earlier!.name, file: currentRel, line: earlier!.line };
    hits.push({ kind: "type", name: type.name, line: type.line, existing });
    if (hits.length >= limit) return hits;
  }
  return hits;
}

/** A cluster of declarations sharing one fingerprint/signature — what `dedup check` reports. */
export interface DupCluster {
  kind: "function" | "type";
  decls: Decl[];
}

/**
 * Scan the whole repo index for clusters of ≥2 declarations sharing a body
 * fingerprint or type signature. Declarations annotated `// dup-ignore` are
 * excluded so the escape hatch means the same thing here as in the live hook.
 * When `restrictToFiles` is given (e.g. the staged/diff set), only clusters
 * that touch one of those files are returned — the comparison is still against
 * the full repo. Powers the `dedup check` command (advisory output + CI exit).
 */
export function scanForDuplicates(index: DupIndex, restrictToFiles?: ReadonlySet<string>): DupCluster[] {
  const clusters: DupCluster[] = [];
  const collect = (map: Map<string, Decl[]>, kind: "function" | "type"): void => {
    for (const decls of map.values()) {
      const active = decls.filter((d) => !d.ignored);
      if (active.length < 2) continue;
      if (restrictToFiles && !active.some((d) => restrictToFiles.has(d.file))) continue;
      clusters.push({ kind, decls: active });
    }
  };
  collect(index.fnFp, "function");
  collect(index.typeSig, "type");
  return clusters;
}
