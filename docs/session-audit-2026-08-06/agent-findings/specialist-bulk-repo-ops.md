# Specialist: bulk multi-repo ops on ~/Desktop/Code

**Scope:** clone/duplicate GH repos, bulk `pnpm install`, kill ports, statusline install, multi-repo sync.  
**Sources:** `job-like-prompts.jsonl`, `exact-clusters.json`, `intent-refined.json`, `installed-skills.json`, `statuslines/codex/`.  
**Installed skills with overlap:** none for clone/install/kill-ports; `githubRepoMetadata` is About/topics only; `coordinateWorktrees` for erase-worktrees; statusline is already a **script artifact** not a skill.

---

## Jobs (count-like evidence)

| # | Job | Evidence | Sessions / notes |
|---|-----|----------|------------------|
| A | **Clone all user GH repos → Code** (“duplicate every repo… Oly-App”, “without installs just duplicate”) | exact: 3+2; intent `duplicate_clone_repos` **7** prompts / **7** sessions | codex; target `~/Desktop/Code` |
| B | **Clone org repos** (vybekiit, genshot.dev) | exact: 2+2 (two phrasings) | same wave as A (2026-07-30) |
| C | **Bulk pnpm install** each Code child, skip npm-only | exact: 2 (history↔session dup) | follow-on to A/B |
| D | **Pull every repo / all remote branches**; report per-repo delta | exact: 2 | next-day hygiene (2026-07-31) |
| E | **Kill local ports** (often “except metro”/8081; optional relaunch) | intent `kill_ports_local_dev` **11** / **9** sessions; fuzzy high-conf cluster | codex+grok; Code + MYPR-App |
| F | **Statusline configure + capture** (`/statusline` show/edit; “add … statuslines/codex”) | exact: 2+2+2 | codex; **already shipped** as `statuslines/codex/install.sh` |
| G | **Destructive cleanup adjacent** | “Template repo delete completely”; “erase worktrees… confirm first”; “sync to remote?” | low count; high blast radius |

History + session_jsonl double-count many rows; treat **unique sessions / exact `count`** as the signal, not raw jsonl lines.

---

## Create skill?

| Job | Recommendation | Why |
|-----|----------------|-----|
| A+B+D | **create** `bulkGhCloneSync` (or `codeFolderRepoSync`) | Stable freeform; no skill; intent already `create`. Do **not** fold into `githubRepoMetadata`. |
| C | **create** same skill (phase) or thin sibling | Deterministic after clone; package-manager guard is the point |
| E | **create** `killPortsLocalDev` | Highest repeat among this family (11/9); fixed phrase surface |
| F | **leave** (artifact) / optional skill trigger → run `./statuslines/codex/install.sh` | Capture already done; skill only if freeform reinstalls recur |
| G | **improve** `coordinateWorktrees` for confirm-before erase | Not a new bulk-clone skill |

---

## Safety (destructive)

- **Clone into existing dirs:** skip if `.git` present unless user says overwrite; never `rm -rf` without explicit confirm.
- **Bulk install:** only dirs with lockfile/package.json; respect packageManager / npm-only (user: “except the ones who use npm”); no global toolchain install unless named (e.g. rustup for one repo).
- **Kill ports:** list PIDs/ports first; default keep metro **8081**; never kill system-critical services; confirm if phrase is “all” with no exceptions.
- **Delete Template / erase worktrees:** confirm list, then remove; user already asks “confirm before erasing.”
- **Auth:** `gh` must be authenticated; clone private orgs only via user-owned tokens.

---

## Deterministic steps (skill skeletons)

### bulkGhCloneSync
1. Root = `~/Desktop/Code` (or cwd if already there).  
2. `gh repo list <user> --limit 200 --json name,sshUrl,isPrivate` (+ org flags for named orgs).  
3. For each: if `./$name` missing → `git clone`; if present → skip or `git fetch --all --prune` + pull default branch.  
4. Flags: `--no-install` (default when user says “without installs”); `--install` → job C.  
5. Report table: name | action | commits behind/ahead | error.

### bulkPnpmInstall
1. Scan Code/* with package.json; detect npm-only (`packageManager`, lockfiles, “configured to use npm”).  
2. `pnpm install` only pnpm/yarn-eligible; record skip reasons.  
3. Parallelism cap; fail-soft per repo.

### killPortsLocalDev
1. Parse keep-set (metro/8081 default if mentioned).  
2. Enumerate LISTEN ports (lsof/ss); exclude keep-set.  
3. Dry-run list → kill only user-owned listeners → optional `launch <app> local`.

### statusline (existing)
1. `./statuslines/codex/install.sh` → updates `tui.status_line` only; backs up config.toml.

---

## Bottom line

Bulk Code-folder GH clone/sync + bulk pnpm + kill-ports are **real, repeated, skill-worthy** jobs. Statusline is **done as install script**. Pair clone skill with hard safety gates; treat delete/erase as confirm-gated, not auto.
