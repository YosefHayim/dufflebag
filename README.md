# dufflebag

<p align="center">
  <img src="https://raw.githubusercontent.com/YosefHayim/dufflebag/main/public/hero.png" alt="dufflebag - install owned agent skills, hooks, and templates into Claude Code projects" width="640" />
</p>

`dufflebag` is a one-command installer for Yosef's reusable [Claude Code](https://code.claude.com/docs/en/overview) skills, hooks, and repo templates. It is a [TypeScript](https://www.typescriptlang.org/) CLI for [Node.js](https://nodejs.org/en), built with [pnpm](https://pnpm.io/), [Biome](https://biomejs.dev/), and [Vitest](https://vitest.dev/).

It installs into global `~/.claude` or project-local `.claude/`, keeps Schema-validated managed configuration, edits agent settings surgically, and removes only the files its receipt owns. The shipped skills target Claude Code first, while the docs and some skills also account for [Cursor](https://cursor.com/docs), [OpenAI Codex](https://developers.openai.com/codex), [Kiro](https://kiro.dev/docs/steering/), [Gemini CLI](https://geminicli.com/docs/cli/gemini-md/), and [Roo Code](https://docs.roocode.com/features/custom-instructions/).

## Quick start

Install the safe default context guard globally:

```bash
npx ys-dufflebag install context-guard
```

Then restart Claude Code so hooks and skills load in the next session.

For a repo-local install that can be committed with the project:

```bash
npx ys-dufflebag install --scope project
```

## Usage

Print command help, or open the interactive TUI (same options as CLI args; shows an ordered plan and asks for approval before applying):

```bash
npx ys-dufflebag
npx ys-dufflebag menu
```

Install a specific skill or hook set:

```bash
npx ys-dufflebag install write-readme update-agent-docs
npx ys-dufflebag install duplicate-code-guard
npx ys-dufflebag install image-to-code
```

Keep an existing install and refresh the copied payload:

```bash
dufflebag update
```

Remove only dufflebag-owned hooks, payload files, and installed skills:

```bash
dufflebag uninstall
dufflebag uninstall --scope project
```

Inspect host support and installed state without changing files:

```bash
dufflebag doctor
```

Inspect or change the managed configuration one setting at a time:

```bash
dufflebag config show
dufflebag config set context-warn-percent 15
dufflebag config set context-block-percent 22
dufflebag config set idle-compact-after 1m
```

Every setting and `DUFFLEBAG_*` environment variable is listed under [Settings](#settings).

Scaffold the copyable workflow set or scan a workspace for duplicates:

```bash
dufflebag workflow scaffold .
dufflebag duplicates . --staged
```

### Free provider routing

Dufflebag exposes provider-neutral streaming adapters for OpenAI Chat, OpenAI
Responses, Anthropic Messages, and Google Generative AI from
`ys-dufflebag/provider-routing`. Compatible providers use declarations instead
of provider-specific code.

The CLI calls providers directly; it does not install, start, or proxy through
OmniRoute. Inspect the 43-pool snapshot, credential readiness, and policy-held
web/synthetic adapters before routing:

```bash
dufflebag free models
dufflebag free credentials
dufflebag free acknowledge
dufflebag free chat "Explain this repository" --model auto-free
dufflebag free chat "Explain this repository" --model groq/meta-llama/llama-4-scout-17b-16e-instruct
```

`free credentials` prints the exact environment variable accepted for each
API-key provider. Dufflebag reads those values for the process and never writes
them to disk. Cloudflare additionally needs `CLOUDFLARE_ACCOUNT_ID` so its
account-scoped endpoint can be formed. The existing OpenRouter browser-consent
command remains the keyless setup path for OpenRouter:

```bash
dufflebag openrouter connect
dufflebag free chat "Explain this repository" --model openrouter/openrouter/free
```

The independently attributed OmniRoute v3.8.50 snapshot documents 43
pool-deduplicated recurring/keyless pools and about 1.526B estimated recurring
tokens. Dufflebag activates only official API or officially keyless contracts;
browser-cookie replay and synthetic CLI identities are listed as unavailable.
The estimate is not a grant or guarantee: actual access depends on credentials,
current provider terms, model availability, and live quotas.

### Natural voice and dictation

Turn on complete-response narration and play a first example:

```bash
dufflebag voice on
dufflebag voice speak "Read this number one. Now read this number two."
```

Claude Code, Codex, and Grok use native end-of-turn hooks. Run Devin through its
official ATIF export wrapper so only completed responses are narrated:

```bash
dufflebag voice devin -- <devin arguments>
```

Markdown is translated into speech instead of read as punctuation: tables name
their columns and cells, links stay understandable, and code blocks are announced
and read in full. Nothing is truncated.

Inside Cmux, each response is bound to its originating workspace and surface. A
background response remains silent until that surface is focused and Cmux is the
frontmost app; older unread responses from the same surface coalesce into the
latest one. If Cmux does not answer, the response is spoken at once. Use
`dufflebag config set speech-mode immediate` to speak every reply at once, or
`dufflebag config set speech-mode off` to suppress narration without uninstalling voice.

Tap Shift to stop narration. Hold Shift on its own for 300 ms to dictate
locally into the active caret. Pressing any other key while Shift is down
cancels, so typing capital letters and Shift shortcuts never start dictation.
A small bottom-center pill moves through **Listening** and **Finishing**;
release Shift to finish the phrase. Dufflebag keeps a short
release tail so the final word is not clipped. Say punctuation and structure
directly, for example:

```text
hello comma my name is Joseph period
bullet fix authentication next bullet add tests
numbered list fix login next item deploy
use literal comma as the field name period
```

Add machine-specific corrections without an LLM:

```bash
dufflebag config set dictation-replacements "Joseph=Yosef;type script=TypeScript"
```

On macOS 26+, prompt refinement can use Apple's on-device Foundation Models
framework. Enable clipboard mode, copy a draft, then double-tap Shift. Dufflebag
preserves code, commands, paths, URLs, and quoted literals; copies only the
validated refined draft; and reads it with the same active-word highlight. Press
Command-V to paste and review it—the feature never submits for you.

```bash
dufflebag config set refine-mode clipboard
dufflebag voice refine "please make this request precise" --speak
```

Apple Intelligence must be enabled and its local model ready. If it is not,
the original clipboard remains untouched and the overlay reports why refinement
is unavailable. Disable the gesture with `dufflebag config set refine-mode off`.

```bash
dufflebag voice status
dufflebag voice speak "Release status: Devin is ready."
dufflebag voice off
```

Narration and dictation support macOS, Windows, and Linux. Narration requires only
[`uv`](https://docs.astral.sh/uv/); with `speech-mode off`, dictation runs without it.
`dufflebag voice on` uses the adjacent lockfile
to prepare a compatible Python, pinned packages, and both local speech models
before starting the worker. Later runs reuse uv and model caches; narration and
transcription stay on the machine.

There is intentionally no Docker image. Global Shift capture, the host
microphone, the focused caret, and the desktop listening pill must run in the
host session; a container would add a second dependency/model cache while still
requiring platform-specific host access. Grant microphone and input-control
permissions when your OS asks. Linux desktop and Wayland security policy can
restrict global key capture or caret typing. If Tkinter or a graphical desktop
is unavailable, dictation continues without the visual pill.

The installed voice hook code has one zero-dependency Stop hook, the
`dufflebag-voice` Rust worker, the Python text-to-speech script with its uv
lockfile, and the Python refine script. Apple prompt refinement is a macOS-only extension; speech
remains local and cross-platform.

Idle compact is off by default (`idle-compact-after off`). On macOS with Ghostty 1.3+, verified native
hooks for Claude Code, Codex, and Grok bind each session to its exact terminal.
Override one launched agent without changing persistent config, for example
`DUFFLEBAG_IDLE_COMPACT_AFTER=30s codex` or `DUFFLEBAG_IDLE_COMPACT_AFTER=off grok`.

## Upgrading

This release renames features, a command, settings, environment variables, and state
folders, and it keeps no old names. An existing install cannot update in place:

1. With the version you have now, run `dufflebag voice off` if voice is on, then
   uninstall. Run the project uninstall in each project that has its own install.
   Uninstall also removes the old `config.json`, which the new version cannot read.

   ```bash
   npx ys-dufflebag@0.14.0 uninstall
   npx ys-dufflebag@0.14.0 uninstall --scope project
   ```

2. Install the new version, then set your settings again with their new names from
   [Settings](#settings).

   ```bash
   npx ys-dufflebag install
   ```

3. Rename these environment variables wherever you set them. Old names are ignored
   without an error.

   | Old | New |
   | --- | --- |
   | `DUFFLEBAG_CLAUDE_CODE_AUTO_COMPACT`, `DUFFLEBAG_CODEX_AUTO_COMPACT`, `DUFFLEBAG_GROK_AUTO_COMPACT` | `DUFFLEBAG_IDLE_COMPACT_AFTER` |
   | `dufflebagDaemonDryrun` | `DUFFLEBAG_AUTORUN_DRY_RUN` |
   | `DUFFLEBAG_VOICE_HOME` | `DUFFLEBAG_VOICE_DIR` |
   | `DUFFLEBAG_WHISPER_MODEL` | `DUFFLEBAG_DICTATION_MODEL` |
   | `DUFFLEBAG_LIVE_PREVIEW` | `DUFFLEBAG_DICTATION_LIVE_PREVIEW` |
   | `DUFFLEBAG_REFINE_NO_PICKER=1` | `DUFFLEBAG_REFINE_PICKER=off` |
   | `DUFFLEBAG_PROVIDER_STATE_PATH` | `DUFFLEBAG_PROVIDER_HEALTH_FILE` |
   | `DUFFLEBAG_AGENT_COMMAND`, `DUFFLEBAG_COMPACT_COMMAND` | removed: the agent command comes from `DUFFLEBAG_AGENT_ID`, and compact is always `/compact` |

4. Delete the old state by hand. Nothing reads it any more, and the new state lives under
   `~/.claude/dufflebag/state/`.

   ```bash
   rm -rf ~/.claude/.ctx-loop-state ~/.claude/.ctx-guard-state
   rm -f ~/.claude/.ctx-guard-off ~/.dufflebag/provider-routing.json
   ```

   `~/.claude/.ctx-loop-state/` also held the idle compact `idle-*.json` files. The
   context-guard off switch is now `~/.claude/dufflebag/state/context-guard-off`.

5. Run `dufflebag free acknowledge` once more. Provider health moved to
   `~/.claude/dufflebag/state/provider-health.json` and starts empty.

Renamed features and commands:

| Old | New |
| --- | --- |
| `autonomous-loop` | `autorun` |
| `speak-response` | `voice` |
| `dedup-guard` | `duplicate-code-guard` |
| `dufflebag dedup`, `dedup check` | `dufflebag duplicates` |
| `install --features a,b` | `install a b` |
| `--project` / `--global` | `--scope project` / `--scope global` |
| `config --warn 0.15` | `config set context-warn-percent 15` |
| `scaffold-ci` | `workflow scaffold` |
| `voice example "text"` | `voice speak "text"` |
| `// dup-ignore` comment | `// allow-duplicate` comment |

Every copied skill also has a new plain name; [What it installs](#what-it-installs) lists them.

## What it installs

`context-guard` and `scratch-folder-guard` are the safe defaults: `scratch-folder-guard` keeps agents from writing into `/tmp`, `/private/tmp`, or the macOS temporary folder and clears each ended Claude Code session's scratch folder. `duplicate-code-guard` blocks duplicate TypeScript functions and type shapes at write time where the agent platform supports it. `autorun` is a macOS-specific convenience driven in-session by `/autorun`; `voice` is cross-platform. The remaining entries are pure skills with no hooks — no configuration needed, just ask your agent to do the thing (e.g. "convert this PNG to code"). Skills authored by others are bundled too, but credited separately under [Recommended community skills](#recommended-community-skills).

<!-- AUTO:FEATURES:START -->
| Feature | What it does | Runs on |
| --- | --- | --- |
| **context-guard** | Guard long sessions near their context cap and optionally compact idle Claude Code, Codex, or Grok sessions in their exact Ghostty terminal. | 🟢 any OS |
| **autorun** | Let the agent keep working alone. When the context is almost full and a fresh handoff note exists, it runs /compact and continues the task. macOS + Ghostty only (it types into your terminal). The hook code lives in context-guard. | 🔴 macOS + Ghostty |
| **voice** | Read complete agent responses with local speech, hold-Shift dictation via whisper.cpp large-v3-turbo (Metal), Cmux focus gating, and optional on-device prompt refinement on macOS. | 🟢 any OS |
| **duplicate-code-guard** | Block a Write/Edit that pastes a function body or interface/type shape already defined elsewhere in the repo — DRY enforced at the moment of the write. Uses the repo's own TypeScript; blocks by default (tune with `dufflebag config set duplicate-code-mode warn`). Agents without edit hooks can run `dufflebag duplicates` as a pre-commit or CI check. | 🟢 any OS |
| **scratch-folder-guard** | Block every agent write into system temporary folders (/tmp, /private/tmp, /var/tmp, /dev/shm, $TMPDIR) — files, edits, shell redirects, copies, and mktemp — so logs and scratch files stay in a gitignored repo folder. Also deletes each ended Claude Code session's own scratch folder. | 🟢 any OS |
| **session-rehome** | Move each ended Claude Code session and Codex thread into the repo it was about, so `/resume` and `codex resume` in that repo list it. Sessions started in ~/Desktop/Code, ~, /tmp, or a deleted worktree move when one repo clearly dominates their work; resuming a moved session from its old folder says where it went. | 🟢 any OS |
| **image-to-code** | Turn an image (PNG, screenshot, design) into code that looks the same — SVG, HTML/CSS, or animation — checked with pixel diffs. | 🟢 any OS |
| **github-repo-about** | Write the GitHub "About" box — a one-line description, a website link, and topics. | 🟢 any OS |
| **write-blog-post** | Write a new portfolio blog post in the owner's voice, add it to the blog data file, and make a matching cover image in ChatGPT. | 🟢 any OS |
| **write-readme** | Write or fix the README and other start-here docs. Reads the repo first, then asks you questions one by one. | 🟢 any OS |
| **update-agent-docs** | Create or update agent instruction files (AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, and more) based on each agent's official docs. | 🟢 any OS |
| **simplify-code** | Remove extra code — wrappers, layers, folders, generic names, and scripts the job does not need. | 🟢 any OS |
| **code-style-new-project** | For a new project — ask you questions about code style, folder structure, and CLI, then write CODE-STYLE.md, a formatter config, and the project docs. | 🟢 any OS |
| **code-style-teach-me** | While you build, stop at each real choice, show two options, and explain the rule so you learn your own architecture. | 🟢 any OS |
| **code-style-review** | Check a big change (branch or PR) against the style rules and get a short report, so you do not need to read every file. | 🟢 any OS |
| **code-style-existing-project** | For a project that already has code — read the real code, ask you questions, then write or update CODE-STYLE.md and the formatter config. Can also only check code against the rules. | 🟢 any OS |
| **explain-my-stack** | Understand why the project uses each technology (language, framework, services) and save the answers in TEACH.md. | 🟢 any OS |
| **plan-page** | Show a plan, approval step, or report as an interactive HTML page (open-source planpage package) where you can approve or change choices. | 🟢 any OS |
| **website-speed-ci** | Add website speed checks (Lighthouse CI, Core Web Vitals, CrUX) to CI so a slow change fails the PR. | 🟢 any OS |
| **chrome-store-seo** | Improve your Chrome Web Store text (name, summary, description) and landing page so more people find the extension. | 🟢 any OS |
| **make-promo-video** | Make a short promo video for a project — story, images, animation, voice, music, and a cut for each social app. | 🟡 macOS |
| **check-website-quality** | Scan a website for HTML structure, accessibility, images, speed, security headers, SEO, and AI-readiness, then fix what is wrong. | 🟢 any OS |
| **organize-commits** | Split your changes into small, clear commits with good messages, and clean up history and branches. | 🟢 any OS |
| **finish-and-push** | Finish the work — run checks, commit, push to a feature branch, and clean up leftovers. | 🟢 any OS |
| **run-local-and-check** | Run the app on your computer and prove it works in a real browser or app. No deploy. | 🟢 any OS |
| **reuse-before-build** | Before building a feature, find code, packages, or platform features you already have that can do the job. | 🟢 any OS |
| **find-repeated-prompts** | Read your past agent sessions and find prompts and work patterns you repeat, as ideas for new skills. | 🟢 any OS |
| **install-skills** | Install or update skills in all your coding agents and check that each agent can really find them. | 🟢 any OS |
| **fix-env-config** | Put env variables and config in one place with types and checks, and find duplicates, silent defaults, and secrets leaking to the client. | 🟢 any OS |
| **add-mcp-server** | Add an MCP server to your agents, log in with OAuth, and check that its tools really work. | 🟢 any OS |
| **check-rtl-ui** | Check and fix right-to-left screens (Hebrew, Arabic, Persian, Urdu) — layout, mixed-direction text, icons, forms, and accessibility. | 🟢 any OS |
| **deploy-and-check** | Deploy to production and prove it is really live with checks against the real URL. | 🟢 any OS |
| **fix-bug** | Reproduce the bug first, find the real cause, fix it, and prove the fix works. | 🟢 any OS |
| **run-tasks-in-parallel** | Give a numbered task list, and each task gets its own agent, branch, tests, and PR. | 🟢 any OS |
| **ship-one-feature** | Take one feature or one GitHub issue all the way — branch, code, tests, PR, merge, and reinstall. | 🟢 any OS |
| **find-missing-tests** | Find the tests each feature is missing (unit, mocks, integration, e2e), then write them test-first. | 🟢 any OS |
| **ship-missing-tests** | Find missing tests in many features, fill them in parallel branches, and merge to main after checks. | 🟢 any OS |
| **simplify-repo-with-tests** | Find over-engineering across the repo, simplify it, and use tests to prove the behavior did not change. | 🟢 any OS |
| **improve-ux** | Make user flows easier (fewer clicks, better layout, forms, mobile). Shows before/after designs first, then builds the one you pick. | 🟢 any OS |
| **free-ports** | Stop local servers that block ports (keeps Metro on 8081) so you can start dev again. | 🟢 any OS |
| **clone-all-repos** | Clone or update all your GitHub repos into your Code folder and report what changed. | 🟢 any OS |
| **manage-cloudflare** | Set up and fix Cloudflare — wrangler config, D1, KV, R2, Workers and Pages projects, and secrets. | 🟢 any OS |
| **clean-repo-by-feature** | Back up main, then clean a messy project with one agent and one branch per feature, and open one PR per feature for you to review. | 🟢 any OS |
| **improve-skill** | Change an existing skill based on feedback or on what went wrong in a real session. | 🟢 any OS |
| **which-skill** | Not sure which skill to use? It turns your request into a short plan with the right skills and a ready prompt. | 🟢 any OS |
| **benchmark-agents** | Run the same tasks with different agents, skills, or tools and compare tokens, time, cost, and success. | 🟢 any OS |
| **release-mobile-app** | Build and upload the app to App Store, TestFlight, or Google Play, and prove which commit, version, and build was sent. | 🟢 any OS |
| **save-as-skill** | Turn what we just did into something you can reuse — a skill, script, template, test, or runbook. | 🟢 any OS |
| **finish-old-sessions** | Find unfinished work in past agent sessions, compare it with the repos, and finish each task or mark it honestly. | 🟢 any OS |
<!-- AUTO:FEATURES:END -->

## Recommended community skills

<!-- AUTO:SKILLS:START -->
These skills ship with dufflebag for convenience — installable the same way (`npx ys-dufflebag install <id>`) — but they are **authored by others**, not by dufflebag. Full credit and upstream sources:

| Skill | What it does | By |
| --- | --- | --- |
| **make-code-readable** | Use when you want code that is easier to read — clearer names, order, files, and functions. It shows before and after, and changes code only after you approve. Say "make this readable", "rename for clarity", or "clean this up". To remove extra layers, use simplify-code. | [Mike Cann](https://github.com/mikecann/agent-skills) (upstream name: `deslop`) |
| **question-my-plan** | Use when you want the agent to ask you hard questions about your plan until you both understand it the same way. Say "grill me", "question my plan", or "stress-test this plan". | [Matt Pocock](https://github.com/mattpocock/skills) (upstream name: `grill-me`) |
| **question-plan-with-docs** | Use when you want your plan checked against the project docs and past decisions. It asks hard questions, makes the words clear, and updates the project docs as you decide. Say "grill me with docs" or "check my plan against the docs". | [Matt Pocock](https://github.com/mattpocock/skills) (upstream name: `grill-with-docs`) |

> `code-style-new-project` and `code-style-existing-project` are dufflebag-original skills that build on Matt Pocock's grilling pattern — they stay in the owned catalog above.
<!-- AUTO:SKILLS:END -->

## Settings

<!-- AUTO:SETTINGS:START -->
dufflebag keeps one `config.json` in its install root: `~/.claude/dufflebag/config.json` for a global install, `.claude/dufflebag/config.json` for a project install. Change a setting with `dufflebag config set <setting> <value>`, show it with `dufflebag config show`, and reset it with `dufflebag config reset`. A file with an unknown key does not load; fix it or run `dufflebag config reset`.

| Setting | config.json key | Default | What it does |
| --- | --- | --- | --- |
| `context-warn-percent` | `contextWarnPercent` | `18` | Context use, as a whole percent of the model window, that starts the handoff warning (18 means 18%). |
| `context-block-percent` | `contextBlockPercent` | `20` | Context use, as a whole percent of the model window, that blocks new code edits. |
| `autorun-default-cycles` | `autorunDefaultCycles` | `10` | Compact cycles /autorun allows when no count is given. |
| `autorun-max-cycles` | `autorunMaxCycles` | `50` | Hard limit on compact cycles for one autorun, whatever count is given. |
| `autorun-check-every-seconds` | `autorunCheckEverySeconds` | `5` | Seconds between the autorun watcher's checks. |
| `autorun-idle-after-seconds` | `autorunIdleAfterSeconds` | `8` | Seconds without transcript activity before autorun treats the turn as idle. |
| `idle-compact-after` | `idleCompactAfter` | `"off"` | How long an agent session sits idle before dufflebag submits a waiting draft or runs /compact: off, or a time like 30s, 2m, 1h. |
| `speech-voice` | `speechVoice` | `"F4"` | Supertonic voice ID (F1-F5 or M1-M5); unsupported names fall back to F4. |
| `speech-words-per-minute` | `speechWordsPerMinute` | `230` | Speech rate for read-aloud replies, in words per minute. |
| `speech-mode` | `speechMode` | `"auto"` | When agent replies are read aloud: auto holds a Cmux reply until its surface is focused and Cmux is in front, and speaks other replies at once; immediate speaks every reply at once; off reads nothing. |
| `refine-mode` | `refineMode` | `"off"` | Prompt refine: off; clipboard = double-tap Shift refines the copied prompt; dictation = refine the final dictation before it is typed; both. |
| `refine-provider` | `refineProvider` | `"codex"` | Refine provider: codex \| local \| auto \| grok \| ollama \| opencode \| claude \| gemini \| pi. `dufflebag config pick-refine` lists only providers found on PATH. |
| `refine-model` | `refineModel` | absent | Model id for the refine provider (e.g. gpt-5.3-codex-spark, grok-4.5, llama3.2). When absent the voice worker uses gpt-5.3-codex-spark. |
| `refine-effort` | `refineEffort` | absent | Reasoning effort for providers that support it (grok --reasoning-effort, codex model_reasoning_effort). When absent the voice worker uses low so dictation refine stays fast. |
| `refine-press-enter` | `refinePressEnter` | `false` | Press Enter after the refined text is typed at the caret. Independent of refineCmuxPressEnter. |
| `refine-send-to` | `refineSendTo` | `"caret"` | Where refined text goes: caret (paste into the focused input), cmux-new (a new focused cmux workspace), or cmux-resume (the focused cmux surface). |
| `refine-cmux-command` | `refineCmuxCommand` | `""` | Optional shell command run in the new cmux terminal for cmux-new. Placeholders: {{prompt_file}} (safe path), {{prompt}} (shell-escaped), {{cwd}}. Empty pastes the refined text only. |
| `refine-cmux-press-enter` | `refineCmuxPressEnter` | `false` | Press Enter after injecting refined text into cmux (cmux-resume, or cmux-new without a command). |
| `dictation-replacements` | `dictationReplacements` | `""` | Semicolon-separated speech replacements in heard=written form. |
| `dictation-keep-listening-seconds` | `dictationKeepListeningSeconds` | `0.2` | Seconds the microphone stays open after Shift is released so trailing words are not cut off. |
| `dictation-language` | `dictationLanguage` | `"en"` | Dictation speech language: en (default whisper.cpp) or he (ivrit.ai Hebrew whisper-large-v3-turbo ggml). |
| `duplicate-code-mode` | `duplicateCodeMode` | `"block"` | What the duplicate-code guard does with a copied function or type shape: block the edit, warn, or off. |
| `duplicate-code-skip-folders` | `duplicateCodeSkipFolders` | `[]` | Folder names the duplicate-code guard skips, on top of its built-in skips such as node_modules. |
| `session-rehome-roots` | `sessionRehomeRoots` | `["Desktop/Code","Code","Projects","dev","src","repos"]` | Folders (home-relative or absolute) whose git repos session-rehome may move Claude Code and Codex sessions into. Repos are found one and two levels deep. |
| `debug-logs` | `debugLogs` | `false` | Print dufflebag hook errors to stderr. |

Lists (`duplicate-code-skip-folders`) take comma-separated values on the command line. An empty value clears a setting whose default is absent.

### Environment variables

Provider API keys (`GROQ_API_KEY`, `GEMINI_API_KEY`, …) keep their vendor names and are listed by `dufflebag free models`.

| Variable | Default | What it does | Read by |
| --- | --- | --- | --- |
| `DUFFLEBAG_AGENT_ID` | set by dufflebag in hook commands | Which agent ran a hook (claude-code, codex, grok). Install writes DUFFLEBAG_AGENT_ID=<agent> in front of the hook commands that read it: idle compact, voice, and session rehome. | TypeScript |
| `DUFFLEBAG_IDLE_COMPACT_AFTER` | unset (idleCompactAfter in config.json applies) | Overrides idleCompactAfter for one agent session: off, or a time like 30s. Set it when starting the agent, e.g. `DUFFLEBAG_IDLE_COMPACT_AFTER=30s codex`. | TypeScript |
| `DUFFLEBAG_AUTORUN_DRY_RUN` | off | When 1, true, or yes, the autorun watcher logs the keystrokes it would type instead of typing them (safe manual testing). | TypeScript |
| `DUFFLEBAG_VOICE_DIR` | ~/Library/Application Support/dufflebag/voice on macOS | Folder for voice state: Whisper models, the narration inbox, worker status, and saved refine choices. The Stop hook, the voice worker, and the refiner all use it. | TypeScript, Rust, Python |
| `DUFFLEBAG_VOICE_CONFIG_FILE` | unset (the install's config.json, then ~/.claude/dufflebag/config.json) | Path to the config.json the voice Stop hook and voice worker read (for example speechMode). When set, it is the only file they read; tests use it to stay away from the real config. | TypeScript, Rust |
| `DUFFLEBAG_DICTATION_MODEL` | unset (dictationLanguage picks turbo-q5 or the ivrit.ai Hebrew model) | Forces the Whisper model the dictation worker loads: turbo-q5, turbo-q8, turbo, small, base, tiny, or ivrit. | Rust |
| `DUFFLEBAG_DICTATION_LIVE_PREVIEW` | on | Set to off (or 0, false, no) to stop the live caption preview while Shift is held. | Rust |
| `DUFFLEBAG_REFINE_PICKER` | on | Set to off (or 0, false, no) so a failed refine never opens the macOS model picker (CI, headless machines). | Python |
| `DUFFLEBAG_REHOME_STATE_DIR` | ~/.claude/dufflebag/state/session-rehome | Folder for session-rehome's ledger of moved, kept, and deleted sessions, its watcher lock, and its sweep stamp. Tests point it at a temporary folder. | TypeScript |
| `DUFFLEBAG_PROVIDER_HEALTH_FILE` | ~/.claude/dufflebag/state/provider-health.json | File where `dufflebag free` keeps provider health records and the accepted terms version. | TypeScript |
<!-- AUTO:SETTINGS:END -->

## Scope

This repository is the source of truth for dufflebag-owned skills and hooks. It is not a general agent marketplace, does not install arbitrary third-party skill folders, and does not own runtime behavior for every agent listed above. When a platform cannot enforce a hook before an edit, dufflebag documents the limit and provides the closest check it can support.

The hook code is intentionally small: compiled JavaScript, Node built-ins, and dufflebag's own shared hook library. The CLI can use dependencies; hook files should stay zero-dependency.

## Repo docs

- [AGENTS.md](AGENTS.md) — repo conventions, ownership, and validation commands for coding agents.
- [PROJECT.md](PROJECT.md) — product direction and repository purpose.
- [CONTEXT.md](CONTEXT.md) — domain context.
- [LANGUAGE.md](LANGUAGE.md) — naming and terminology.
- [src/templates/projectDocs/CODE-STYLE.md](src/templates/projectDocs/CODE-STYLE.md) — reusable code-style template installed into other repos.

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

`pnpm generate-readme` rewrites only the marked feature, skill, and settings sections above from `src/catalog/featureCatalog.ts`, `src/skills/*/SKILL.md`, `src/config/configSchema.ts`, and `src/config/environmentVariables.ts`. The pre-commit hook runs `pnpm verify`, whose `generate-readme:check` fails on a stale README; it never rewrites or stages files, so run `pnpm generate-readme` yourself.

## License

[MIT](./LICENSE) © Yosef Hayim Sabag
