/**
 * `dufflebag scaffold-ci [path]` — copy the CI + publish workflow set into a repo.
 *
 * dufflebag ships a canonical set of single-purpose workflows in
 * `templates/workflows/` (biome, typecheck, test, build, report-failure, an opt-in
 * e2e, the `ci.yml` that composes them via `./` local refs, and `publish.yml`).
 * This copies the whole set into the target's `.github/workflows/`, so every repo
 * OWNS and can customize its CI — re-run with `--force` to resync (ADR 0009). Only
 * `publish.yml` is templated: its OWNER/REPO/PACKAGE placeholders are filled from
 * the target's git remote + package.json; the rest copy verbatim. Existing files
 * are kept unless `--force`. YAML is emitted as text — no YAML dependency (ADR 0006).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { c, ensureDir, intro, note, outro, packageRoot, readJson, step, warn } from "../core/index.js";

/** Repo identity the publish copy-template needs filled in. */
export interface ScaffoldInputs {
  /** GitHub org/user that owns the target repo. */
  owner: string;
  /** Target repository name. */
  repo: string;
  /** npm package name to publish as. */
  packageName: string;
}

/** A raw template as read from `templates/workflows/`. */
export interface TemplateFile {
  /** Template filename, e.g. `ci.yml`. */
  name: string;
  /** Raw file contents, verbatim. */
  raw: string;
}

/** A template resolved to its final text — publish.yml filled, the rest verbatim. */
export interface PlannedFile {
  /** Destination filename under `.github/workflows/`. */
  name: string;
  /** Final text to write (publish.yml filled; others verbatim). */
  content: string;
}

/**
 * Fill the publish copy-template's `{{OWNER}}`/`{{REPO}}`/`{{PACKAGE}}` placeholders.
 * @param template - raw `publish.yml` text containing the placeholders.
 * @param inputs - repo identity (owner, repo, package name) to substitute in.
 * @returns the filled YAML, ready to write.
 */
export function fillPublishTemplate(template: string, inputs: ScaffoldInputs): string {
  return template.replaceAll("{{OWNER}}", inputs.owner).replaceAll("{{REPO}}", inputs.repo).replaceAll("{{PACKAGE}}", inputs.packageName);
}

/**
 * Resolve raw workflow templates into the files to write: `publish.yml` gets its
 * placeholders filled (OIDC binds it per repo); every other `.yml` passes through
 * unchanged. Pure — the IO layer reads the dir and writes the results.
 * @param files - raw templates read from `templates/workflows/`.
 * @param inputs - repo identity used to fill `publish.yml`.
 * @returns the planned files (name + final content) to write into `.github/workflows/`.
 */
export function resolveWorkflows(files: TemplateFile[], inputs: ScaffoldInputs): PlannedFile[] {
  return files
    .filter((f) => f.name.endsWith(".yml"))
    .map((f) => ({ name: f.name, content: f.name === "publish.yml" ? fillPublishTemplate(f.raw, inputs) : f.raw }));
}

// --- IO layer ---------------------------------------------------------------

/** Best-effort (owner, repo) from the target repo's `origin` GitHub remote. */
function gitRemote(root: string): { owner: string; repo: string } | null {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    return m ? { owner: m[1]!, repo: m[2]! } : null;
  } catch {
    return null;
  }
}

/** Resolve the publish placeholders from the target repo (git remote + package.json), warning on gaps. */
function detectInputs(root: string): ScaffoldInputs {
  const remote = gitRemote(root);
  if (!remote) warn("No `origin` GitHub remote found — publish.yml uses OWNER/REPO placeholders; fill them in.");
  const pkg = readJson<{ name?: string }>(path.join(root, "package.json"));
  if (!pkg?.name) warn("No package.json name found — publish.yml uses a placeholder; fill it in.");
  return {
    owner: remote?.owner ?? "OWNER",
    repo: remote?.repo ?? "REPO",
    packageName: pkg?.name ?? "your-package",
  };
}

/** Read every `*.yml` template shipped under `templates/workflows/`. */
function readTemplates(dir: string): TemplateFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yml"))
    .sort()
    .map((name) => ({ name, raw: readFileSync(path.join(dir, name), "utf8") }));
}

/**
 * Copy the CI + publish workflow set into a repo's `.github/workflows/`.
 * @param opts - `path` selects the target repo (default cwd); `force` overwrites existing files.
 */
export function scaffoldCi(opts: { path?: string; force?: boolean }): void {
  const root = path.resolve(opts.path ?? process.cwd());
  intro("dufflebag · scaffold-ci");
  step(c.dim(`target: ${root}`));

  const templateDir = path.join(packageRoot(), "templates", "workflows");
  if (!existsSync(templateDir)) throw new Error(`templates/workflows missing at ${templateDir} — reinstall dufflebag.`);
  const planned = resolveWorkflows(readTemplates(templateDir), detectInputs(root));
  if (planned.length === 0) throw new Error(`No workflow templates found in ${templateDir} — reinstall dufflebag.`);

  const workflowsDir = path.join(root, ".github", "workflows");
  ensureDir(workflowsDir);

  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of planned) {
    const dest = path.join(workflowsDir, file.name);
    if (existsSync(dest) && !opts.force) {
      skipped.push(file.name);
      continue;
    }
    writeFileSync(dest, file.content, "utf8");
    written.push(file.name);
  }

  const lines = [
    ...written.map((n) => `${c.green("✓")} .github/workflows/${n}`),
    ...skipped.map((n) => `${c.yellow("•")} .github/workflows/${n} ${c.dim("exists — kept (use --force to overwrite)")}`),
  ];
  note(lines.join("\n"), written.length > 0 ? "Scaffolded" : "Nothing written (all present)");
  outro(c.dim("Next: register the npm trusted publisher (repo + publish.yml) — see the publish.yml header."));
}
