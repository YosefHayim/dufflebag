---
name: preview-and-prove
description: Use when the user asks to launch, preview, QA, or verify an app or browser-visible flow in the real UI, especially checkout, authentication, onboarding, forms, extensions, or responsive behavior.
---

# Preview and Prove

Validate the product through the surface the user actually sees. Source inspection and automated tests support the claim; they do not replace a real browser-visible run.

## Safety

- Read the repository's run, test-data, and environment instructions before starting services.
- Use local, sandbox, preview, or explicitly authorized test accounts and payment methods. Never create a production charge, send a real campaign, or mutate customer data to prove a flow.
- Do not expose credentials, cookies, tokens, personal data, or private screenshots in logs or the final report.
- Ask only when a required credential, irreversible action, or product choice cannot be discovered safely. If a surface is unavailable, report it as unverified.

## Workflow

1. Define the exact route, actor, viewport, preconditions, success state, and side effects to verify. For checkout, authentication, onboarding, and other stateful funnels, include at least one safe failure-and-recovery path.
2. Inspect repository instructions and start the real application plus required local dependencies. Record the URL, build identity, seed/test account, and relevant feature flags without revealing secrets.
3. Open the app in a real browser. Reproduce the flow through visible controls rather than bypassing it with direct API calls.
4. Observe the page, accessibility tree, console, failed requests, redirects, cookies/storage, and network responses relevant to the flow.
5. Verify the durable outcome behind the confirmation UI: persisted record, sandbox provider state, session transition, delivered local event, or other authoritative readback.
6. Test representative desktop and mobile viewports when layout matters. Capture before/after screenshots for fixes and freeze animation or nondeterministic data when comparison matters.
7. Fix only after reproducing the problem. Re-run the complete flow from a clean state, then run the repository's relevant automated checks.

For extensions, verify the unpacked extension in a headed browser and its actual host permissions/content-script behavior. For OAuth or payments, include redirect and callback/webhook state, not only the final page.

## Verification

Report:

- exact route, actor, viewport, environment, and build or commit identity;
- steps performed and the observed visible result;
- console/network errors, including “none observed” only when inspected;
- authoritative persisted or provider-side readback;
- screenshot or artifact paths when safe to retain;
- automated checks and any surface that remained inaccessible.

Do not say “works in the UI” if only source, unit tests, an API, or a mocked component was exercised.
