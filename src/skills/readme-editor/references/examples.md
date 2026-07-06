# Worked Examples

Filled README maps and sample outputs across project shapes. Use these as **calibration**, not templates.

---

## Example 1 — Tiny local todo demo

Single-developer playground, no agents, no deployment.

### Map

```text
Reader:              Developer evaluating or running the app locally.
First success:       Open localhost, add one todo, see it persist on reload.
Builder path:        Extend local CRUD state or swap persistence layer.
Agent path:          None — no agents working here.
Include:             Quick start, usage, storage behavior, scripts.
Exclude:             Auth, cloud sync, deployment, roadmap.
Official links:      Vite docs if README names Vite.
Link out:            None.
Unknown:             —
Recommended artifacts: README.md only.
```

### Sample README.md

````md
# Todo demo

A tiny local todo app built with [Vite](https://vite.dev/). Todos persist to localStorage. No backend.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173 and add a todo.

## Usage

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run test` — run unit tests

## Scope

Single-user, single-device. No accounts, no sync, no server. State lives in localStorage and is cleared with the browser.
````

---

## Example 2 — Active app repo with agents

A web app being actively developed by humans + coding agents.

### Map

```text
Reader:              New contributor or agent picking up work.
First success:       Boot the app locally and hit the /health endpoint.
Builder path:        Add a feature module under src/features/.
Agent path:          Read AGENTS.md, run validation commands before finishing.
Include:             What the app does, quick start, scripts, links to deeper docs.
Exclude:             Internal-only ops runbooks; link to wiki.
Official links:      TypeScript, Node.js, pnpm, AGENTS.md convention.
Link out:            AGENTS.md, docs/architecture.md, internal wiki for ops.
Unknown:             —
Recommended artifacts: README.md + AGENTS.md (+ CLAUDE.md as @import of AGENTS.md).
```

### Sample README.md excerpt

````md
# Acme Web

Customer-facing dashboard for Acme accounts. Built with [TypeScript](https://www.typescriptlang.org/) on [Node.js](https://nodejs.org/en).

## Quick start

```bash
pnpm install
pnpm dev
```

Then visit http://localhost:3000.

## Docs

- [AGENTS.md](AGENTS.md) — conventions and validation commands for coding agents
- [docs/architecture.md](docs/architecture.md) — module layout and data flow
- Internal: ops runbooks live in the Acme wiki

## Scope

Frontend only. The API contract is owned by `acme-api`.
````

### Sample AGENTS.md excerpt

````md
# AGENTS.md

## Repo layout

- `src/features/<feature>/` — feature modules; UI, hooks, and tests are co-located
- `src/lib/` — shared utilities
- `src/api/` — generated API client; do not hand-edit

## Validation

- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Test: `pnpm test`

Run all three before declaring a task done.

## Do not

- Hand-edit `src/api/` — it is regenerated from the OpenAPI spec.
- Add new state-management libraries; use the existing stores.
- Introduce backend calls directly from components; go through `src/api/`.
````

### Sample CLAUDE.md

````md
@AGENTS.md

## Claude-specific notes

Prefer the project's existing form primitives in `src/lib/forms/` over generating new field components.
````

---

## Example 3 — Open-source library

A published npm package with public docs.

### Map

```text
Reader:              Developer evaluating the library or integrating it.
First success:       Install the package and run a 5-line example that returns a result.
Builder path:        Contribute by extending the parser plugins.
Agent path:          Optional; light AGENTS.md if agents are used internally.
Include:             What it is, install, minimal example, link to API reference and docs site.
Exclude:             Full API reference; it lives on the docs site.
Official links:      npm, TypeScript, GitHub Actions if mentioned.
Link out:            Docs site, CHANGELOG.md, CONTRIBUTING.md.
Unknown:             Whether to publish an llms.txt; depends on docs site stability.
Recommended artifacts: README.md (+ AGENTS.md if agents edit the repo, + llms.txt if docs site is stable).
```

### Sample README.md excerpt

````md
# @acme/parser

A streaming parser for Acme log files. Returns typed records for [TypeScript](https://www.typescriptlang.org/) projects.

## Install

```bash
npm install @acme/parser
```

## Example

```ts
import { parse } from "@acme/parser";

for await (const record of parse(stream)) {
  console.log(record.timestamp, record.level);
}
```

## Docs

- Full API reference: https://acme.dev/parser
- [CHANGELOG.md](CHANGELOG.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
````

---

## Calibration notes

- A demo should not look like a product. A product should not look like a demo.
- Link external technologies to official docs, then stop. A README with too many links reads like a search page.
- If you find yourself writing a "Features" table for a 200-line repo, stop.
- If the README is more than about 150 lines, ask whether content belongs in `docs/` or `AGENTS.md`.
- The 5-minute quick start is the single most important section. Most other sections are optional.
