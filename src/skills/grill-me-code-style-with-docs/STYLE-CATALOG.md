# Style Catalog — the pick-the-code gallery

The comprehensive checklist of code-style dimensions the grill covers, grouped into rounds. Run it as a **pick-the-code** gallery: for each dimension, show real code variants in the TUI (`AskUserQuestion`, one option per variant, code in the `preview`) and let me **pick**. This is the surface where "what the agent writes" surprises you — cover it, so we don't discover the surprise at PR review.

The list below is a **floor, not a ceiling** — for the average SaaS/app codebase it's roughly complete; add any dimension a specific repo needs that isn't here.

## How to run it

- **Grouped rounds, checkpoints between.** Walk the areas in order. Within a round, ask each dimension as its own TUI question. After each round, checkpoint: **keep going · go deeper here · skip the rest**. Scale to the stack — skip a whole round when it doesn't apply (no UI → skip Frontend; no HTTP surface → trim API/IO).
- **Variants are the repo's REAL code.** Variant **A** is the actual incumbent, pulled **verbatim** from the scan with a `file:symbol` cite — warts and all, so you're reacting to *your* code, not a textbook. Variant **B** is the de-slopped rewrite. Two variants by default; add a third only when there's a genuine spectrum (e.g. throw / Result / neverthrow).
- **Uncontested → keep/kill, not a fake choice.** If the repo already settles a dimension one way and it isn't slop, show the single incumbent and ask **keep or kill** — never fabricate an alternative just to fill the slot. (An uncontested dimension is still shown — that's how you stay un-surprised.)
- **Every pick is recorded.** Chosen variant → the `✓` example on a `CODE-STYLE.md` rule; rejected variant → the `✗ not this` line. A rejected variant that's *actual slop* also becomes a concrete `## Never` entry with its real `file:symbol` offender. Tag each rule `[lint: <rule>]` (a linter catches it) or `[taste]`.
- **Compose at the end.** After the rounds, assemble every pick into one **canonical example** — a real feature slice from this repo rewritten in the agreed style — and land it as the `## Canonical example` block in `CODE-STYLE.md` (see [CODE-STYLE-FORMAT.md](CODE-STYLE-FORMAT.md)). It's the litmus you show in the plan before approval.

## Round 1 — Language idioms
- **Function form** — arrow vs declaration; when each is used.
- **Async style** — `async/await` vs `.then`; where `await` lands; parallel (`Promise.all`) vs sequential.
- **Returns & guards** — early-return / guard clauses vs single-return.
- **Null & optionality** — `null` vs `undefined`; `?.` / `??` vs explicit guards.
- **Immutability** — `const` / `readonly`; spread vs mutate; freeze policy.
- **Control flow** — nesting-depth cap; ternary policy (nested / duplicated ternaries banned); `switch` vs lookup map.
- **Collection ops** — `map`/`filter`/`reduce` vs `for` loops; when a loop wins.

## Round 2 — Data, types & errors
- **Error shape** — throw vs `Result`/`Either`; error types; where boundaries catch.
- **Types vs interfaces** — `type` vs `interface`; inference vs explicit annotation.
- **Contracts & schemas** — where shared contracts live; parse-don't-validate at boundaries (zod/valibot).
- **Data modeling** — discriminated unions vs boolean flags; branded / opaque ids.
- **Serialization / DTOs** — domain model vs wire shape; where the mapping lives.

## Round 3 — Modules & boundaries
- **Exports** — named vs default; barrel files (`index.ts`) yes/no.
- **Imports** — order / grouping; type-only imports; path aliases vs relative.
- **File / module size** — one-export-per-file? size cap; when to split.
- **Module boundaries** — what's shared vs local; allowed dependency direction.
- **Config & env** — where config lives; validated env access vs raw `process.env`.

## Round 4 — API / IO (backend surface; skip if none)
- **Handler shape** — route/controller structure; thin handler + service vs fat handler.
- **Input validation** — where and how requests are validated.
- **Data access** — repository / query layer vs inline queries; ORM idioms.
- **Side-effect isolation** — pure core vs I/O edges; where effects live.
- **Auth & context** — how identity / tenant threads through a request.
- **Async jobs** — queue / worker idioms; retry & idempotency shape.
- **Logging & observability** — structured logging; what gets logged where.

## Round 5 — Frontend / UI (skip if no UI)
- **Component form** — function components; props shape; default vs named export.
- **Hook & component order** — file layout; where hooks / handlers / JSX sit.
- **State management** — local vs global; server-state (react-query / swr) idioms.
- **Data fetching** — where fetches live; loading / error patterns.
- **Forms & validation** — controlled vs uncontrolled; schema-driven forms.
- **Styling** — the styling system; class / variant conventions.
- **i18n & a11y** — string externalization; the a11y baseline.

## Round 6 — Tests & tooling
- **Test shape** — arrange/act/assert; naming; one-assert vs many.
- **Test location** — colocated vs `__tests__`; unit vs integration split.
- **Fixtures & mocks** — factory vs inline; mock policy.
- **Comments & docs** — density; JSDoc vs inline; when a comment earns its place.
- **Formatting** — quotes / semis / width / trailing-commas / import-order → a **formatter config**, not prose.
- **Lint tells** — the machine-catchable slop wired as lint rules: `no-nested-ternary`, complexity / length caps, `no-restricted-syntax` for banned identifiers (`isRecord`-style helpers) and shapes.
