# Sub-agent code scan

Goal: surface the **most-repeated** patterns in an existing codebase as evidence for the style grill. You want dominant reality, not a file dump — so use read-only explore agents that report conclusions, not contents.

## Fan-out

Spawn a small set of read-only sub-agents in parallel (prefer the `Explore` agent type), each on a different angle. Scale to repo size — 2-3 for a small repo, 5-6 for a large one:

- **Structure** — folder/module layout; where features live; feature- vs layer-based. Also capture the **directory tree** (gitignore-aware, depth-capped) and the **import edges** among top-level modules, so the plan's §④ can render a before/after structure map.
- **Boundaries & contracts** — what's shared vs local; where types/contracts live; import direction.
- **Data vs side effects** — pure core vs I/O; where side effects happen.
- **Errors & validation** — throw vs return; error types; boundary validation.
- **Naming** — conventions for files, functions, variables; what names encode.
- **Tests** — presence, location, style, what's actually covered.
- **AI-slop fingerprint** — hunt the recognizable AI tells, since slop is high-frequency and easily mistaken for a convention: giveaway micro-helpers (`isRecord`, `isObject`, `isNonEmptyString`, `isDefined`, `ensureArray`, `noop`, `assertNever`), defensive over-guards (redundant null/type checks the types already prove), nested or duplicated ternaries, one-use wrapper functions, copy-pasted boilerplate (identical `try/catch` or `if (!x) return null` shapes), and generic names (`handleData`, `processItem`, `result`, `temp`, `manager`). Report each tell with a **count** + 1-2 `file:symbol` offenders — the count is what separates a real convention from repeated slop.

## Each agent reports

- The 3-5 most-repeated patterns it saw, each with 1-2 concrete `file:symbol` examples.
- A short **verbatim snippet** (≈5–12 lines) of the dominant pattern for each dimension, copied exactly with its `file:symbol`. This is the raw material for the **pick-the-code gallery**: variant **A** is this real incumbent, shown in the TUI for the user to react to — so keep it copy-paste faithful, not paraphrased.
- A **count / prevalence** for each repeated pattern (e.g. "arrow fns: 47/52 files"), not just presence — the grill weighs keep-vs-kill on frequency, and it's what tells a real convention apart from repeated slop.
- The dominant convention AND notable deviations (deviations are grill fodder — they're where taste is undecided).
- No recommendations — just what the code actually does.

## Bring back

Merge into one compact "current reality" brief: for each dimension, the dominant pattern + a real *before* candidate. Feed that into the grill — "the code does X here; keep it, or is this the slop to kill?" Do not treat the dominant pattern as correct by default; it's just the starting evidence. Include the **directory tree + import edges** (for §④), the **AI-slop fingerprint tally** (each tell + count + a real offender, to drive the `Never`-list grill), and each dimension's **verbatim incumbent snippet** (variant A of its pick-the-code choice — see [STYLE-CATALOG.md](STYLE-CATALOG.md)).
