# Restructure repo — examples

One made-up repo runs through every example: an Expo app in `mobile/`, a Cloudflare Worker API in `api/`, and shared types in `common/`. Its `LANGUAGE.md` uses the words **Customer**, **Order**, and **Menu item**.

## Contents

- Scout brief
- Step 1: Start
- Phase 1: Dead weight
- Phase 2: Structure
- Phase 3: Code
- Phase 4: Names
- Phase 5: Deps
- Phase 6: Best practices

## Scout brief

Code scout:

```text
You are a read-only scout for restructure-repo, phase 4 (Names).
Area: mobile/**. Do not edit, commit, or propose fixes.
Read every exported function, type, interface, and prop name, and the comment above each.
Return only this table, one row per finding, no prose. If nothing is found, return "none".
| file:line | kind | name | what it really does (evidence: quote, tool output, or count) |
```

Doc scout (one per framework; this one is for Expo, and the Worker and React get their own):

```text
You are a read-only scout for restructure-repo, step 3 (Official docs).
Fetch the pages for Expo SDK <installed version> on project structure and monorepos.
Return only this table. Quote the page; never paraphrase from memory.
| URL | section | quote (at most 2 sentences) | applies to |
```

## Step 1: Start

Card (illustrative; the real options come from the models this host offers in that session):

> **Which model should the scouts use?**
> 1. **Fastest, cheapest model (Recommended).** Fine for running tools and listing findings; the main agent checks every finding anyway.
> 2. **Mid model.** Reads code and doc pages more carefully and costs more.
> 3. **Same as the main agent.** Most careful and costs the most.

## Phase 1: Dead weight

Scout row:

| file:line | kind | what is there | evidence |
|---|---|---|---|
| `api/src/legacy/syncV1.ts:1` | file | unused file | knip "Unused files"; `git grep syncV1` finds nothing |

Card:

> **knip found 3 unused files and 4 unused deps. Delete them?**
> 1. **Delete all 7 (Recommended).** Nothing imports them; git keeps the history.
> 2. Delete the files; review the deps in phase 5.
> 3. Keep everything.

Table (first 2 of 7 rows; `PLAN.md` gets all 7):

| Remove | Kind | Evidence | Source |
|---|---|---|---|
| `api/src/legacy/syncV1.ts` | file | no importers | knip |
| `lodash` (`mobile`) | dep | no imports | knip |

Commit: `refactor(dead-weight): remove 3 unused files and 4 unused deps`

## Phase 2: Structure

Card:

> **Where should the app and the API live?**
> 1. **`apps/mobile` + `apps/api` + `packages/shared` (Recommended).** The Expo monorepo guide's layout; each app owns its config.
> 2. Keep `mobile/` and `api/` at the root; move only the shared types.

Before and after:

```text
before                 after
mobile/                apps/mobile/
api/                   apps/api/
api/wrangler.toml      apps/api/wrangler.toml
common/types.ts        packages/shared/src/order.ts
```

Move table:

| From | To | Why | Source |
|---|---|---|---|
| `common/types.ts` | `packages/shared/src/order.ts` | both apps import it; holds only Order types | <https://docs.expo.dev/guides/monorepos/> |
| `api/` | `apps/api/` | one folder per deployable app | <https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/> |

Risks: every import of `common/types`, the Metro config (check it against the Expo monorepo guide), and the Worker's root directory in the Cloudflare build settings.

Commit: `refactor(structure): split into apps/mobile, apps/api, and packages/shared`

## Phase 3: Code

Scout row:

| file:line | kind | what is there | evidence |
|---|---|---|---|
| `apps/mobile/src/api/orders.ts:8`, `apps/mobile/src/api/menu.ts:6` | repeated code | the same fetch, status check, and JSON parse | 14 identical lines in each |

Card:

> **Two files repeat the same 14 lines of fetch code. Merge them?**
> 1. **One `fetchJson()` used by both (Recommended).** Two real callers; removes 11 lines.
> 2. Keep both copies.

Before:

```ts
const response = await fetch(`${API_URL}/orders/${id}`);
if (!response.ok) throw new Error(`Request failed: ${response.status}`);
return response.json();
```

After:

```ts
return fetchJson<Order[]>(`/orders/${id}`);
```

Import order comes from the repo's formatter (`biome check --write` here), never from hand-sorting.

Commit: `refactor(code): share one fetchJson between orders and menu`

## Phase 4: Names

Scout row:

| file:line | kind | name | what it really does |
|---|---|---|---|
| `apps/mobile/src/lib/utils.ts:12` | function | `handleData` | returns `"$12.00"` from cents: `` `$${(cents / 100).toFixed(2)}` `` |

Card:

> **`utils.ts` holds 4 helpers that each do a different job. Split it?**
> 1. **One file per job: `formatPrice.ts`, `parseOrderDate.ts`, … (Recommended).** Each file name says what is inside.
> 2. Keep one file, renamed `formatting.ts`.

Table:

| Before | After | Why | Source |
|---|---|---|---|
| `utils.ts › handleData()` | `formatPrice.ts › formatPrice()` | says what it returns | `LANGUAGE.md`: "price" |
| `interface IUserData` | `interface Customer` | the domain word | `LANGUAGE.md`: "Customer" |

Names over comments. Before:

```ts
/** Gets the orders for a customer from the API */
export async function getData(id: string) {
```

After, with no comment:

```ts
export async function fetchCustomerOrders(customerId: string) {
```

Commit: `refactor(names): name files and functions after what they do`

## Phase 5: Deps

Scout row:

| file:line | kind | what is there | evidence |
|---|---|---|---|
| `apps/mobile/package.json:18` | dep | `axios` | 2 imports, both plain GET requests |

Card:

> **`axios` is used for 2 plain GET requests. Replace it with `fetch`?**
> 1. **Use `fetch` and remove `axios` (Recommended).** React Native ships `fetch`; one dep fewer.
> 2. Keep `axios`.

Table:

| Dep | Where | Action | Why | Source |
|---|---|---|---|---|
| `axios` | mobile | remove | `fetch` covers both calls | <https://reactnative.dev/docs/network> |
| `@types/node` | mobile `dependencies` | move to `devDependencies` | types only; not used at runtime | judgment |
| `expo-image` | mobile | keep | shows Menu item photos | — |

Commit: `refactor(deps): replace axios with fetch and move type packages to devDependencies`

## Phase 6: Best practices

Scout row (doc scout quote plus code scout row):

| file:line | what is there | doc quote | URL |
|---|---|---|---|
| `apps/api/src/env.ts:1` | hand-written `interface Env` | `wrangler types` generates "`Env` types based on your Worker bindings" | <https://developers.cloudflare.com/workers/languages/typescript/> |
| `apps/mobile/src/screens/OrderTotal.tsx:12` | `useEffect` sets `total` from `items` | "When something can be calculated from the existing props or state, don't put it in state. Instead, calculate it during rendering." | <https://react.dev/learn/you-might-not-need-an-effect> |

Card (multi-select):

> **Which fixes should we apply?**
> 1. **Generate `Env` with `wrangler types` (Recommended).** Types follow the real bindings; delete `env.ts`.
> 2. **Compute the Order total during render (Recommended).** One fewer effect and render.

Table:

| Finding | file:line | Fix | Effort | Source |
|---|---|---|---|---|
| hand-written `Env` | `apps/api/src/env.ts:1` | run `wrangler types`; import the generated `Env` | small | Workers TypeScript docs |
| total kept in an effect | `apps/mobile/src/screens/OrderTotal.tsx:12` | `const total = sum(items)` during render | small | React docs |

With an Express API, the same phase reads the Express [error handling](https://expressjs.com/en/guide/error-handling.html) and [security](https://expressjs.com/en/advanced/best-practice-security.html) pages instead.

Commit: `refactor(best-practices): generate Worker Env types and derive the Order total in render`
