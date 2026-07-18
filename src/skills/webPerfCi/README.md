# web-perf-ci

Wire automated **Core Web Vitals budgets** into a website's CI/CD: a Lighthouse CI lab gate on every PR, a Chrome UX Report (CrUX) field check against real users after deploy, and an optional `web-vitals` RUM snippet. The skill grills the repo to detect the stack and run mode, then writes the config, the GitHub Actions workflows, and zero-dep field/lab checkers.

New to the metrics? Start with [`TECH-GLOSSARY.md`](TECH-GLOSSARY.md), then [`CONTEXT.md`](CONTEXT.md).

## What ships

| Path | Kind | Purpose |
| --- | --- | --- |
| `SKILL.md` | skill | The interview + setup workflow the agent follows |
| `CONTEXT.md` | doc | The lab/field/RUM model and run modes |
| `TECH-GLOSSARY.md` | doc | Every acronym, defined |
| `reference/lighthouse-ci.md` | doc | lighthouserc config, presets, budgets, `autorun` |
| `reference/pagespeed-insights.md` | doc | PSI v5 endpoint — the lab source (PSI field data is deprecating) |
| `reference/crux-api.md` | doc | CrUX API endpoint, request/response — the durable field source |
| `reference/web-vitals-rum.md` | doc | RUM snippet, attribution, analytics sink |
| `scripts/runCrux.mjs` | tool | Zero-dep CrUX API field checker → p75 real-user vitals, exit 1 on a poor vital |
| `scripts/runPagespeed.mjs` | tool | Zero-dep PSI v5 checker → lab score (+ legacy field), exit 1 on breach |
| `templates/lighthouserc.json` | template | Base Lighthouse CI config with CWV budgets |
| `templates/lighthouse-ci.yml` | template | GitHub Actions lab gate (PR) |
| `templates/field-check.yml` | template | GitHub Actions CrUX field check (post-deploy / cron) |
| `templates/budgets.json` | template | Core Web Vitals thresholds (SSOT) |
| `templates/web-vitals.js` | template | RUM reporting snippet (attribution build) |

## First-time setup

The lab gate needs nothing but Node in CI (`npx @lhci/cli autorun` pulls Lighthouse + Chrome). The **field check** needs a free Google API key:

1. In Google Cloud → **APIs & Services**, enable **both** the **Chrome UX Report API** (field data → `runCrux.mjs`) and the **PageSpeed Insights API** (lab → `runPagespeed.mjs`), then create an API key.
2. Store it as a repo secret named `PSI_API_KEY` (Actions) and export it locally as `PSI_API_KEY` (or `CRUX_API_KEY`) for manual runs.

Both APIs are **free** — no billing or credit card (PSI ~25k queries/day, CrUX 150/minute). Without a key they are heavily rate-limited — fine for a one-off, not for CI.

## Run the checkers locally

Both are dependency-free (Node 18+ global `fetch`).

**Field — CrUX API** (`runCrux.mjs`):

```bash
# real-user Core Web Vitals (p75); exits 1 on a "poor" vital, passes if no CrUX record
node scripts/runCrux.mjs https://example.com --form-factor=PHONE --key=$PSI_API_KEY

# force whole-origin data, or emit JSON
node scripts/runCrux.mjs https://example.com --origin --json --key=$PSI_API_KEY
```

Flags: `--form-factor=PHONE|DESKTOP|TABLET` (default `PHONE`) · `--origin` · `--key=` (or `CRUX_API_KEY`/`PSI_API_KEY`) · `--budgets=<file>` · `--json` · `--strict` · `--help`.

**Lab — PSI** (`runPagespeed.mjs`):

```bash
# lab score (+ legacy PSI field data while it lasts), mobile strategy
node scripts/runPagespeed.mjs https://example.com --strategy=mobile --key=$PSI_API_KEY
```

Flags: `--strategy=mobile|desktop` (default `mobile`) · `--key=` (or `PSI_API_KEY`) · `--budgets=<file>` · `--json` · `--strict` · `--help`.

## Run the lab gate locally

```bash
npm run build            # produce the static output the config points at
npx --yes @lhci/cli autorun
```

`autorun` reads `lighthouserc.json`, runs Lighthouse `numberOfRuns` times, asserts the budgets, and uploads a report link. Remember: in `autorun`, child-command flags must use `=` (e.g. `--collect.numberOfRuns=5`).

## Canonical example

A static Astro site on Cloudflare Pages:

1. Interview → run mode = `staticDistDir: "./dist"`, gate homepage + `/blog/[slug]`, start assertions as `warn`, key available.
2. Write `lighthouserc.json` (collect → `staticDistDir`), `.github/workflows/lighthouse-ci.yml`, copy `runCrux.mjs` → `.github/perf/`, add `.github/workflows/field-check.yml`.
3. Open a PR → the lab gate posts a report link; TBT/LCP/CLS asserted.
4. After the Pages deploy → `field-check.yml` runs `runCrux.mjs` against the deployed URL and reports the real-user (CrUX) verdict.
5. After a week of `warn` baselines, flip the Core Web Vitals assertions to `error`.

## Notes

- **INP** never comes from the lab — the lab gate asserts **TBT** as its proxy; the real INP is field-only (CrUX API + RUM).
- Deprecated tech (`mod_pagespeed`, Google Hosted Libraries) is intentionally **not** wired — see `SKILL.md` → *Honest scope*.
- Pin `@lhci/cli` to a known major in CI for reproducibility; bump deliberately.
