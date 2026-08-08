# {Project} code style

This guide is prescriptive for {project}-owned code. Replace every placeholder with
project-specific decisions. Delete rules that do not apply; never leave generic advice.

Precedence: product boundaries in PROJECT.md, system orientation in CONTEXT.md, product
vocabulary in LANGUAGE.md, then this guide.

## How to read a rule

| Slot | Meaning |
| --- | --- |
| rule ID | Stable review and detector key |
| verify | Cheapest command that proves the rule, or judgment |
| chosen / rejected | The local idiom and the concrete failure shape |

## Rules

### Domain-specific names
[rule:names.domain-specific] · verify: judgment

Project-owned bindings and filenames use the narrowest product or technical name and never use banned generic names.

```ts
// ✓ src/example/domainName.ts
const invitationState = await requestConsentInvitation(invitationRequest);

// ✗ generic binding hides the domain
const result = await requestOutreach(payload);
```

Why: Names should reveal the product decision without requiring the reader to trace a type.

### Arrow constants for named functions
[rule:functions.arrow-constants] · verify: judgment

Named non-framework functions are arrow constants declared before first use.

```ts
// ✓ src/example/decideThing.ts
export const decideThing = (status: Status): Decision => {
  return { state: 'queue' };
};

// ✗ named function declaration
export function decideThing(status: Status): Decision {
  return { state: 'queue' };
}
```

Why: A single function form makes declaration order and module reading order predictable.

### One job per function
[rule:functions.single-job] · verify: judgment

Each function performs one cohesive job and leaves unrelated effects to its caller.

```ts
// ✓ src/example/decideThing.ts
const decision = decideThing(context);
await store.queueThing({ decision });

// ✗ one opaque pipeline owns unrelated work
await validateSaveSendAndFormat(request);
```

Why: Cohesive jobs can change independently without introducing ceremony.

## Canonical example

Describe one real feature slice that composes every load-bearing rule. Point at real paths
once the project has code.

## Golden path — adding a {unit}

1. Name the unit in LANGUAGE.md / CONTEXT.md when vocabulary changes.
2. Add the pure decision or contract at the real path for this project.
3. Wire the unit at its real registration seam (route, catalog, CLI, DI).
4. Colocate public-behavior tests; run the project's real test command.
5. Update docs only when vocabulary, system shape, or a hard-to-reverse decision changed.

Definition of done:

- Focused tests pass.
- Style, typecheck, and affected builds pass.
- No `## Never` tell was introduced.
- The change follows the canonical example.

## Exemplars

- {path} — {why this file is the model}.

## Never

- Generic bindings such as data, payload, result, response, outcome [rule:names.domain-specific].
- Multi-job pipelines and pass-through wrappers [rule:functions.single-job].

## Stack and framework practices

- {Framework surface} → `{skill-name}`

This file covers only what is specific to THIS project on top of those.

## Verification

- {formatter/lint command}
- {style guide check command, e.g. pnpm style:guide}
- {typecheck and focused tests}
