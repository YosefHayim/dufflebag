# Sub-agent code scan

Goal: surface the **most-repeated** patterns in an existing codebase as evidence for the style grill. You want dominant reality, not a file dump — so use read-only explore agents that report conclusions, not contents.

## Fan-out

Spawn a small set of read-only sub-agents in parallel (prefer the `Explore` agent type), each on a different angle. Scale to repo size — 2-3 for a small repo, 5-6 for a large one:

- **Structure** — folder/module layout; where features live; feature- vs layer-based.
- **Boundaries & contracts** — what's shared vs local; where types/contracts live; import direction.
- **Data vs side effects** — pure core vs I/O; where side effects happen.
- **Errors & validation** — throw vs return; error types; boundary validation.
- **Naming** — conventions for files, functions, variables; what names encode.
- **Tests** — presence, location, style, what's actually covered.

## Each agent reports

- The 3-5 most-repeated patterns it saw, each with 1-2 concrete `file:symbol` examples.
- The dominant convention AND notable deviations (deviations are grill fodder — they're where taste is undecided).
- No recommendations — just what the code actually does.

## Bring back

Merge into one compact "current reality" brief: for each dimension, the dominant pattern + a real *before* candidate. Feed that into the grill — "the code does X here; keep it, or is this the slop to kill?" Do not treat the dominant pattern as correct by default; it's just the starting evidence.
