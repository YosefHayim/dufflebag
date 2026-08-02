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
import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import type * as TS from "typescript";

/** A declaration's location, used both as a match target and for display. */
export type Decl = {
  name: string;
  /** Repo-relative POSIX path. */
  file: string;
  /** 1-based line of the declaration. */
  line: number;
  /** True when the declaration's line carries a `// dup-ignore` escape hatch. */
  ignored?: boolean;
};

/** An object-type (interface / type-literal) entry: its name + canonical shape signature. */
export type TypeEntry = {
  name: string;
  sig: string;
  line: number;
  ignored?: boolean;
};

/** A named-function entry: its name + alpha-canonical body fingerprint. */
export type FnEntry = {
  name: string;
  fp: string;
  line: number;
  ignored?: boolean;
};

/** Everything extracted from one source text. */
export type ExtractedFunction = {
  types: TypeEntry[];
  fns: FnEntry[];
};

/** The two lookup maps that make duplicate detection O(1) per candidate. */
export type DupIndex = {
  /** type signature → every declaration with that shape. */
  typeSig: Map<string, Decl[]>;
  /** function body fingerprint → every declaration with that body. */
  fnFp: Map<string, Decl[]>;
};

/** A single duplicate finding: a candidate declaration that collides with an existing one. */
export type DupHit = {
  kind: "function" | "type";
  name: string;
  /** 1-based line within the candidate text. */
  line: number;
  existing: Decl;
};

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
export const loadTypeScript = (repoRoot: string): typeof TS | null => {
  try {
    const require = createRequire(path.join(repoRoot, "noop.js"));
    const resolved = require.resolve("typescript", { paths: [repoRoot] });
    // External type correction: the CommonJS module has the shape declared by TypeScript's official package.
    return require(resolved) as typeof TS;
  } catch {
    return null;
  }
};

/**
 * The repo root to index: Claude/Codex set `CLAUDE_PROJECT_DIR`; otherwise fall
 * back to the provided cwd (the `dedup check` command passes its target path).
 */
export const resolveRepoRoot = (cwd: string = process.cwd()): string => {
  return process.env.CLAUDE_PROJECT_DIR || cwd;
};

/** Parse the `dufflebagDedupSkipDirectories` value (comma/space list) into extra skip-dir names. */
export const parseSkipList = (sourceText: string | undefined): string[] => {
  if (!sourceText) return [];
  return (
    sourceText
      // e.g. "vendor, generated  tmp" → ["vendor","generated","tmp"]
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
};

/** Absolute path → repo-relative POSIX path (stable cache + display key). */
export const relFromAbs = (repoRoot: string, absPath: string): string => {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
};

// ── Type signatures ─────────────────────────────────────────────────────────

/** Canonical, order-independent signature of an object type's members. */
const canonicalMembers = (request: {
  ts: typeof TS;
  members: ReadonlyArray<TS.TypeElement>;
  sourceFile: TS.SourceFile;
}): string => {
  const parts: string[] = [];
  for (const member of request.members) {
    if (request.ts.isPropertySignature(member) && member.name) {
      const name = member.name.getText(request.sourceFile);
      const optional = member.questionToken ? "?" : "";
      const modifiers = member.modifiers === undefined ? [] : member.modifiers;
      const readonly = modifiers.some((modifier) => modifier.kind === request.ts.SyntaxKind.ReadonlyKeyword)
        ? "readonly "
        : "";
      const typeText = member.type ? normalizeWhitespace(member.type.getText(request.sourceFile)) : "any";
      parts.push(`${readonly}${name}${optional}:${typeText}`);
    } else {
      parts.push(normalizeWhitespace(member.getText(request.sourceFile)));
    }
  }
  parts.sort();
  return parts.join(";");
};

/** Heritage (`extends A, B`) folded in so `extends X {a}` and a bare `{a}` don't collide. */
const heritageToken = (node: TS.InterfaceDeclaration, sourceFile: TS.SourceFile): string => {
  if (!node.heritageClauses || node.heritageClauses.length === 0) return "";
  const bases: string[] = [];
  for (const clause of node.heritageClauses) {
    for (const type of clause.types) bases.push(normalizeWhitespace(type.getText(sourceFile)));
  }
  bases.sort();
  return `|H:${bases.join(",")}`;
};

/** Type/interface object-shape signature for `node`, or null if it isn't one. */
const typeSignature = (request: {
  ts: typeof TS;
  node: TS.Node;
  sourceFile: TS.SourceFile;
}): { name: string; sig: string } | null => {
  if (request.ts.isInterfaceDeclaration(request.node)) {
    return {
      name: request.node.name.text,
      sig:
        canonicalMembers({ ts: request.ts, members: request.node.members, sourceFile: request.sourceFile }) +
        heritageToken(request.node, request.sourceFile),
    };
  }
  if (request.ts.isTypeAliasDeclaration(request.node) && request.ts.isTypeLiteralNode(request.node.type)) {
    return {
      name: request.node.name.text,
      sig: canonicalMembers({
        ts: request.ts,
        members: request.node.type.members,
        sourceFile: request.sourceFile,
      }),
    };
  }
  return null;
};

// ── Function fingerprints ────────────────────────────────────────────────────

/** Collect the identifier text of every binding name (handles destructuring). */
const bindingNames = (ts: typeof TS, bindingName: TS.BindingName | undefined): ReadonlyArray<string> => {
  if (!bindingName) return [];
  if (ts.isIdentifier(bindingName)) {
    return [bindingName.text];
  }
  return bindingName.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(ts, element.name) : [],
  );
};

/** Every name BOUND inside the function (params, locals, nested fn names, catch vars). */
const collectBound = (request: {
  ts: typeof TS;
  parameters: ReadonlyArray<TS.ParameterDeclaration>;
  functionNode: TS.Node;
}): Set<string> => {
  const names = new Set<string>();
  for (const parameter of request.parameters) {
    for (const name of bindingNames(request.ts, parameter.name)) names.add(name);
  }
  const walk = (node: TS.Node): void => {
    if (request.ts.isVariableDeclaration(node) || request.ts.isParameter(node)) {
      for (const name of bindingNames(request.ts, node.name)) names.add(name);
    } else if (request.ts.isFunctionDeclaration(node) && node.name) {
      names.add(node.name.text);
    } else if (request.ts.isCatchClause(node) && node.variableDeclaration) {
      for (const name of bindingNames(request.ts, node.variableDeclaration.name)) names.add(name);
    }
    request.ts.forEachChild(node, walk);
  };
  walk(request.functionNode);
  return names;
};

/**
 * Alpha-canonical structural fingerprint of a function body. Two bodies that
 * differ only by formatting, comments, or a consistent rename of locals/params
 * produce the same string; a changed operator, literal, or free name does not.
 */
const fingerprintSource = (request: {
  ts: typeof TS;
  parameters: ReadonlyArray<TS.ParameterDeclaration>;
  functionNode: TS.Node;
}): string => {
  const bound = collectBound(request);
  const placeholder = new Map<string, string>();
  let paramCount = 0;
  let localCount = 0;
  const parameterNames = request.parameters.flatMap((parameter) => bindingNames(request.ts, parameter.name));
  for (const parameterName of parameterNames) {
    if (!placeholder.has(parameterName)) {
      placeholder.set(parameterName, `P${paramCount++}`);
    }
  }

  const serializeIdentifier = (identifier: TS.Identifier): string => {
    if (!bound.has(identifier.text)) {
      return `@${identifier.text}`;
    }

    const existingPlaceholder = placeholder.get(identifier.text);
    if (existingPlaceholder !== undefined) {
      return `#${existingPlaceholder}`;
    }

    const localPlaceholder = `L${localCount++}`;
    placeholder.set(identifier.text, localPlaceholder);
    return `#${localPlaceholder}`;
  };

  const ser = (node: TS.Node | undefined): string => {
    if (!node) return "";
    if (request.ts.isIdentifier(node)) {
      return serializeIdentifier(node);
    }
    if (request.ts.isStringLiteralLike(node)) return `S${JSON.stringify(node.text)}`;
    if (request.ts.isNumericLiteral(node)) return `N${node.text}`;
    if (node.kind === request.ts.SyntaxKind.TrueKeyword) return "true";
    if (node.kind === request.ts.SyntaxKind.FalseKeyword) return "false";
    if (node.kind === request.ts.SyntaxKind.NullKeyword) return "null";
    if (request.ts.isPropertyAccessExpression(node)) return `PA(${ser(node.expression)}.${node.name.text})`;
    if (request.ts.isBinaryExpression(node)) return `B${node.operatorToken.kind}(${ser(node.left)},${ser(node.right)})`;
    if (request.ts.isPrefixUnaryExpression(node)) return `U${node.operator}(${ser(node.operand)})`;
    if (request.ts.isPostfixUnaryExpression(node)) return `PU${node.operator}(${ser(node.operand)})`;
    let out = `K${node.kind}(`;
    let first = true;
    request.ts.forEachChild(node, (child) => {
      out += (first ? "" : ",") + ser(child);
      first = false;
    });
    return `${out})`;
  };

  return `A${request.parameters.length}|${ser(request.functionNode)}`;
};

/** A NAMED function-like (declaration, assigned arrow/expr, method) → its name + fingerprint, or null. */
const functionFingerprint = (ts: typeof TS, node: TS.Node): { name: string; fp: string } | null => {
  if (ts.isFunctionDeclaration(node) && node.name && node.body) {
    return {
      name: node.name.text,
      fp: fingerprintSource({ ts, parameters: node.parameters, functionNode: node.body }),
    };
  }
  if (ts.isMethodDeclaration(node) && node.name && node.body) {
    return {
      name: node.name.getText(),
      fp: fingerprintSource({ ts, parameters: node.parameters, functionNode: node.body }),
    };
  }
  if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) {
    const init = node.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body && node.name) {
      return {
        name: node.name.getText(),
        fp: fingerprintSource({ ts, parameters: init.parameters, functionNode: init.body }),
      };
    }
  }
  return null;
};

// ── Extraction + index assembly ──────────────────────────────────────────────

/** Parse `text` once and pull every type + function entry, with 1-based lines. */
const extractEntries = (request: { ts: typeof TS; sourceText: string; fileName: string }): ExtractedFunction => {
  // e.g. "Button.tsx" → TSX; "util.ts" → TS
  const scriptKind = /\.tsx$/.test(request.fileName) ? request.ts.ScriptKind.TSX : request.ts.ScriptKind.TS;
  const sourceFile = request.ts.createSourceFile(
    request.fileName || "snippet.tsx",
    request.sourceText,
    request.ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const types: TypeEntry[] = [];
  const fns: FnEntry[] = [];
  const lines = request.sourceText.split("\n");
  const lineOf = (node: TS.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const ignoredAt = (line: number): boolean => {
    const sourceLine = lines.at(line - 1);
    return sourceLine === undefined ? false : sourceLine.includes("dup-ignore");
  };

  const visit = (node: TS.Node): void => {
    const t = typeSignature({ ts: request.ts, node, sourceFile });
    if (t) {
      const line = lineOf(node);
      types.push({ ...t, line, ignored: ignoredAt(line) });
    }
    const f = functionFingerprint(request.ts, node);
    if (f) {
      const line = lineOf(node);
      fns.push({ ...f, line, ignored: ignoredAt(line) });
    }
    request.ts.forEachChild(node, visit);
  };
  request.ts.forEachChild(sourceFile, visit);
  return { types, fns };
};

/** Extract entries from an in-memory snippet (a pending edit's added text). Fail-soft. */
export const extractFromText = (request: {
  ts: typeof TS;
  sourceText: string;
  fileName: string;
}): ExtractedFunction => {
  try {
    return extractEntries(request);
  } catch {
    return { types: [], fns: [] };
  }
};

const inspectSourceDirectory = (request: {
  directory: string;
  skipDirectories: ReadonlySet<string>;
}): { nestedDirectories: ReadonlyArray<string>; sourceFiles: ReadonlyArray<string> } => {
  let entries: ReadonlyArray<Dirent>;
  try {
    entries = readdirSync(request.directory, { withFileTypes: true });
  } catch {
    return { nestedDirectories: [], sourceFiles: [] };
  }

  const nestedDirectories: Array<string> = [];
  const sourceFiles: Array<string> = [];
  for (const entry of entries) {
    const full = path.join(request.directory, entry.name);
    if (entry.isDirectory() && !request.skipDirectories.has(entry.name) && !entry.name.startsWith("cdk.out")) {
      nestedDirectories.push(full);
      continue;
    }

    if (entry.isFile() && isSourcePath(entry.name)) {
      sourceFiles.push(full);
    }
  }

  return { nestedDirectories, sourceFiles };
};

/** Recursively collect indexable source files while keeping each traversal loop flat. */
const listSourceFiles = (request: {
  directory: string;
  skipDirectories: ReadonlySet<string>;
}): ReadonlyArray<string> => {
  const pendingDirectories = [request.directory];
  const sourceFiles: Array<string> = [];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    if (directory === undefined) {
      continue;
    }

    const inspection = inspectSourceDirectory({ directory, skipDirectories: request.skipDirectories });
    pendingDirectories.push(...inspection.nestedDirectories);
    sourceFiles.push(...inspection.sourceFiles);
  }

  return sourceFiles;
};

/** Per-file cache record: stat key + the file's extracted entries. */
type CachedFile = ExtractedFunction & {
  key: string;
};
type CacheShape = {
  version: number;
  files: Record<string, CachedFile>;
};

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const decodeDeclEntries = (candidate: unknown, kind: "function" | "type"): ReadonlyArray<FnEntry | TypeEntry> => {
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.line !== "number") {
      return [];
    }

    const signatureProperty = kind === "function" ? "fp" : "sig";
    const signature = entry[signatureProperty];
    if (typeof signature !== "string") {
      return [];
    }

    return [
      kind === "function"
        ? { name: entry.name, line: entry.line, ignored: entry.ignored === true, fp: signature }
        : { name: entry.name, line: entry.line, ignored: entry.ignored === true, sig: signature },
    ];
  });
};

const decodeCachedFile = (candidate: unknown): CachedFile | undefined => {
  if (!isRecord(candidate) || typeof candidate.key !== "string") {
    return undefined;
  }

  return {
    key: candidate.key,
    fns: decodeDeclEntries(candidate.fns, "function").flatMap((entry) => ("fp" in entry ? [entry] : [])),
    types: decodeDeclEntries(candidate.types, "type").flatMap((entry) => ("sig" in entry ? [entry] : [])),
  };
};

const decodeCache = (candidate: unknown): CacheShape | undefined => {
  if (!isRecord(candidate) || candidate.version !== CACHE_VERSION || !isRecord(candidate.files)) {
    return undefined;
  }

  const files = Object.fromEntries(
    Object.entries(candidate.files).flatMap(([file, cachedCandidate]) => {
      const cachedFile = decodeCachedFile(cachedCandidate);
      return cachedFile === undefined ? [] : [[file, cachedFile]];
    }),
  );
  return { version: CACHE_VERSION, files };
};

/** Cache lives in node_modules/.cache (a conventional, already-gitignored spot); falls back to tmp. */
const cacheFile = (repoRoot: string): string => {
  const base = existsSync(path.join(repoRoot, "node_modules"))
    ? path.join(repoRoot, "node_modules", ".cache", "dufflebag")
    : path.join(tmpdir(), "dufflebag-dupindex");
  const id = createHash("sha1").update(repoRoot).digest("hex").slice(0, 12);
  return path.join(base, `dupIndex-${id}.json`);
};

const readCache = (file: string): CacheShape => {
  try {
    const cacheCandidate: unknown = JSON.parse(readFileSync(file, "utf8"));
    const cache = decodeCache(cacheCandidate);
    if (cache !== undefined) {
      return cache;
    }
  } catch {
    /* missing or torn — rebuild */
  }
  return { version: CACHE_VERSION, files: {} };
};

const writeCache = (file: string, cache: CacheShape): void => {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const workspaceDirectory = `${file}.${process.pid}.tmp`;
    writeFileSync(workspaceDirectory, JSON.stringify(cache));
    renameSync(workspaceDirectory, file);
  } catch {
    /* best-effort: a failed cache write only costs the next run a re-parse */
  }
};

const cacheNeedsRewrite = (cache: CacheShape, nextFiles: Readonly<Record<string, CachedFile>>): boolean => {
  for (const relativePath in cache.files) {
    if (!(relativePath in nextFiles)) {
      return true;
    }
  }

  return false;
};

/** Options for {@link buildIndex} — pass a preloaded `ts` to avoid re-resolving it. */
export type BuildIndexOptions = {
  repoRoot: string;
  /** Extra directory names to skip, merged with {@link DEFAULT_SKIP_DIRS}. */
  skipDirs?: readonly string[];
  /** Preloaded TypeScript; resolved from `repoRoot` when omitted. */
  ts?: typeof TS | null;
};

/**
 * Build (or incrementally refresh) the repo-wide index. Unchanged files are
 * served from a `size:mtime`-keyed cache, so steady-state cost is a stat() sweep
 * plus a parse of whatever just changed. Returns empty maps when `typescript`
 * can't be loaded (caller fails open).
 */
export const buildIndex = (options: BuildIndexOptions): DupIndex => {
  const { repoRoot } = options;
  const ts = options.ts === undefined ? loadTypeScript(repoRoot) : options.ts;
  const empty: DupIndex = { typeSig: new Map(), fnFp: new Map() };
  if (!ts) return empty;

  const additionalSkipDirectories = options.skipDirs === undefined ? [] : options.skipDirs;
  const skip = new Set<string>([...DEFAULT_SKIP_DIRS, ...additionalSkipDirectories]);
  const cachePath = cacheFile(repoRoot);
  const cache = readCache(cachePath);
  const files = listSourceFiles({ directory: repoRoot, skipDirectories: skip });
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
      nextFiles[rel] = { key, ...extractEntries({ ts, sourceText: readFileSync(full, "utf8"), fileName: full }) };
    } catch {
      nextFiles[rel] = { key, types: [], fns: [] };
    }
    dirty = true;
  }
  if (!dirty && cacheNeedsRewrite(cache, nextFiles)) {
    dirty = true;
  }
  if (dirty) writeCache(cachePath, { version: CACHE_VERSION, files: nextFiles });

  const index = empty;
  for (const rel in nextFiles) {
    const cachedFile = nextFiles[rel];
    for (const typeEntry of cachedFile.types) {
      const declarations = index.typeSig.get(typeEntry.sig);
      const declaration = {
        name: typeEntry.name,
        file: rel,
        line: typeEntry.line,
        ignored: typeEntry.ignored,
      };
      index.typeSig.set(typeEntry.sig, declarations === undefined ? [declaration] : [...declarations, declaration]);
    }
    for (const functionEntry of cachedFile.fns) {
      const declarations = index.fnFp.get(functionEntry.fp);
      const declaration = {
        name: functionEntry.name,
        file: rel,
        line: functionEntry.line,
        ignored: functionEntry.ignored,
      };
      index.fnFp.set(functionEntry.fp, declarations === undefined ? [declaration] : [...declarations, declaration]);
    }
  }
  return index;
};

/**
 * Match the declarations in a pending edit's `addedText` against the repo index.
 * Used by the live hooks. A line carrying `// dup-ignore` is skipped. A function
 * is reported against any OTHER location (a same-file sibling counts; the
 * function's own name+file is excluded so editing it in place can't self-trip);
 * a type is reported against any DIFFERENT file. Capped at `limit` hits.
 */
export const findDuplicatesInAddedText = (request: {
  ts: typeof TS;
  index: DupIndex;
  repoRoot: string;
  filePath: string;
  addedText: string;
  limit?: number;
}): DupHit[] => {
  const limit = request.limit === undefined ? 5 : request.limit;
  const { types, fns } = extractFromText({
    ts: request.ts,
    sourceText: request.addedText,
    fileName: request.filePath,
  });
  if (types.length === 0 && fns.length === 0) return [];

  const currentRel = relFromAbs(request.repoRoot, request.filePath);
  const lines = request.addedText.split("\n");
  const ignored = (line: number): boolean => {
    const sourceLine = lines.at(line - 1);
    return sourceLine === undefined ? false : sourceLine.includes("dup-ignore");
  };
  const hits: DupHit[] = [];

  const seenFn = new Map<string, FnEntry>();
  for (const fn of fns) {
    if (ignored(fn.line)) continue;
    const indexedFunctions = request.index.fnFp.get(fn.fp);
    const matches = (indexedFunctions === undefined ? [] : indexedFunctions).filter(
      (entry) => !(entry.file === currentRel && entry.name === fn.name),
    );
    const earlier = seenFn.get(fn.fp);
    const indexedMatch = matches.at(0);
    if (indexedMatch === undefined && earlier === undefined) {
      seenFn.set(fn.fp, fn);
      continue;
    }
    const existing =
      indexedMatch === undefined && earlier !== undefined
        ? { name: earlier.name, file: currentRel, line: earlier.line }
        : indexedMatch;
    if (existing === undefined) {
      continue;
    }
    hits.push({ kind: "function", name: fn.name, line: fn.line, existing });
    if (hits.length >= limit) return hits;
  }

  const seenType = new Map<string, TypeEntry>();
  for (const type of types) {
    if (ignored(type.line)) continue;
    const indexedTypes = request.index.typeSig.get(type.sig);
    const matches = (indexedTypes === undefined ? [] : indexedTypes).filter((entry) => entry.file !== currentRel);
    const earlier = seenType.get(type.sig);
    const indexedMatch = matches.at(0);
    if (indexedMatch === undefined && earlier === undefined) {
      seenType.set(type.sig, type);
      continue;
    }
    const existing =
      indexedMatch === undefined && earlier !== undefined
        ? { name: earlier.name, file: currentRel, line: earlier.line }
        : indexedMatch;
    if (existing === undefined) {
      continue;
    }
    hits.push({ kind: "type", name: type.name, line: type.line, existing });
    if (hits.length >= limit) return hits;
  }
  return hits;
};

/** A cluster of declarations sharing one fingerprint/signature — what `dedup check` reports. */
export type DupCluster = {
  kind: "function" | "type";
  decls: Decl[];
};

/**
 * Scan the whole repo index for clusters of ≥2 declarations sharing a body
 * fingerprint or type signature. Declarations annotated `// dup-ignore` are
 * excluded so the escape hatch means the same thing here as in the live hook.
 * When `restrictToFiles` is given (e.g. the staged/diff set), only clusters
 * that touch one of those files are returned — the comparison is still against
 * the full repo. Powers the `dedup check` command (advisory output + CI exit).
 */
export const scanForDuplicates = (index: DupIndex, restrictToFiles?: ReadonlySet<string>): DupCluster[] => {
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
};
