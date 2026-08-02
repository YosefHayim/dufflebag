/**
 * `dufflebag dedup check [path]` — the runnable side of the dedup-guard feature.
 *
 * The live hooks block duplicates as they're written (Claude) or warn after the
 * fact (Cursor); this command is the catch-all that works EVERYWHERE, including
 * agents that can't hook a file edit at all (Codex). It runs the same AST engine
 * over a repo and exits non-zero on findings, so it serves three jobs from one
 * place: an advisory tool an agent/user can run, a git pre-commit check
 * (`--staged`), and a CI gate on a PR diff (`--since <ref>`). A duplicate can't
 * silently merge even where a hook couldn't stop it.
 *
 * Like the hooks, it resolves the repo's own `typescript`; a repo without it is
 * reported as un-checkable (exit 0) rather than failed, so non-TS repos don't
 * break CI.
 *
 * Dependency-free of the application CLI kernel: only `node:*`, shared
 * `src/runtime/**`, and this feature's lib. Presentation is plain stdout so the
 * command can run as a CI gate without clack/picocolors.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { readConfig } from "../../../runtime/config.js";
import {
  buildIndex,
  type DupCluster,
  isSourcePath,
  loadTypeScript,
  parseSkipList,
  relFromAbs,
  scanForDuplicates,
} from "../lib/dupIndex.js";

/** Inputs for {@link dedupCheck}, mapped 1:1 from the CLI flags. */
export type DedupCheckOptions = {
  /** Repo path to scan; defaults to cwd. */
  readonly workspace?: string;
  /** Restrict findings to git-staged files. */
  readonly staged?: boolean;
  /** Restrict findings to files changed since this git ref (e.g. `main`). */
  readonly since?: string;
  /** Presentation selected by the application adapter. */
  readonly format?: "text" | "json";
};

/** Git-changed source files (staged or since a ref), as a repo-relative POSIX set, or null on git failure. */
const changedFiles = (repoRoot: string, opts: DedupCheckOptions): Set<string> | null => {
  const args = opts.staged ? ["diff", "--cached", "--name-only"] : ["diff", "--name-only", `${opts.since}`];
  try {
    const out = execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
    const files = out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && isSourcePath(line));
    return new Set(files);
  } catch {
    return null;
  }
};

const skipDirectoryTextFrom = (candidate: unknown): string | null => {
  if (typeof candidate !== "object" || candidate === null) return null;
  const skipDirectoryText = Object.getOwnPropertyDescriptor(candidate, "dedupSkipDirectories")?.value;
  return typeof skipDirectoryText === "string" ? skipDirectoryText : null;
};

const readManagedSkipDirectories = (managedPath: string): ReadonlyArray<string> | null => {
  if (!existsSync(managedPath)) return null;
  try {
    const candidate: unknown = JSON.parse(readFileSync(managedPath, "utf8"));
    const skipDirectoryText = skipDirectoryTextFrom(candidate);
    return skipDirectoryText === null ? null : parseSkipList(skipDirectoryText);
  } catch {
    return null;
  }
};

/**
 * Prefer the project's managed config.json when present (install SSOT); otherwise
 * fall back to process.env / runtime defaults — same reader the live hooks use.
 */
const resolveSkipDirectories = (repoRoot: string): ReadonlyArray<string> => {
  const managedPath = path.join(repoRoot, ".claude", "dufflebag", "config.json");
  const managedSkipDirectories = readManagedSkipDirectories(managedPath);
  if (managedSkipDirectories !== null) return managedSkipDirectories;
  return parseSkipList(readConfig().dedupSkipDirectories);
};

/** Render one duplicate cluster as a labeled block of `file:line  name` rows. */
const renderCluster = (cluster: DupCluster): string => {
  const head = `${cluster.kind} (${cluster.decls.length} copies)`;
  const rows = cluster.decls.map((decl) => `  ${decl.file}:${decl.line}  ${decl.name}`).join("\n");
  return `${head}\n${rows}`;
};

/**
 * Scan a repo for duplicate function bodies / type shapes and report them,
 * setting a non-zero exit code when any are found so CI and pre-commit fail.
 */
type ChangedFileRestriction = {
  readonly restrict?: ReadonlySet<string>;
  readonly warning?: string;
};

const changedFileRestriction = (request: {
  readonly repoRoot: string;
  readonly options: DedupCheckOptions;
}): ChangedFileRestriction => {
  if (!request.options.staged && !request.options.since) return {};
  const changedSourcePaths = changedFiles(request.repoRoot, request.options);
  if (changedSourcePaths === null) {
    const gitSelection = request.options.staged ? "staged files" : `diff since ${request.options.since}`;
    return { warning: `Couldn't read git ${gitSelection}; scanned the whole repo.` };
  }
  return {
    restrict: new Set(
      [...changedSourcePaths].map((file) => relFromAbs(request.repoRoot, path.join(request.repoRoot, file))),
    ),
  };
};

const restrictionLabel = (options: DedupCheckOptions): string => {
  if (options.staged) return "staged";
  if (options.since !== undefined) return `since:${options.since}`;
  return "all";
};

export const dedupCheck = (options: DedupCheckOptions): void => {
  const repoRoot = path.resolve(options.workspace === undefined ? process.cwd() : options.workspace);
  const format = options.format === undefined ? "text" : options.format;
  if (format === "text") process.stdout.write(`dufflebag · dedup\n  → workspace: ${repoRoot}\n`);

  const ts = loadTypeScript(repoRoot);
  if (!ts) {
    if (format === "json") {
      process.stdout.write(
        `${JSON.stringify({ _tag: "skipped", workspace: repoRoot, reason: "typescript-unavailable" })}\n`,
      );
    } else {
      process.stdout.write(
        "  ! No `typescript` resolvable in this repo — nothing to check. (dedup-guard needs the repo's own TypeScript.)\n  Skipped.\n",
      );
    }
    return;
  }

  const skipDirs = [...new Set([...resolveSkipDirectories(repoRoot)])];

  const { restrict, warning } = changedFileRestriction({ repoRoot, options });
  if (format === "text" && warning !== undefined) process.stdout.write(`  ! ${warning}\n`);

  const index = buildIndex({ repoRoot, skipDirs, ts });
  const clusters = scanForDuplicates(index, restrict);

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
    if (clusters.length > 0) process.exitCode = 1;
    return;
  }

  if (clusters.length === 0) {
    process.stdout.write(`  ✓ No duplicate functions or types found${restrict ? " in the changed files" : ""}.\n`);
    return;
  }

  process.stdout.write(`\n  ${clusters.length} duplicate group(s)\n  ────────────────────\n`);
  process.stdout.write(`${clusters.map(renderCluster).join("\n\n")}\n`);
  process.stdout.write(
    "\n  ✗ Duplicates found — extract a shared helper and reuse it, or annotate genuine exceptions with `// dup-ignore`.\n",
  );
  process.exitCode = 1;
};
