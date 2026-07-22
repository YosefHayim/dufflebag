---
name: agent-session-auditor
description: Use when the user asks to scan local Claude Code, Codex, Kiro, Kimi, Cursor, Grok, OpenCode, or other agent sessions for repeated prompts, fuzzy-similar requests, workflow patterns, or skill opportunities.
---

# Agent Session Auditor

Turn repeated user requests into evidence-backed skill candidates. The audit is read-only, local-first, privacy-preserving, and honest about coverage.

## Safety

- Get scope from the request: machine, user account, time range, agent families, and whether archived sessions count. Do not broaden to other users, cloud accounts, or network stores.
- Never modify, migrate, compact, or delete a session store. Open databases read-only and copy a database to temporary storage before queries when its client may create journal files.
- Extract user-authored prompts only. Exclude system/developer messages, assistant replies, tool calls/results, injected repo instructions, retries, and generated continuation noise.
- Redact secrets, tokens, credentials, personal/customer data, private URLs, and sensitive absolute paths before examples or intermediate artifacts leave their source.
- Keep clustering local by default. Obtain explicit approval before sending transcript-derived text to a hosted embedding or model service.

## Workflow

1. Discover stores from installed commands, documented paths, app data, config, and recent modification evidence. Do not guess unsupported directories.
2. Create a coverage manifest per agent: detected version, store paths, format, sessions found, sessions parsed, prompts extracted, skipped records, errors, and unsupported surfaces.
3. Sample each format before bulk parsing. Identify role fields, content blocks, timestamps, session IDs, workspace, and duplication caused by retries or branching.
4. Normalize conservatively: trim transport noise, replace volatile IDs/paths/numbers with typed placeholders, collapse whitespace, and remove acknowledgements such as “yes”, “continue”, or “proceed” unless they carry reusable intent.
5. Deduplicate exact normalized prompts, then fuzzy-cluster by both lexical and semantic evidence. Calibrate thresholds against a sample of same-intent and different-intent pairs; short prompts need stricter treatment.
6. Name each cluster by reusable job, not wording. Record frequency, unique sessions, agents, repositories, time span, sanitized examples, confidence, and failure modes in existing answers.
7. Rank skill candidates by repetition, cross-repo or cross-agent breadth, cost of repeated explanation, risk reduction, and how clearly a deterministic workflow can be encoded. Penalize one-off project facts and vague continuations.
8. Compare candidates to installed and authored skills. Recommend create, improve, merge, or leave as ordinary prompting.

## Verification

Publish a sanitized report with:

- detected, scanned, skipped, errored, and unsupported coverage by agent;
- extraction and normalization rules;
- clustering method, thresholds, calibration sample, and confidence;
- top clusters with counts from unique sessions, source-agent breadth, date range, and redacted examples;
- existing-skill overlap and a prioritized create/improve recommendation;
- limitations that prevent “all sessions” or completeness claims.

Never include raw transcript dumps. A result is not a skill opportunity merely because its words repeat; it must represent a reusable job with a stable trigger and workflow.
