# Research principles (defaults only)

Distilled from the caption corpus under
`yt-captions-mini-ai/scraped-yt/clean-code-research/` (Uncle Bob Clean Code
lessons 1–6 + Matt Pocock channel videos and Shorts, ~1 year window). Used when
grilling taste or filling gaps **before** a project has its own CODE-STYLE.

**Project CODE-STYLE.md always wins** when it conflicts with these defaults.

## Naming

- Names reveal intent. Prefer domain words over container words: not `result` /
  `response` / `data` / `body` / `payload` / `row` / `raw` / `json` / `item` /
  `tmp` — use what the value *is*.
- Avoid empty verbs that only map shapes: vague user-defined `toX`, `buildX`,
  `resolveX` with no domain operation.

## Structure

- Small modules with clear boundaries; deep modules beat shallow pass-throughs.
- Feature slices own their internals; cross-slice private imports are findings.
- Extra layers that only rename or re-export are ceremony → report, then
  `deslop-v2` after approval.

## Documentation (agent-era)

- Code is source of truth; docs are thin navigation, ADRs, glossary.
- Instruction files must stay consistent with the tree; nested instructions need
  explicit scope.
- Prefer mechanical rules agents can check (`code-style.rules.json`) over vague
  essays.

## Honest limits

- Scanners prove **explicit** rules (banned identifiers, missing files, paths).
- Scanners cannot prove “this name captures the business concept.” Those stay
  `confidence: judgment`.
