# dufflebag

<p align="center">
  <img src="public/dufflebag.png" alt="dufflebag logo" width="220" />
</p>

> A one-command installer for a personal bag of [Claude Code](https://claude.com/claude-code) skills and hooks. Pure TypeScript, Node-only, **no Python**.

```bash
npx ys-dufflebag install
```

`dufflebag` wires hooks and skills into your `~/.claude` (or a project's `.claude/`), tunes them to your taste, and removes them just as cleanly. It edits your `settings.json` **surgically** — every bag-owned entry is path-identified, so `uninstall` takes back exactly what it added and never touches your own hooks or config.

---

## Agent skills

<!-- AUTO:SKILLS:START -->
Beyond the installable hooks, dufflebag ships **agent skills** — instruction sets that coding agents (Claude Code, Kiro, Cursor) follow when triggered by natural language:

| Skill | Description | Where |
| --- | --- | --- |
| **agents-sdk** | Build AI agents on Cloudflare Workers using the Agents SDK. Load when creating stateful agents, durable workflows, real-time WebSocket apps, scheduled tasks, MCP servers, chat applications, voice agents, or browser automation. Covers Agent class, state management, callable RPC, Workflows, durable execution, queues, retries, observability, and React hooks. Biases towards retrieval from Cloudflare docs over pre-trained knowledge. | Claude · Kimi · Kiro |
| **ai-browser-bridge** | Drive ChatGPT, Gemini, Claude, DeepSeek, Grok, or Perplexity in a real browser from any agent — one provider or fanned out. Exposes sandboxed local repo tools to ChatGPT over MCP, and serves an outbound MCP `ask` tool so agents can call … | Kiro |
| **ascii-architecture-flow-mapper** | Formats codebase explanations, change summaries, architecture reviews, and implementation guidance as precise ASCII box-and-arrow diagrams, tree maps, and from/to flow maps grounded in inspected files. Use when the user asks for ASCII diagrams, visual summaries, text-based architecture maps, flow diagrams, pipeline maps, dependency maps, "what changed from what to what", or easier-to-scan codebase explanations. | Claude · Kimi · Kiro |
| **autorun** | Drive the autonomous context loop for this session — arm it to auto-/compact and resume work hands-free, or pause/shut it down. Use when the user types /autorun (optionally with a number or `stop`/`exit`), says "autorun", "autopilot", "take it from here", "keep going hands-off", or asks to pause / stop / shut down / exit the auto-compact loop. | dufflebag source · Claude · Kimi · Kiro |
| **building-native-ui** | Complete guide for building beautiful apps with Expo Router. Covers fundamentals, styling, components, navigation, animations, patterns, and native tabs. | Claude · Kimi · Kiro |
| **cloudflare** | Comprehensive Cloudflare platform skill covering Workers, Pages, storage (KV, D1, R2), AI (Workers AI, Vectorize, Agents SDK), feature flags (Flagship), networking (Tunnel, Spectrum), security (WAF, DDoS), and infrastructure-as-code (Terraform, Pulumi). Use for any Cloudflare development task. Biases towards retrieval from Cloudflare docs over pre-trained knowledge. | Claude · Kimi · Kiro |
| **cloudflare-email-service** | Send and receive transactional emails with Cloudflare Email Service (Email Sending + Email Routing). Use when building email sending (Workers binding or REST API), email routing, Agents SDK email handling, or integrating email into any app — Workers, Node.js, Python, Go, etc. Also use for email deliverability, SPF/DKIM/DMARC, wrangler email setup, MCP email tools, or when a coding agent needs to send emails. Even for simple requests like "add email to my Worker" — this skill has critical config details. | Claude · Kimi · Kiro |
| **dba-schema-reviewer** | Reviews existing or planned database structures like a senior DBA, using principle-first schema design with database-specific guidance for SQL, PostgreSQL, MongoDB, and other NoSQL stores. Use when the user asks to improve or reduce database tables, collections, schemas, migrations, Prisma/Drizzle/Mongoose models, PK/FK design, relationships, role-table consolidation, normalization, denormalization, indexes, lean schema migration opportunities, or database architecture. | Claude · Kimi · Kiro |
| **design-an-interface** | Generate multiple radically different interface designs for a module using parallel sub-agents. Use when user wants to design an API, explore interface options, compare module shapes, or mentions "design it twice". | Claude · Kimi · Kiro |
| **deslop** | Reviews code readability first, then applies approved cleanup that makes the full pipeline understandable in seconds. Use when the user says "deslop", "make this readable", "make this less AI", "second pass", "clean this up", "rename for clarity", "show before and after", or asks to improve code comprehension across React, TypeScript, backend, folders, imports, hooks, or functions. | dufflebag source · Claude · Kimi · Kiro |
| **diagnose** | Disciplined diagnosis loop for hard bugs and performance regressions. Reproduce → minimise → hypothesise → instrument → fix → regression-test. Use when user says "diagnose this" / "debug this", reports a bug, says something is broken/throwing/failing, or describes a performance regression. | Claude · Kimi · Kiro |
| **durable-objects** | Create and review Cloudflare Durable Objects. Use when building stateful coordination (chat rooms, multiplayer games, booking systems), implementing RPC methods, SQLite storage, alarms, WebSockets, or reviewing DO code for best practices. Covers Workers integration, wrangler config, and testing with Vitest. Biases towards retrieval from Cloudflare docs over pre-trained knowledge. | Claude · Kimi · Kiro |
| **eas-update-insights** | Check the health of published EAS Updates: crash rates, install/launch counts, unique users, payload size, and the split between embedded and OTA users per channel. Use when the user asks how an update is performing, whether a rollout is healthy, how many users are on the embedded build vs OTA, or wants to gate CI on update health. | Claude · Kimi · Kiro |
| **Expo UI Jetpack Compose** | `@expo/ui/jetpack-compose` package lets you use Jetpack Compose Views and modifiers in your app. | Claude · Kimi · Kiro |
| **Expo UI SwiftUI** | `@expo/ui/swift-ui` package lets you use SwiftUI Views and modifiers in your app. | Claude · Kimi · Kiro |
| **expo-api-routes** | Guidelines for creating API routes in Expo Router with EAS Hosting | Claude · Kimi · Kiro |
| **expo-cicd-workflows** | Helps understand and write EAS workflow YAML files for Expo projects. Use this skill when the user asks about CI/CD or workflows in an Expo or EAS context, mentions .eas/workflows/, or wants help with EAS build pipelines or deployment automation. | Claude · Kimi · Kiro |
| **expo-deployment** | Deploying Expo apps to iOS App Store, Android Play Store, web hosting, and API routes | Claude · Kimi · Kiro |
| **expo-dev-client** | Build and distribute Expo development clients locally or via TestFlight | Claude · Kimi · Kiro |
| **expo-module** | Guide for creating and writing Expo native modules and views using the Expo Modules API (Swift, Kotlin, TypeScript). Covers module definition DSL, native views, shared objects, config plugins, lifecycle hooks, autolinking, and type system. Use when building or modifying native modules for Expo. | Claude · Kimi · Kiro |
| **expo-tailwind-setup** | Set up Tailwind CSS v4 in Expo with react-native-css and NativeWind v5 for universal styling | Claude · Kimi · Kiro |
| **grill-me** | Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me". | dufflebag source · Claude · Kimi · Kiro |
| **grill-me-code-style** | Grill the user on how a NEW/greenfield project is built — code style, structure docs, and CLI — then render an HTML plan and, on approval, write CODE-STYLE.md + a formatter config and refresh the AGENTS.md digest. Ensures PROJECT.md/CONTEXT.md/LANGUAGE.md exist (create if missing, validate if present) and grills real code idioms + formatting, not just architecture. Use when setting up or reorganizing a new project, when there is little/no code, or when defining coding style, structure, or CLI conventions from scratch. For an existing codebase, use grill-me-code-style-with-docs instead. | dufflebag source · Claude · Kimi · Kiro |
| **grill-me-code-style-with-docs** | Grill the user on how an EXISTING codebase is built — code style, structure docs, and CLI — using the real code as evidence, then render an HTML plan and, on approval, write/update CODE-STYLE.md + a formatter config and refresh the AGENTS.md digest. Ensures PROJECT.md/CONTEXT.md/LANGUAGE.md exist (create if missing, validate if present), fans out sub-agents for the most-repeated patterns, grills real code idioms + formatting with before/after, audits deps, and references official framework skills. Use when defining/updating style, structure, or CLI conventions for a repo with meaningful code. For a brand-new or empty project, use grill-me-code-style instead. | dufflebag source · Claude · Kimi · Kiro |
| **grill-with-docs** | Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against their project's language and documented decisions. | dufflebag source · Claude · Kimi · Kiro |
| **handoff** | Compact the current conversation into a handoff document for another agent to pick up. | Claude · Kimi · Kiro |
| **improve-codebase-architecture** | Find deepening opportunities in a codebase, informed by the domain language in CONTEXT.md and the decisions in docs/adr/. Use when the user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more testable and AI-navigable. | Claude · Kimi · Kiro |
| **interactive-cli-reviewer** | Reviews and sharpens existing interactive CLI/TUI products by discovering command entrypoints, prompt flows, async data, runtime states, and terminal UX before proposing changes. Use when the user wants to create, audit, polish, or modify a CLI/TUI, terminal wizard, Ink app, Commander/Inquirer/prompts/yargs/oclif workflow, or dynamic API-backed interactive CLI. | Claude · Kimi · Kiro |
| **jsdoc-editor** | Creates or rewrites JSDoc/TSDoc comments for existing TypeScript and JavaScript interfaces, types, functions, hooks, classes, and exported APIs. Use when the user asks to add, improve, modify, clean, standardize, or review JSDoc/TSDoc/doc comments, especially when they provide comment-writing instructions or want comments that follow existing project style. | Claude · Kimi · Kiro |
| **native-data-fetching** | Use when implementing or debugging ANY network request, API call, or data fetching. Covers fetch API, React Query, SWR, error handling, caching, offline support, and Expo Router data loaders (`useLoaderData`). | Claude · Kimi · Kiro |
| **planpage** | Render a skill's plan, review gate, or report as a beautiful, self-contained, INTERACTIVE HTML page — via the open-source planpage package (Preact components → static HTML + a local post-back server so the user can approve / adjust / flip decisions in the browser and the choice comes straight back to the agent). Use whenever a skill needs an approval gate, a decision review, or a shareable before/after report — author with the kit's components instead of hand-rolling HTML each time. | dufflebag source · Claude · Kimi · Kiro |
| **png-to-code** | Convert a PNG design into pixel-perfect code — SVG illustrations/logos, HTML/CSS UI, and animations — using a decompose → reuse-or-build → render → screenshot-diff → refine loop that measurably converges to a 1:1 match instead of eyeballing. Use when the user provides a PNG, screenshot, mockup, or inspiration image and wants it turned into SVG, HTML/CSS, a web component, or an animated illustration, or asks to match a design "pixel-perfect" / "1:1". | dufflebag source · Claude · Kimi · Kiro |
| **prototype** | Build a throwaway prototype to flesh out a design before committing to it. Routes between two branches — a runnable terminal app for state/business-logic questions, or several radically different UI variations toggleable from one route. Use when the user wants to prototype, sanity-check a data model or state machine, mock up a UI, explore design options, or says "prototype this", "let me play with it", "try a few designs". | Claude · Kimi · Kiro |
| **qa** | Interactive QA session where user reports bugs or issues conversationally, and the agent files GitHub issues. Explores the codebase in the background for context and domain language. Use when user wants to report bugs, do QA, file issues conversationally, or mentions "QA session". | Claude · Kimi · Kiro |
| **readme-editor** | Create or edit a project's landing documentation set — README.md, AGENTS.md, CLAUDE.md, .github/copilot-instructions.md, and llms.txt — by first deciding which artifacts the repo actually needs, then grilling the user one question at a time with recommended defaults, building a compact README map, and only then writing. Inspects the repo before asking anything discoverable. Use when the user wants to create, write, edit, rewrite, audit, polish, or "fix up" a README, AGENTS.md, CLAUDE.md, Copilot instructions, llms.txt, or any project landing/onboarding docs. | Claude · Kimi · Kiro |
| **sandbox-sdk** | Build sandboxed applications for secure code execution. Load when building AI code execution, code interpreters, CI/CD systems, interactive dev environments, or executing untrusted code. Covers Sandbox SDK lifecycle, commands, files, code interpreter, and preview URLs. Biases towards retrieval from Cloudflare docs over pre-trained knowledge. | Claude · Kimi · Kiro |
| **setup-matt-pocock-skills** | Sets up an `## Agent skills` block in AGENTS.md/CLAUDE.md and `docs/agents/` so the engineering skills know this repo's issue tracker (GitHub or local markdown), triage label vocabulary, and domain doc layout. Run before first use of `to-issues`, `to-prd`, `triage`, `diagnose`, `tdd`, `improve-codebase-architecture`, or `zoom-out` — or if those skills appear to be missing context about the issue tracker, triage labels, or domain docs. | Claude · Kimi · Kiro |
| **setup-pre-commit** | Set up Husky pre-commit hooks with lint-staged (Prettier), type checking, and tests in the current repo. Use when user wants to add pre-commit hooks, set up Husky, configure lint-staged, or add commit-time formatting/typechecking/testing. | Claude · Kimi · Kiro |
| **tdd** | Test-driven development with red-green-refactor loop. Use when user wants to build features or fix bugs using TDD, mentions "red-green-refactor", wants integration tests, or asks for test-first development. | Claude · Kimi · Kiro |
| **teach** | Teach the user a new skill or concept, within this workspace. | Claude · Kimi · Kiro |
| **to-issues** | Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker using tracer-bullet vertical slices. Use when user wants to convert a plan into issues, create implementation tickets, or break down work into issues. | Claude · Kimi · Kiro |
| **to-prd** | Turn the current conversation context into a PRD and publish it to the project issue tracker. Use when user wants to create a PRD from the current context. | Claude · Kimi · Kiro |
| **triage** | Triage issues through a state machine driven by triage roles. Use when user wants to create an issue, triage issues, review incoming bugs or feature requests, prepare issues for an AFK agent, or manage issue workflow. | Claude · Kimi · Kiro |
| **upgrading-expo** | Guidelines for upgrading Expo SDK versions and fixing dependency issues | Claude · Kimi · Kiro |
| **use-dom** | Use Expo DOM components to run web code in a webview on native and as-is on web. Migrate web code to native incrementally. | Claude · Kimi · Kiro |
| **web-perf** | Analyzes web performance using Chrome DevTools MCP. Measures Core Web Vitals (LCP, INP, CLS) and supplementary metrics (FCP, TBT, Speed Index), identifies render-blocking resources, network dependency chains, layout shifts, caching issues, and accessibility gaps. Use when asked to audit, profile, debug, or optimize page load performance, Lighthouse scores, or site speed. Biases towards retrieval from current documentation over pre-trained knowledge. | Claude · Kimi · Kiro |
| **workers-best-practices** | Reviews and authors Cloudflare Workers code against production best practices. Load when writing new Workers, reviewing Worker code, configuring wrangler.jsonc, or checking for common Workers anti-patterns (streaming, floating promises, global state, secrets, bindings, observability). Biases towards retrieval from Cloudflare docs over pre-trained knowledge. | Claude · Kimi · Kiro |
| **wrangler** | Cloudflare Workers CLI for deploying, developing, and managing Workers, KV, R2, D1, Vectorize, Hyperdrive, Workers AI, Containers, Queues, Workflows, Pipelines, and Secrets Store. Load before running wrangler commands to ensure correct syntax and best practices. Biases towards retrieval from Cloudflare docs over pre-trained knowledge. | Claude · Kimi · Kiro |
| **write-a-skill** | Create new agent skills with proper structure, progressive disclosure, and bundled resources. Use when user wants to create, write, or build a new skill. | Claude · Kimi · Kiro |
| **zoom-out** | Tell the agent to zoom out and give broader context or a higher-level perspective. Use when you're unfamiliar with a section of code or need to understand how it fits into the bigger picture. | Claude · Kimi · Kiro |

Skills are installed alongside hooks into your agent's skills directory. They require no configuration — just ask your agent to do the thing (e.g. "deslop this", "grill me", "convert this PNG to code").
<!-- AUTO:SKILLS:END -->

---

## What's in the bag

These are the runtime features dufflebag installs as hooks. Some features also ship a corresponding skill in the table above (e.g. `png-to-code`, `autorun`).

<!-- AUTO:FEATURES:START -->
| Feature | What it does | Runs on |
| --- | --- | --- |
| **context-guard** | Nudge a /handoff at ~18% of the model window and hard-deny new code edits at ~20%, so long sessions wind down gracefully instead of ballooning past usable context. | 🟢 any OS |
| **dedup-guard** | Block a Write/Edit that pastes a function body or interface/type shape already defined elsewhere in the repo — DRY enforced at the moment of the write. Uses the repo's own TypeScript; deny by default (tune with dufflebagDedupEnforcement). Also wires Cursor (warn) + an AGENTS.md rule for Codex. | 🟢 any OS |
| **autonomous-loop** | A SessionStart daemon that auto-/compacts and resumes work hands-free once context nears the guardrail and a fresh handoff exists. macOS + Ghostty only (it types into your terminal window). | 🔴 macOS + Ghostty |
| **speak-response** | A Stop hook that speaks Claude's prose (code blocks stripped) via the macOS `say` command. macOS only. | 🟡 macOS |
| **png-to-code** | A skill that turns a PNG design (illustration, logo, UI mockup) into SVG/HTML/CSS that measurably converges to a 1:1 match — a decompose → reuse-or-build → render → screenshot-diff → refine loop, plus a rig-first doctrine for animation. Pure skill (no hooks); its diff harness needs Node + Playwright. | 🟢 any OS |
<!-- AUTO:FEATURES:END -->

`context-guard` is the safe default. The autonomous loop is **experimental and macOS+Ghostty-only** because it works by typing `/compact` into your terminal window via AppleScript — every keystroke is gated behind a wall of safety checks (see [How it works](#how-it-works)).

> **Heads up:** the autonomous loop types into your terminal. Install it only if you understand and want that. The kill switch is always one command away: `touch ~/.claude/.ctx-guard-off`.

---

## Install

```bash
# Interactive — pick features, install to ~/.claude
npx ys-dufflebag install

# Non-interactive (CI / scripted)
npx ys-dufflebag install --yes --features context-guard,dedup-guard,autonomous-loop,speak-response,png-to-code

# Project scope — writes ./.claude and commits the payload so teammates get it on clone
npx ys-dufflebag install --project
```

After installing, **restart Claude Code** (or start a new session) so the hooks load.

Requirements: **Node ≥ 20**. The autonomous loop additionally needs **macOS + Ghostty**; `speak-response` needs **macOS**. `dufflebag doctor` tells you what's satisfied.

### Interactive setup

Run `npx ys-dufflebag install` with no flags and it walks you through a short, animated TUI:

```text
┌   dufflebag · install · global
│
◇  Agents detected ─────────────────────────────╮
│  ✓ Claude Code — install target                │
│  • Cursor — detected · adapter tracked in #5   │
│  • Codex — detected · adapter tracked in #5    │
├───────────────────────────────────────────────╯
│
◆  Which features do you want to install?
│  ◼ context-guard    (any OS)
│  ◻ dedup-guard      (any OS · needs the repo's TypeScript)
│  ◻ autonomous-loop  (macos+ghostty)
│  ◻ speak-response   (macos)
│  ◻ png-to-code      (any OS · Node + Playwright)
└
```

1. **Agent detection.** dufflebag scans your machine for installed coding agents. **Claude Code** is the install target today; a detected **Cursor** or **Codex** is listed too, but dufflebag leaves them untouched for now — adapters are tracked in [#5](https://github.com/YosefHayim/dufflebag/issues/5).
2. **Feature pick.** Choose what to install — `context-guard` is preselected as the safe default.
3. **Ghostty bootstrap.** If you pick the **autonomous loop** on macOS and Ghostty isn't installed, dufflebag offers to install it for you (the loop can drive no other terminal):

   ```text
   ◆  Ghostty isn't installed — install it now with Homebrew? (required for /autorun)
   │  ●  Yes   ○  No
   ```

   - **Yes** → runs `brew install --cask ghostty`, then continues.
   - **No** → the loop still installs but stays **inert**: `/autorun` can't run without Ghostty, while `context-guard` keeps working everywhere. (No Homebrew on PATH? It prints the manual install link instead of offering.)

`dufflebag doctor` reports the same host + agent detection any time, read-only.

## Configure

All tunables live as `dufflebag*` camelCase environment variables in your `settings.json` — one source of truth shared by the guard and the daemon, so thresholds can't drift.

```bash
dufflebag config                       # show effective values
dufflebag config --warn 0.15           # nudge earlier
dufflebag config --block 0.22 --budget 5
```

| Flag | Env var | Default | Meaning |
| --- | --- | --- | --- |
| `--warn` | `dufflebagContextWarnFraction` | `0.18` | Fraction of the window at which to nudge `/handoff` |
| `--block` | `dufflebagContextBlockFraction` | `0.20` | Fraction at which to hard-deny code edits |
| `--budget` | `dufflebagAutorunDefaultCycleCount` | `10` | Cycles for a bare `/autorun` |
| `--hard-cap` | `dufflebagAutorunMaxCycleCount` | `50` | Absolute anti-runaway ceiling |
| `--poll` | `dufflebagAutorunPollIntervalSeconds` | `5` | Daemon poll interval |
| `--idle` | `dufflebagAutorunIdleThresholdSeconds` | `8` | Quiescence required before the daemon counts a turn as idle |
| `--tts-voice` | `dufflebagSpeechVoice` | `Samantha` | macOS `say` voice |
| `--tts-rate` | `dufflebagSpeechWordsPerMinute` | `230` | TTS words per minute |
| `--dedup-mode` | `dufflebagDedupEnforcement` | `deny` | dedup-guard enforcement: `deny` · `warn` · `off` |
| `--dedup-skip` | `dufflebagDedupSkipDirectories` | _(none)_ | extra dir names dedup-guard ignores (comma list) |

Project `settings.json` overrides global, so different repos can run different thresholds. The guard sees changes immediately; an already-running autorun daemon picks them up on the next session.

## Commands

Run **`dufflebag`** with no command in a terminal and you get an **interactive menu** — pick an action and it walks you through the options (scope, features, tunables); the same command functions the flags below drive run underneath. Pass any command or `--flag` (or pipe it, e.g. in CI) to skip the menu.

| Command | Description |
| --- | --- |
| `dufflebag` · `dufflebag menu` | Interactive menu (the default in a terminal with no command) |
| `dufflebag install` | Install (or re-run to refresh) the selected features |
| `dufflebag update` | Refresh hook code, keep your features **and** your tuned config |
| `dufflebag uninstall` | Surgically remove everything the bag added |
| `dufflebag config` | Show or change tunables |
| `dufflebag dedup check` | Scan for duplicate functions/types; exits non-zero on findings (pre-commit / CI gate) |
| `dufflebag doctor` | Read-only health check across global + project scopes |

All commands take `--global` (default) or `--project`.

## Using the autonomous loop

In a session (macOS + Ghostty):

```text
/autorun 5     → arm the loop for up to 5 compact cycles
/autorun stop  → pause (re-arm later with /autorun)
/autorun exit  → shut the daemon down for this session
```

While armed, **you** make each compaction safe: run `/handoff` to save a resume doc before the guardrail, and write the done-marker (the guard message tells you the exact path) when the task is genuinely finished — instead of another handoff — to halt the loop.

---

## Dedup guard

`dedup-guard` stops the most common form of AI slop — the same function or type re-pasted under a new name — at the moment it's written. It parses the added code with the repo's **own** TypeScript (nothing is bundled), fingerprints each named function body (alpha-canonical, so a renamed copy still matches) and each object-type shape (field-order independent), and compares against a cached index of the whole repo.

```bash
# add it to any TypeScript repo (--project commits the wiring for teammates)
npx ys-dufflebag install --project --features dedup-guard
```

**Enforcement is per-agent — bounded by what each platform actually allows:**

| Agent | What you get | How |
| --- | --- | --- |
| **Claude Code** | hard **deny** before the write lands | `PreToolUse` hook |
| **Cursor** | **warn** after the edit (no native before-edit deny exists) | `afterFileEdit` in `.cursor/hooks.json` |
| **Codex** | an **AGENTS.md** rule + the `dedup check` command | Codex's `PreToolUse` only intercepts Bash, so edits can't be hooked |

So a duplicate is blocked on Claude, flagged on Cursor, and — on any agent that can't hook a file edit — caught by the command, which doubles as a **pre-commit / CI gate**:

```bash
dufflebag dedup check                 # scan the repo; exits non-zero on duplicates
dufflebag dedup check --staged        # only files staged for commit (pre-commit)
dufflebag dedup check --since main    # only files changed vs a ref (PR / CI)
```

Tune it with `dufflebagDedupEnforcement` (`deny` · `warn` · `off`) and exclude generated/scaffold dirs with `dufflebagDedupSkipDirectories` (e.g. a monorepo's `templates`). A genuinely intentional duplicate? Append `// dup-ignore` to the declaration's first line — honored by both the live hooks and `dedup check`.

> **No TypeScript in the repo → no guard.** dedup-guard resolves the project's own `typescript`; a repo without it is reported by `doctor`, the hook fails open (allows the edit), and `dedup check` reports it as un-checkable and exits 0 rather than failing CI.

---

## PNG → pixel-perfect code

`png-to-code` is a **skill** (no hooks): instructions + a small verification harness Claude follows to reproduce a PNG design as code that matches the original **1:1**. The discipline is that a *measured pixel diff* — not the eye — is the source of truth, so the agent converges slowly and provably instead of declaring "looks close."

```bash
# add just this skill (any OS)
npx ys-dufflebag install --features png-to-code
```

The loop: **decompose** the image into ordered regions → **reuse or build** vectors (search existing SVG libraries first, trace/hand-build only the gap) → **render + screenshot-diff** against the target → **refine the biggest hotspot** and re-measure, one change per iteration, until the mismatch ratio is below 0.1%. Animated figures follow a **rig-first doctrine** (slice at joints, pivot at the joint, parent, overlap) so motion is trivial keyframes on already-correct pivots.

It ships its own harness under the skill's `scripts/` — a one-time setup installs it:

```bash
cd ~/.claude/skills/png-to-code/scripts && npm i && npx playwright install chromium
```

`src/bin/pixelDiff.ts` (Playwright render + `pixelmatch`) reports the ratio and a hotspot grid; `inspectPng.ts` samples dimensions/colors; `frames.ts` contact-sheets animation poses. All TypeScript, run via `tsx` from `scripts/`. Without Node/Playwright the skill falls back to a manual overlay and says plainly that the match is eyeballed, not measured.

---

## How it works

```
            settings.json (yours, edited surgically)
            ├─ hooks  → node "~/.claude/dufflebag/hooks/<hook>.js"   (path-identified)
            └─ env    → dufflebag*                                   (prefix-identified)

  PreToolUse / PostToolUse / UserPromptSubmit ─▶ contextGuard.js   reads context %, nudges/denies
  PreToolUse (Write|Edit|MultiEdit)           ─▶ dedupGuard.js     denies a duplicate fn/type (DRY)
  SessionStart                                ─▶ ctxWatchSpawn.js  launches the daemon (disarmed)
  Stop                                        ─▶ speakResponse.js  speaks the turn (macOS)

  /autorun · /autorun stop · /autorun exit    ─▶ ctxLoopCtl.js     arms/pauses/exits + reports
  ctxWatch.js (daemon, one per session)       ─▶ types /compact    only when EVERY gate passes
```

The daemon never types unless **all** of these hold: the session is armed; context is ≥ warn %; a *fresh* handoff doc exists; the turn is idle; Ghostty is frontmost; this session's window is uniquely located (it refuses rather than guess); and a global keystroke mutex is held so parallel armed sessions can't interleave. A hard cap, kill switches (`~/.claude/.ctx-guard-off` and `/autorun exit`), and self-reap on a stale/dead session bound it. Every hook is **fail-open** — any error allows the tool through; the guard never blocks because of its own bug.

### Install layout

```
~/.claude/
├─ settings.json            # your file; bag hooks + dufflebag* env merged in, backed up first
├─ dufflebag/
│  ├─ hooks/                # the self-contained compiled hook payload (bare Node, zero deps)
│  ├─ manifest.json         # what this scope installed (features, skills, version)
│  └─ package.json          # { "type": "module" } so the ESM hooks run as bare files
└─ skills/
   ├─ autorun/                        # only with the autonomous loop
   └─ png-to-code/                    # only with the png-to-code feature
```

The CLI uses [`commander`](https://github.com/tj/commander.js), [`@clack/prompts`](https://github.com/bombshell-dev/clack), and [`picocolors`](https://github.com/alexeyraspopov/picocolors) for the interactive UX; the **hook payload depends on nothing** so it runs the instant a hook fires.

## Uninstall

```bash
dufflebag uninstall            # global
dufflebag uninstall --project  # project
```

Removes the bag's hooks (by path marker), `dufflebag*` env keys (by prefix), the installed skills, and the payload dir — backing up `settings.json` first. Your own hooks, env, and settings are untouched, and timestamped backups remain next to `settings.json` for rollback.

## Development

```bash
pnpm install
pnpm build        # tsc → dist/
pnpm test         # vitest
pnpm typecheck
pnpm dev -- install --project   # run the CLI from source
```

## License

[MIT](./LICENSE) © Yosef Hayim Sabag
