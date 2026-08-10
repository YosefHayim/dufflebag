# Lane brief: OpenRouter OAuth consent

Issue: https://github.com/YosefHayim/dufflebag/issues/63

Branch: `feat/63-openrouter-oauth`

## Acceptance

- Launch an OpenRouter OAuth PKCE browser consent flow with a localhost callback.
- Verify callback state and exchange its code for a user-controlled OpenRouter credential.
- Persist only the credential through a local secure boundary; never save prompts, replies, authorization headers, state, or verifier.
- Add an OpenRouter provider manifest and its OpenAI-compatible routing path.
- Add a credential-gated, secret-safe live smoke path.
- Add unit and local callback integration happy-path coverage.

## Constraints

- Read `AGENTS.md` and `CODE-STYLE.md`; the latter is authoritative.
- Work only in this lane. Do not commit on `main`.
- No browser-cookie or CLI-session replay.
- Orchestrator owns hosted CI, merge, and reinstall.
- Unit and integration happy paths must pass before PR; no merge with a red gate.
