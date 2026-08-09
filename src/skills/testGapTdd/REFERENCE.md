# test-gap-tdd — reference

## Artifact paths

| File | Path |
|------|------|
| Features | `docs/agent/test-gap/<run-id>/FEATURES.md` |
| Report | `docs/agent/test-gap/<run-id>/REPORT.md` |
| Active pointer | `docs/agent/test-gap/CURRENT` |

Mint `RUN_ID=$(date -u +%Y-%m-%dT%H%M%SZ)` for new runs; resume via `CURRENT`. Migrate root `TEST-GAP-*.md` / flat campaign files into a run dir. Never leave campaign MD at repo root. See [references/agent-artifacts.md](references/agent-artifacts.md).

## Headless policy

| User said | E2E mode |
|-----------|----------|
| nothing about UI | **headless** (default) |
| `headless` | headless (explicit, same as default) |
| `headed` / `visible` / `ui` / `headed e2e` | headed / UI mode per runner |

Do **not** ask “headless?” — default is headless. Only switch when they opt into headed.

Examples:

```bash
# Playwright — headless is default; only add --headed when user asked
pnpm exec playwright test
pnpm exec playwright test --headed   # only if user said headed

# Maestro — usually non-interactive CI; do not force GUI unless asked
```

## Sub-agent scan return template

```markdown
## feature_id: <id>
paths: <globs>

### existing
| layer | path | asserts |
|-------|------|---------|
| backend-unit | server/src/foo/bar.test.ts | creates X when Y |
| mocks | client/src/mocks/handlers.ts | GET /api/x 200 |
| e2e-web | client/e2e/web/foo.spec.ts | user completes flow |

### missing
| pri | layer | behavior | suggested path | code anchor |
|-----|-------|----------|----------------|-------------|
| P0 | backend-unit | reject invite when expired | server/src/…/invite.test.ts | useCase line |
| P1 | mocks | 403 on outreach send | msw handlers | api client |
| P2 | e2e-web | empty inbox state | e2e/web/inbox.spec.ts | InboxScreen |

### notes
- no native surface for this feature | N/A
```

## Orchestrator summary table

```markdown
| Feature | backend-unit | client-unit | mocks | integration | e2e-web | e2e-native | Top missing |
|---------|:------------:|:-----------:|:-----:|:-----------:|:-------:|:----------:|-------------|
| outreach | partial | none | partial | none | smoke | none | expired invite unit; MSW 403 |
```

Use: `none` | `partial` | `ok` | `n/a`

## TDD order

1. Contract / backend-unit  
2. Mocks (MSW etc.) so client-unit and e2e can be stable  
3. Client-unit  
4. Integration  
5. e2e-web / e2e-native / e2e-cli  

Red → green → small refactor. One logical gap per commit when using `organized-commits`.

## Discovery heuristics (not prescriptions)

| Look for | Infer layer |
|----------|-------------|
| `msw`, `setupServer`, `http.get`, `HttpResponse` | mocks |
| `playwright`, `cypress`, `e2e/web` | e2e-web |
| `maestro`, `detox`, `e2e/native` | e2e-native |
| colocated `*.test.ts` under server/domain | backend-unit |
| colocated under features/components | client-unit |
| `supertest`, `miniflare`, `testcontainers` | integration |

Always prefer **repo scripts** in package.json / AGENTS.md over guessing CLI flags.

## MYPR-App example mapping (illustrative)

Only if the target repo is MYPR; other repos differ.

| Layer | Example command / path |
|-------|------------------------|
| backend-unit | `npm run test --workspace=@mypr/server` |
| client-unit | `npm run test --workspace=@mypr/client` |
| contract | `npm run test --workspace=@mypr/shared` |
| e2e-web headless | `npm run test:e2e-web --workspace=@mypr/client` |
| e2e-web headed | only if user said headed: `test:e2e-web:headed` |
| e2e-native | `npm run test:e2e-native --workspace=@mypr/client` (skip if no sim) |

## Anti-triggers

| Ask | Use instead |
|-----|-------------|
| Ship one product feature to main | `ship-feature-e2e` |
| Test gaps → parallel lanes → merge main | `test-gap-ship` |
| Only prove one flow in browser | `preview-and-prove` |
| Multi-feature deslop/refactor | `messy-repo-orchestrator` |
| Only open worktrees | `sdlc-tasks-executions` |

## Anti-patterns

- Scanning **only** e2e and ignoring backend-unit / MSW  
- Inventing product edges not present in code  
- Headed browser by default  
- New test framework when the repo already has one  
- Claiming native green without running or honest skip  
- Merging to main without user asking  
