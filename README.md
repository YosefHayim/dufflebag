# dufflebag

<p align="center">
  <img src="public/dufflebag.png" alt="dufflebag logo" width="220" />
</p>

`dufflebag` is a one-command installer for Yosef's reusable [Claude Code](https://code.claude.com/docs/en/overview) skills, hooks, and repo templates. It is a [TypeScript](https://www.typescriptlang.org/) CLI for [Node.js](https://nodejs.org/en), built with [pnpm](https://pnpm.io/), [Biome](https://biomejs.dev/), and [Vitest](https://vitest.dev/).

It installs into global `~/.claude` or project-local `.claude/`, edits `settings.json` surgically, and removes only entries it owns. The shipped skills target Claude Code first, while the docs and some skills also account for [Cursor](https://cursor.com/docs), [OpenAI Codex](https://developers.openai.com/codex), [Kiro](https://kiro.dev/docs/steering/), [Gemini CLI](https://geminicli.com/docs/cli/gemini-md/), and [Roo Code](https://docs.roocode.com/features/custom-instructions/).

## Quick start

Install the safe default context guard globally:

```bash
npx ys-dufflebag install --yes --features context-guard
```

Then restart Claude Code so hooks and skills load in the next session.

For a repo-local install that can be committed with the project:

```bash
npx ys-dufflebag install --project
```

## Usage

Run the interactive installer:

```bash
npx ys-dufflebag install
```

Install a specific skill or hook set:

```bash
npx ys-dufflebag install --features readme-editor,refresh-agent-docs
npx ys-dufflebag install --features dedup-guard
npx ys-dufflebag install --features png-to-code
```

Keep an existing install and refresh the copied payload:

```bash
dufflebag update
```

Remove only dufflebag-owned hooks, env keys, payload files, and installed skills:

```bash
dufflebag uninstall
dufflebag uninstall --project
```

Inspect host support and installed state without changing files:

```bash
dufflebag doctor
```

Tune guard and loop behavior through the same `dufflebag*` settings keys the hooks read:

```bash
dufflebag config
dufflebag config --warn 0.15 --block 0.22 --budget 5
```

## What it installs

`context-guard` is the safe default. `dedup-guard` blocks duplicate TypeScript functions and type shapes at write time where the agent platform supports it. `autonomous-loop` and `speak-response` are macOS-specific conveniences. The remaining entries are pure skills with no hooks.

<!-- AUTO:FEATURES:START -->
| Feature | What it does | Runs on |
| --- | --- | --- |
| **context-guard** | Nudge a /handoff at ~18% of the model window and hard-deny new code edits at ~20%, so long sessions wind down gracefully instead of ballooning past usable context. | 🟢 any OS |
| **dedup-guard** | Block a Write/Edit that pastes a function body or interface/type shape already defined elsewhere in the repo — DRY enforced at the moment of the write. Uses the repo's own TypeScript; deny by default (tune with dufflebagDedupEnforcement). Also wires Cursor (warn) + an AGENTS.md rule for Codex. | 🟢 any OS |
| **autonomous-loop** | A SessionStart daemon that auto-/compacts and resumes work hands-free once context nears the guardrail and a fresh handoff exists. macOS + Ghostty only (it types into your terminal window). | 🔴 macOS + Ghostty |
| **speak-response** | A Stop hook that speaks Claude's prose (code blocks stripped) via the macOS `say` command. macOS only. | 🟡 macOS |
| **png-to-code** | A skill that turns a PNG design (illustration, logo, UI mockup) into SVG/HTML/CSS that measurably converges to a 1:1 match — a decompose → reuse-or-build → render → screenshot-diff → refine loop, plus a rig-first doctrine for animation. Pure skill (no hooks); its diff harness needs Node + Playwright. | 🟢 any OS |
| **write-a-post** | A skill that writes a portfolio blog post in the owner's exact voice, scaffolds it into the blog data file via a one-command dev script, and generates a matching cover image by driving a real ChatGPT browser conversation through ai-browser-bridge (attaching the likeness photo + an existing cover so the character and flat-2D style stay consistent). Pure skill (no hooks). | 🟢 any OS |
| **readme-editor** | A skill that audits and rewrites README.md, AGENTS.md, CLAUDE.md, Copilot instructions, and llms.txt from repo evidence, with official links for named tools and technologies. Pure skill (no hooks). | 🟢 any OS |
| **refresh-agent-docs** | A skill that refetches current official guidance for AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, Kiro steering, Roo rules, and Codex instructions before rewriting repo agent docs. Pure skill (no hooks). | 🟢 any OS |
<!-- AUTO:FEATURES:END -->

## Agent skills

<!-- AUTO:SKILLS:START -->
Beyond the installable hooks, dufflebag ships **agent skills** — instruction sets that coding agents (Claude Code, Kiro, Cursor) follow when triggered by natural language:

| Skill | Description | Where |
| --- | --- | --- |
| **autorun** | Drive the autonomous context loop for this session — arm it to auto-/compact and resume work hands-free, or pause/shut it down. Use when the user types /autorun (optionally with a number or `stop`/`exit`), says "autorun", "autopilot", "take it from here", "keep going hands-off", or asks to pause / stop / shut down / exit the auto-compact loop. | dufflebag source |
| **deslop** | Reviews code readability first, then applies approved cleanup that makes the full pipeline understandable in seconds. Use when the user says "deslop", "make this readable", "make this less AI", "second pass", "clean this up", "rename for clarity", "show before and after", or asks to improve code comprehension across React, TypeScript, backend, folders, imports, hooks, or functions. | dufflebag source |
| **grill-me** | Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me". | dufflebag source |
| **grill-me-code-style** | Grill the user on how a NEW/greenfield project is built — code style, structure docs, and CLI — then render an HTML plan and, on approval, write CODE-STYLE.md + a formatter config and refresh the AGENTS.md digest. Ensures PROJECT.md/CONTEXT.md/LANGUAGE.md exist (create if missing, validate if present) and grills real code idioms + formatting, not just architecture. Use when setting up or reorganizing a new project, when there is little/no code, or when defining coding style, structure, or CLI conventions from scratch. For an existing codebase, use grill-me-code-style-with-docs instead. | dufflebag source |
| **grill-me-code-style-with-docs** | Grill the user on how an EXISTING codebase is built — code style, structure docs, and CLI — using the real code as evidence, then render an HTML plan and, on approval, write/update CODE-STYLE.md + a formatter config and refresh the AGENTS.md digest. Ensures PROJECT.md/CONTEXT.md/LANGUAGE.md exist (create if missing, validate if present), fans out sub-agents for the most-repeated patterns, grills real code idioms + formatting with before/after, audits deps, and references official framework skills. Use when defining/updating style, structure, or CLI conventions for a repo with meaningful code. For a brand-new or empty project, use grill-me-code-style instead. | dufflebag source |
| **grill-with-docs** | Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against their project's language and documented decisions. | dufflebag source |
| **planpage** | Render a skill's plan, review gate, or report as a beautiful, self-contained, INTERACTIVE HTML page — via the open-source planpage package (Preact components → static HTML + a local post-back server so the user can approve / adjust / flip decisions in the browser and the choice comes straight back to the agent). Use whenever a skill needs an approval gate, a decision review, or a shareable before/after report — author with the kit's components instead of hand-rolling HTML each time. | dufflebag source |
| **png-to-code** | Convert a PNG design into pixel-perfect code — SVG illustrations/logos, HTML/CSS UI, and animations — using a decompose → reuse-or-build → render → screenshot-diff → refine loop that measurably converges to a 1:1 match instead of eyeballing. Use when the user provides a PNG, screenshot, mockup, or inspiration image and wants it turned into SVG, HTML/CSS, a web component, or an animated illustration, or asks to match a design "pixel-perfect" / "1:1". | dufflebag source |
| **readme-editor** | Create or edit a project's landing documentation set — README.md, AGENTS.md, CLAUDE.md, .github/copilot-instructions.md, and llms.txt — by first deciding which artifacts the repo actually needs, then grilling the user one question at a time with recommended defaults, building a compact README map, using official hyperlinks for named tools and technologies, and only then writing. Inspects the repo before asking anything discoverable. Use when the user wants to create, write, edit, rewrite, audit, polish, or "fix up" a README, AGENTS.md, CLAUDE.md, Copilot instructions, llms.txt, or any project landing/onboarding docs. | dufflebag source |
| **refresh-agent-docs** | Use when refreshing, rewriting, syncing, or creating repository agent instruction files such as AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, Kiro steering, Roo rules, Codex instructions, or root project context docs. | dufflebag source |
| **write-a-post** | Write a new blog post for Joseph Sabag's portfolio in his exact voice, scaffold it into clientV3/src/data/blog.ts via scripts/dev/new-post.mjs, and generate a matching cover image by driving a real ChatGPT browser conversation through ai-browser-bridge (attaching the likeness photo + an existing cover as references). Use when the user wants to write, draft, add, or publish a blog post / portfolio post, or says "write a post", "new blog post", "post in my voice", or hands over a title/theme + body for the blog. | dufflebag source |

Skills are installed alongside hooks into your agent's skills directory. They require no configuration — just ask your agent to do the thing (e.g. "deslop this", "grill me", "convert this PNG to code").
<!-- AUTO:SKILLS:END -->

## Scope

This repository is the source of truth for dufflebag-owned skills and hooks. It is not a general agent marketplace, does not install arbitrary third-party skill folders, and does not own runtime behavior for every agent listed above. When a platform cannot enforce a hook before an edit, dufflebag documents the limit and provides the closest check it can support.

The hook payload is intentionally small: compiled JavaScript, Node built-ins, and dufflebag's own payload helpers. The CLI can use dependencies; hook files should stay zero-dependency.

## Repo docs

- [AGENTS.md](AGENTS.md) — repo conventions, ownership, and validation commands for coding agents.
- [PROJECT.md](PROJECT.md) — product direction and repository purpose.
- [CONTEXT.md](CONTEXT.md) — domain context.
- [LANGUAGE.md](LANGUAGE.md) — naming and terminology.
- [templates/mdFiles/CODE-STYLE.md](templates/mdFiles/CODE-STYLE.md) — reusable code-style template installed into other repos.
- [docs/adr/current/](docs/adr/current/) — accepted architecture decisions.

## Official references

- [Claude Code overview](https://code.claude.com/docs/en/overview)
- [Claude Code memory](https://code.claude.com/docs/en/memory)
- [AGENTS.md convention](https://agents.md/)
- [OpenAI Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
- [Cursor rules](https://cursor.com/docs/rules)
- [GitHub README guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
- [GitHub Actions](https://docs.github.com/en/actions)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

## Development

```bash
pnpm install
pnpm generate-readme
pnpm test
pnpm typecheck
pnpm build
pnpm verify
```

`pnpm generate-readme` rewrites only the marked feature and skill sections above from `src/core/catalog/features.ts` and `src/skills/*/SKILL.md`. The pre-commit hook runs it automatically and stages the updated README.

## License

[MIT](./LICENSE) © Yosef Hayim Sabag
