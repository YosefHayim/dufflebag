// `dufflebag duplicates [workspace]`: the same check as the hook, for agents without edit hooks, pre-commit
// (`--staged`), and CI (`--since <ref>`). It exits non-zero on findings; a repo without its own `typescript` is
// skipped with exit 0 so non-TS repos never fail CI. Dependency-free like the hooks, so it writes plain stdout.

import { execFileSync } from "node:child_process";
import path from "node:path";

import { loadTypeScript } from "../lib/codeFingerprint.js";
import { buildDuplicateIndex, isSourcePath, repoRelativePath } from "../lib/duplicateIndex.js";
import { type DuplicateCluster, scanForDuplicates } from "../lib/findDuplicates.js";

type CheckDuplicatesOptions = {
  // Defaults to the current directory.
  readonly workspace?: string;
  // Folder names to skip besides the built-in ones (config `duplicateCodeSkipFolders`).
  readonly skipFolders: ReadonlyArray<string>;
  readonly staged?: boolean;
  // Git ref whose diff limits the findings, e.g. `main`.
  readonly since?: string;
  readonly format?: "text" | "json";
};

type ChangedFileRestriction = {
  readonly restrict?: ReadonlySet<string>;
  readonly warning?: string;
};

// Git prints paths relative to the repository root; null when git fails.
const changedSourceFiles = (repoRoot: string, options: CheckDuplicatesOptions): ReadonlySet<string> | null => {
  const args = options.staged ? ["diff", "--cached", "--name-only"] : ["diff", "--name-only", `${options.since}`];
  try {
    return new Set(
      execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && isSourcePath(line))
        .map((file) => repoRelativePath(repoRoot, path.join(repoRoot, file))),
    );
  } catch {
    return null;
  }
};

const changedFileRestriction = (repoRoot: string, options: CheckDuplicatesOptions): ChangedFileRestriction => {
  if (!options.staged && !options.since) return {};
  const restrict = changedSourceFiles(repoRoot, options);
  if (restrict !== null) return { restrict };
  const gitSelection = options.staged ? "staged files" : `diff since ${options.since}`;
  return { warning: `Couldn't read git ${gitSelection}; scanned the whole repo.` };
};

const restrictionLabel = (options: CheckDuplicatesOptions): string => {
  if (options.staged) return "staged";
  if (options.since !== undefined) return `since:${options.since}`;
  return "all";
};

const renderCluster = (cluster: DuplicateCluster): string => {
  const rows = cluster.declarations.map(
    (declaration) => `  ${declaration.file}:${declaration.line}  ${declaration.name}`,
  );
  return [`${cluster.kind} (${cluster.declarations.length} copies)`, ...rows].join("\n");
};

export const checkDuplicates = (options: CheckDuplicatesOptions): void => {
  const repoRoot = path.resolve(options.workspace === undefined ? process.cwd() : options.workspace);
  const format = options.format === undefined ? "text" : options.format;
  if (format === "text") process.stdout.write(`dufflebag · duplicates\n  → workspace: ${repoRoot}\n`);

  const ts = loadTypeScript(repoRoot);
  if (!ts) {
    process.stdout.write(
      format === "json"
        ? `${JSON.stringify({ _tag: "skipped", workspace: repoRoot, reason: "typescript-unavailable" })}\n`
        : "  ! No `typescript` resolvable in this repo — nothing to check. (duplicate-code-guard needs the repo's own TypeScript.)\n  Skipped.\n",
    );
    return;
  }

  const { restrict, warning } = changedFileRestriction(repoRoot, options);
  if (format === "text" && warning !== undefined) process.stdout.write(`  ! ${warning}\n`);

  const clusters = scanForDuplicates(buildDuplicateIndex({ repoRoot, skipFolders: options.skipFolders, ts }), restrict);
  if (clusters.length > 0) process.exitCode = 1;

  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({
        _tag: clusters.length === 0 ? "clean" : "duplicates",
        workspace: repoRoot,
        restriction: restrictionLabel(options),
        gitWarning: warning,
        duplicateGroups: clusters,
      })}\n`,
    );
    return;
  }

  if (clusters.length === 0) {
    process.stdout.write(`  ✓ No duplicate functions or types found${restrict ? " in the changed files" : ""}.\n`);
    return;
  }

  process.stdout.write(`\n  ${clusters.length} duplicate group(s)\n  ────────────────────\n`);
  process.stdout.write(`${clusters.map(renderCluster).join("\n\n")}\n`);
  process.stdout.write(
    "\n  ✗ Duplicates found — extract a shared helper and reuse it, or annotate genuine exceptions with `// allow-duplicate`.\n",
  );
};
