# Lane Brief — Issue #68

## Scope

Ship provider-neutral streaming exchanges for the four declared wire families, refresh the attributed OmniRoute 43-pool snapshot, and add an OmniRoute local-gateway CLI that accepts an explicit model.

## Safety boundary

- Official APIs and officially keyless contracts only.
- No browser-cookie replay, reverse-engineered web sessions, or synthetic CLI identities.
- No prompt, reply, credential, or authorization-header persistence.
- Preserve deterministic explicit selection and pre-output-only automatic fallback.

## Verification

- Colocated public-behavior tests for every wire family and failure class.
- Catalog identity and pinned-total tests.
- Credential-gated live checks where credentials or a local OmniRoute service exist.
- `pnpm verify`
- `npm pack --dry-run`
