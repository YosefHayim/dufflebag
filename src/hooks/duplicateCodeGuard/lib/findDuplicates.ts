// Matches declarations against the repo index: those in one pending edit (the hook), or every group of copies
// already in the repo (`dufflebag duplicates`).

import type * as TS from "typescript";

import { extractFromText } from "./codeFingerprint.js";
import { type Declaration, type DuplicateIndex, repoRelativePath } from "./duplicateIndex.js";

type DeclarationKind = "function" | "type";

export type DuplicateMatch = {
  kind: DeclarationKind;
  name: string;
  // 1-based line within the edit's added text.
  line: number;
  existing: Declaration;
};

export type DuplicateCluster = {
  kind: DeclarationKind;
  declarations: Array<Declaration>;
};

type Candidate = {
  kind: DeclarationKind;
  name: string;
  line: number;
  ignored: boolean;
  // Scoped by kind so a fingerprint can never meet a type signature.
  key: string;
  indexedCopies: ReadonlyArray<Declaration>;
};

const MAX_MATCHES = 5;

// A function matches any other location (a same-file sibling counts, but not the function itself, so editing it in
// place never trips); a type matches only other files. A copy repeated within the edit also counts.
export const findDuplicatesInEdit = (request: {
  ts: typeof TS;
  index: DuplicateIndex;
  repoRoot: string;
  filePath: string;
  addedText: string;
}): Array<DuplicateMatch> => {
  const { types, functions } = extractFromText({
    ts: request.ts,
    sourceText: request.addedText,
    fileName: request.filePath,
  });
  const currentFile = repoRelativePath(request.repoRoot, request.filePath);
  const candidates: ReadonlyArray<Candidate> = [
    ...functions.map((entry) => ({
      kind: "function" as const,
      name: entry.name,
      line: entry.line,
      ignored: entry.ignored,
      key: `function:${entry.fingerprint}`,
      indexedCopies: (request.index.functionsByFingerprint.get(entry.fingerprint) || []).filter(
        (declaration) => !(declaration.file === currentFile && declaration.name === entry.name),
      ),
    })),
    ...types.map((entry) => ({
      kind: "type" as const,
      name: entry.name,
      line: entry.line,
      ignored: entry.ignored,
      key: `type:${entry.signature}`,
      indexedCopies: (request.index.typesBySignature.get(entry.signature) || []).filter(
        (declaration) => declaration.file !== currentFile,
      ),
    })),
  ];

  const firstInEdit = new Map<string, Declaration>();
  const matches: Array<DuplicateMatch> = [];
  for (const candidate of candidates) {
    if (candidate.ignored) continue;
    const existing = candidate.indexedCopies.at(0) || firstInEdit.get(candidate.key);
    if (existing === undefined) {
      firstInEdit.set(candidate.key, { name: candidate.name, file: currentFile, line: candidate.line });
      continue;
    }
    matches.push({ kind: candidate.kind, name: candidate.name, line: candidate.line, existing });
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches;
};

// Groups of two or more declarations sharing a key, minus allowed copies. With `restrictToFiles` (a staged or diff
// set), only groups touching those files are kept; the comparison still covers the whole repo.
export const scanForDuplicates = (
  index: DuplicateIndex,
  restrictToFiles?: ReadonlySet<string>,
): Array<DuplicateCluster> => {
  const clusters: Array<DuplicateCluster> = [];
  const collect = (groups: Map<string, Array<Declaration>>, kind: DeclarationKind): void => {
    for (const declarations of groups.values()) {
      const active = declarations.filter((declaration) => !declaration.ignored);
      if (active.length < 2) continue;
      if (restrictToFiles && !active.some((declaration) => restrictToFiles.has(declaration.file))) continue;
      clusters.push({ kind, declarations: active });
    }
  };
  collect(index.functionsByFingerprint, "function");
  collect(index.typesBySignature, "type");
  return clusters;
};
