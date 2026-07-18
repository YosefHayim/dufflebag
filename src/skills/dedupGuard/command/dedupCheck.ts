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
  readonly path?: string;
  /** Restrict findings to git-staged files. */
  readonly staged?: boolean;
  /** Restrict findings to files changed since this git ref (e.g. `main`). */
  readonly since?: string;
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

/**
 * Prefer the project's managed config.json when present (install SSOT); otherwise
 * fall back to process.env / runtime defaults — same reader the live hooks use.
 */
const resolveSkipDirectories = (repoRoot: string): ReadonlyArray<string> => {
  const managedPath = path.join(repoRoot, ".claude", "dufflebag", "config.json");
  if (existsSync(managedPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(managedPath, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "dedupSkipDirectories" in parsed &&
        typeof parsed.dedupSkipDirectories === "string"
      ) {
        return parseSkipList(parsed.dedupSkipDirectories);
      }
    } catch {
      // Fall through to env defaults when the file is unreadable or malformed.
    }
  }

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
export const dedupCheck = (opts: DedupCheckOptions): void => {
  const repoRoot = path.resolve(opts.path ?? process.cwd());
  process.stdout.write(`dufflebag · dedup check\n  → repo: ${repoRoot}\n`);

  const ts = loadTypeScript(repoRoot);
  if (!ts) {
    process.stdout.write(
      "  ! No `typescript` resolvable in this repo — nothing to check. (dedup-guard needs the repo's own TypeScript.)\n  Skipped.\n",
    );
    return;
  }

  const skipDirs = [...new Set([...resolveSkipDirectories(repoRoot)])];

  let restrict: Set<string> | undefined;
  if (opts.staged || opts.since) {
    const changed = changedFiles(repoRoot, opts);
    if (!changed) {
      process.stdout.write(
        `  ! Couldn't read git ${opts.staged ? "staged files" : `diff since ${opts.since}`} — scanning the whole repo instead.\n`,
      );
    } else {
      restrict = new Set([...changed].map((file) => relFromAbs(repoRoot, path.join(repoRoot, file))));
    }
  }

  const index = buildIndex({ repoRoot, skipDirs, ts });
  const clusters = scanForDuplicates(index, restrict);

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
