# 0005 — CI failure on main opens an issue with the captured error

- **Status:** Accepted (2026-07-01)
- **Scope:** `.github/workflows/ci.yml` (`report-failure` job)

## Context

When `main` goes red, whoever fixes it — increasingly an **agent** — otherwise
has to stream the GitHub Actions logs to find the actual error, which is slow and
burns a lot of tokens. Today's `report-failure` job files a `ci-failure` issue
but only lists **which legs** failed plus a run link; the real error text lives
in the logs.

## Decision

On a `main` failure, CI **captures the failing step's output** (Biome, `tsc`,
`vitest`) and **embeds it in the auto-filed (or updated) `ci-failure` issue
body**, so the exact error is readable straight from the issue — no log
streaming required. Per-commit dedupe (comment on the existing open issue rather
than spamming) is preserved. This runs for **push-to-main only**; PR failures are
already visible on the PR.

## Consequences

- **+** An agent (or human) fixes from the issue text directly — cheaper and
  faster, no Actions-log round-trip.
- **+** A broken `main` carries its own diagnosis.
- **−** Each step must tee its output to a file/artifact, and the reporting
  script must read and **truncate** it (cap the embedded log so the issue body
  stays within limits).

## Implementation notes

- Redirect each gate step's combined output to a per-step file (or upload as an
  artifact) so `report-failure` can read it after the matrix finishes.
- Truncate to the last N lines / K bytes and fence it in the issue body.
- Keep the existing label-ensure + dedupe logic.
