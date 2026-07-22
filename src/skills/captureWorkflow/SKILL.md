---
name: capture-workflow
description: Use when the user says to reuse what we just did, make a completed workflow repeatable, save the process for next time, automate the successful steps, or turn recent work into a skill, script, template, test, or runbook.
---

# Capture Workflow

Convert a proven task into the smallest repo-owned reusable asset that can reproduce its outcome. Capture evidence and decisions, not the accidental state of the current shell or conversation.

## Safety

- Reconstruct the workflow from current repository evidence, commands, outputs, and user decisions. Do not treat every exploratory step or failed attempt as part of the reusable path.
- Never hardcode secrets, tokens, accounts, absolute machine paths, transient ports, cached sessions, customer data, or current uncommitted state.
- Preserve explicit gates for deployments, purchases, messages, deletion, production writes, OAuth consent, and other consequential side effects.
- Do not generalize beyond observed variability. One stable parameter is better than a framework of speculative options.
- Follow repository ownership: maintained automation belongs in the documented tooling location; one-off personal helpers remain local or gitignored.

## Workflow

1. State the proven outcome and collect the exact successful evidence: inputs, commands/actions, outputs, decisions, prerequisites, credentials source, side effects, cleanup, and failure recovery.
2. Separate the stable sequence from variable values and incidental exploration. Record why each retained step exists.
3. Search for an existing script, task, template, test, runbook, or skill to extend before creating another entry point.
4. Choose the smallest durable form:
   - a command or script for deterministic operations;
   - a template for repeated file shape;
   - an automated test for repeatable product behavior;
   - a runbook for human-controlled operational steps;
   - an agent skill for judgment-heavy workflows with recognizable triggers.
5. Define one documented invocation, inputs, outputs, prerequisites, credential mechanism, side effects, idempotency/retry behavior, validation, cleanup, and recovery.
6. Implement only the proven happy path plus concrete observed failures. Produce actionable errors for missing or invalid inputs.
7. Run from a fresh shell, clean checkout, isolated temp directory, new browser profile, or equivalent clean state. Do not rely on services or auth left over from the original run.
8. Compare the reproduced observable result with the original. Add a negative-path check, then simplify anything the replay did not need.

## Verification

Report:

- reusable asset path and why that form is the smallest fit;
- exact invocation, prerequisites, inputs, outputs, and side effects;
- which values are parameters and where credentials come from;
- clean-state replay evidence matching the original result;
- negative-path behavior and recovery/cleanup evidence;
- relevant automated checks and remaining manual gates.

Creating documentation or code is not proof of reusability. The asset must succeed outside the state that made the original run work.
