// The repo-wide index of type signatures and function fingerprints that edits are matched against. It favors
// recall over precision and degrades to "no findings" on any internal error, so a guard never blocks editing.

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
import { tmpdir } from "node:os";
import path from "node:path";

import type * as TS from "typescript";

import { type ExtractedDeclarations, extractFromText, type FunctionEntry, type TypeEntry } from "./codeFingerprint.js";

export type Declaration = {
  name: string;
  // Repo-relative POSIX path.
  file: string;
  line: number;
  // The declaration's line carries the `// allow-duplicate` marker.
  ignored?: boolean;
};

export type DuplicateIndex = {
  typesBySignature: Map<string, Array<Declaration>>;
  functionsByFingerprint: Map<string, Array<Declaration>>;
};

type CachedFile = ExtractedDeclarations & { key: string };

type Cache = { version: number; files: Record<string, CachedFile> };

// Generated output, vendored dependencies, VCS, and native build trees; config adds repo-specific folders.
const DEFAULT_SKIP_FOLDERS: ReadonlyArray<string> = [
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

// Bump when the cached entry shape or the allow marker changes, so an older cache is rebuilt instead of misread.
const CACHE_VERSION = 3;

// e.g. "foo.ts", "bar.tsx" — not "foo.js" or "foo.d.ts"; works on a basename or a full path
export const isSourcePath = (name: string): boolean => /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);

export const repoRelativePath = (repoRoot: string, absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join("/");

const groupByKey = (entries: ReadonlyArray<readonly [string, Declaration]>): Map<string, Array<Declaration>> => {
  const groups = new Map<string, Array<Declaration>>();
  for (const [key, declaration] of entries) {
    const group = groups.get(key);
    if (group) group.push(declaration);
    else groups.set(key, [declaration]);
  }
  return groups;
};

export const indexDeclarations = (files: Readonly<Record<string, ExtractedDeclarations>>): DuplicateIndex => {
  const fileEntries = Object.entries(files);
  return {
    typesBySignature: groupByKey(
      fileEntries.flatMap(([file, extracted]) =>
        extracted.types.map(
          (entry) => [entry.signature, { name: entry.name, file, line: entry.line, ignored: entry.ignored }] as const,
        ),
      ),
    ),
    functionsByFingerprint: groupByKey(
      fileEntries.flatMap(([file, extracted]) =>
        extracted.functions.map(
          (entry) => [entry.fingerprint, { name: entry.name, file, line: entry.line, ignored: entry.ignored }] as const,
        ),
      ),
    ),
  };
};

const inspectSourceDirectory = (request: {
  directory: string;
  skipFolders: ReadonlySet<string>;
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
    const entryPath = path.join(request.directory, entry.name);
    if (entry.isDirectory() && !request.skipFolders.has(entry.name) && !entry.name.startsWith("cdk.out")) {
      nestedDirectories.push(entryPath);
    } else if (entry.isFile() && isSourcePath(entry.name)) {
      sourceFiles.push(entryPath);
    }
  }
  return { nestedDirectories, sourceFiles };
};

const listSourceFiles = (request: { directory: string; skipFolders: ReadonlySet<string> }): ReadonlyArray<string> => {
  const pendingDirectories = [request.directory];
  const sourceFiles: Array<string> = [];
  for (let directory = pendingDirectories.pop(); directory !== undefined; directory = pendingDirectories.pop()) {
    const inspection = inspectSourceDirectory({ directory, skipFolders: request.skipFolders });
    pendingDirectories.push(...inspection.nestedDirectories);
    sourceFiles.push(...inspection.sourceFiles);
  }
  return sourceFiles;
};

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const cachedRecords = (candidate: unknown): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(candidate) ? candidate.filter(isRecord) : [];

const decodeCachedFunction = (entry: Record<string, unknown>): ReadonlyArray<FunctionEntry> =>
  typeof entry.name === "string" && typeof entry.line === "number" && typeof entry.fingerprint === "string"
    ? [{ name: entry.name, line: entry.line, ignored: entry.ignored === true, fingerprint: entry.fingerprint }]
    : [];

const decodeCachedType = (entry: Record<string, unknown>): ReadonlyArray<TypeEntry> =>
  typeof entry.name === "string" && typeof entry.line === "number" && typeof entry.signature === "string"
    ? [{ name: entry.name, line: entry.line, ignored: entry.ignored === true, signature: entry.signature }]
    : [];

const decodeCachedFile = (candidate: unknown): CachedFile | undefined =>
  isRecord(candidate) && typeof candidate.key === "string"
    ? {
        key: candidate.key,
        functions: cachedRecords(candidate.functions).flatMap(decodeCachedFunction),
        types: cachedRecords(candidate.types).flatMap(decodeCachedType),
      }
    : undefined;

const decodeCache = (candidate: unknown): Cache | undefined => {
  if (!isRecord(candidate) || candidate.version !== CACHE_VERSION || !isRecord(candidate.files)) return undefined;
  const files = Object.fromEntries(
    Object.entries(candidate.files).flatMap(([file, cachedCandidate]) => {
      const cachedFile = decodeCachedFile(cachedCandidate);
      return cachedFile === undefined ? [] : [[file, cachedFile]];
    }),
  );
  return { version: CACHE_VERSION, files };
};

// node_modules/.cache is a conventional, already-ignored spot; repos without node_modules use the OS temp folder.
const cacheFile = (repoRoot: string): string => {
  const cacheFolder = existsSync(path.join(repoRoot, "node_modules"))
    ? path.join(repoRoot, "node_modules", ".cache", "dufflebag")
    : path.join(tmpdir(), "dufflebag-duplicate-index");
  const repoId = createHash("sha1").update(repoRoot).digest("hex").slice(0, 12);
  return path.join(cacheFolder, `duplicateIndex-${repoId}.json`);
};

const readCache = (file: string): Cache => {
  try {
    const cache = decodeCache(JSON.parse(readFileSync(file, "utf8")));
    if (cache !== undefined) return cache;
  } catch {
    // A missing or torn cache is rebuilt.
  }
  return { version: CACHE_VERSION, files: {} };
};

// Best effort: a failed write only costs the next run a re-parse.
const writeCache = (file: string, cache: Cache): void => {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const partialFile = `${file}.${process.pid}.partial`;
    writeFileSync(partialFile, JSON.stringify(cache));
    renameSync(partialFile, file);
  } catch {
    // Ignored on purpose.
  }
};

const statKey = (file: string): string | undefined => {
  try {
    const stat = statSync(file);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return undefined;
  }
};

const readDeclarations = (ts: typeof TS, file: string): ExtractedDeclarations => {
  try {
    return extractFromText({ ts, sourceText: readFileSync(file, "utf8"), fileName: file });
  } catch {
    return { types: [], functions: [] };
  }
};

// Unchanged files come from a size:mtime-keyed cache, so a steady-state run is a stat sweep plus a parse of
// whatever changed. An empty index when the repo has no `typescript`.
export const buildDuplicateIndex = (options: {
  repoRoot: string;
  skipFolders: ReadonlyArray<string>;
  ts: typeof TS | null;
}): DuplicateIndex => {
  const { repoRoot, ts } = options;
  if (!ts) return indexDeclarations({});

  const cachePath = cacheFile(repoRoot);
  const cache = readCache(cachePath);
  const skipFolders = new Set([...DEFAULT_SKIP_FOLDERS, ...options.skipFolders]);
  const nextFiles: Record<string, CachedFile> = {};
  let dirty = false;
  for (const file of listSourceFiles({ directory: repoRoot, skipFolders })) {
    const key = statKey(file);
    if (key === undefined) continue;
    const relativePath = repoRelativePath(repoRoot, file);
    const cached = cache.files[relativePath];
    if (cached && cached.key === key) {
      nextFiles[relativePath] = cached;
      continue;
    }
    nextFiles[relativePath] = { key, ...readDeclarations(ts, file) };
    dirty = true;
  }
  const filesRemoved = Object.keys(cache.files).some((file) => !(file in nextFiles));
  if (dirty || filesRemoved) writeCache(cachePath, { version: CACHE_VERSION, files: nextFiles });
  return indexDeclarations(nextFiles);
};
