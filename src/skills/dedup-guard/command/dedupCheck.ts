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
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

import { c, fromEnvMap, intro, note, outro, readSettings, resolveLayout, step, warn } from "../../../core/index.js";
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
export interface DedupCheckOptions {
  /** Repo path to scan; defaults to cwd. */
  path?: string;
  /** Restrict findings to git-staged files. */
  staged?: boolean;
  /** Restrict findings to files changed since this git ref (e.g. `main`). */
  since?: string;
}

/** Git-changed source files (staged or since a ref), as a repo-relative POSIX set, or null on git failure. */
function changedFiles(repoRoot: string, opts: DedupCheckOptions): Set<string> | null {
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
}

/** Render one duplicate cluster as a labeled block of `file:line  name` rows. */
function renderCluster(cluster: DupCluster): string {
  const head = `${c.bold(cluster.kind)} ${c.dim(`(${cluster.decls.length} copies)`)}`;
  const rows = cluster.decls.map((d) => `  ${c.dim(`${d.file}:${d.line}`)}  ${d.name}`).join("\n");
  return `${head}\n${rows}`;
}

/**
 * Scan a repo for duplicate function bodies / type shapes and report them,
 * setting a non-zero exit code when any are found so CI and pre-commit fail.
 */
export function dedupCheck(opts: DedupCheckOptions): void {
  const repoRoot = path.resolve(opts.path ?? process.cwd());
  intro("dufflebag · dedup check");
  step(c.dim(`repo: ${repoRoot}`));

  const ts = loadTypeScript(repoRoot);
  if (!ts) {
    warn("No `typescript` resolvable in this repo — nothing to check. (dedup-guard needs the repo's own TypeScript.)");
    outro(c.dim("Skipped."));
    return;
  }

  const cfg = fromEnvMap(readSettings(resolveLayout("project", repoRoot).settingsFile).env);
  const skipDirs = [...new Set([...parseSkipList(cfg.dedupSkipDirectories)])];

  let restrict: Set<string> | undefined;
  if (opts.staged || opts.since) {
    const changed = changedFiles(repoRoot, opts);
    if (!changed) {
      warn(`Couldn't read git ${opts.staged ? "staged files" : `diff since ${opts.since}`} — scanning the whole repo instead.`);
    } else {
      restrict = new Set([...changed].map((f) => relFromAbs(repoRoot, path.join(repoRoot, f))));
    }
  }

  const index = buildIndex({ repoRoot, skipDirs, ts });
  const clusters = scanForDuplicates(index, restrict);

  if (clusters.length === 0) {
    outro(c.green(`No duplicate functions or types found${restrict ? " in the changed files" : ""}.`));
    return;
  }

  note(clusters.map(renderCluster).join("\n\n"), `${clusters.length} duplicate group(s)`);
  outro(c.red("Duplicates found — extract a shared helper and reuse it, or annotate genuine exceptions with `// dup-ignore`."));
  process.exitCode = 1;
}
