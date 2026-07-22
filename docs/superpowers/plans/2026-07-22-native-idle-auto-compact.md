# Native Idle Auto-Compact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install native lifecycle hooks for detected Claude Code, Codex, and Grok CLIs so an explicitly configured idle session submits a waiting draft, otherwise compacts its own Ghostty terminal and parks.

**Architecture:** Extend the context-guard hook island with a normalized lifecycle-event adapter, a pure idle state machine, and a Ghostty 1.3 terminal controller. The catalog declares native-hook capability per agent; installation applies provider-owned hook JSON transactionally and doctor reports detected support without wrapping executables.

**Tech Stack:** TypeScript, Effect Schema, Effect CLI, dependency-free Node hook runtime, Ghostty 1.3 AppleScript, Vitest, JSON lexical editing, pnpm, npm trusted publishing.

## Global Constraints

- Native hooks only; never replace, alias, or wrap an agent executable.
- Fresh installs default idle auto-compact to `off`.
- Accept only `off` or a positive integer followed by `s`, `m`, `h`, or `d`; bound enabled durations to 10 seconds through 24 hours.
- Provider environment overrides are named `DUFFLEBAG_<NORMALIZED_AGENT_ID>_AUTO_COMPACT` and win over persistent configuration.
- Initially support only verified Claude Code, Codex, and Grok native hook contracts; detected agents without an adapter remain unchanged and are reported unsupported.
- Target a stable Ghostty terminal ID claimed from the event-bound focused surface; never retarget from later focus.
- Installed hooks remain dependency-free, fail open, and preserve receipt-authorized byte restoration.
- Never read, log, or persist draft contents.
- After an empty-input compaction, park until a new human prompt event.

---

### Task 1: Duration and provider override contract

**Files:**
- Create: `src/config/autoCompactDuration.ts`
- Create: `src/config/autoCompactDuration.test.ts`
- Modify: `src/config/bagConfigSchema.ts`
- Modify: `src/config/bagConfigSchema.test.ts`
- Modify: `src/runtime/config.ts`
- Modify: `src/runtime/config.test.ts`

**Interfaces:**
- Produces: `autoCompactDurationSchema`, `AutoCompactDuration`, `agentAutoCompactEnvironmentKey(agentId)`, and hook-island `resolveAutoCompactSeconds(agentId, env)`.
- Persistent field: `idleAutoCompact: "off" | "10s" | ...` encoded as the original duration string.

- [ ] **Step 1: Write failing duration and precedence tests**

```ts
expect(decodeAutoCompactDuration("30s")).toEqual({ _tag: "enabled", seconds: 30 });
expect(decodeAutoCompactDuration("2m")).toEqual({ _tag: "enabled", seconds: 120 });
expect(decodeAutoCompactDuration("1h")).toEqual({ _tag: "enabled", seconds: 3600 });
expect(decodeAutoCompactDuration("1d")).toEqual({ _tag: "enabled", seconds: 86400 });
expect(agentAutoCompactEnvironmentKey("claude-code")).toBe("DUFFLEBAG_CLAUDE_CODE_AUTO_COMPACT");
expect(resolveAutoCompactSeconds("codex", { DUFFLEBAG_CODEX_AUTO_COMPACT: "45s" }, "2m")).toBe(45);
expect(resolveAutoCompactSeconds("codex", { DUFFLEBAG_CODEX_AUTO_COMPACT: "off" }, "2m")).toBeNull();
```

- [ ] **Step 2: Run the focused tests and confirm the missing exports fail**

Run: `pnpm vitest run src/config/autoCompactDuration.test.ts src/config/bagConfigSchema.test.ts src/runtime/config.test.ts`

Expected: FAIL because duration decoding and `idleAutoCompact` do not exist.

- [ ] **Step 3: Implement the schema-owned duration and dependency-free reader**

Use `Schema.Literal("off")` plus a pattern-backed duration schema with a transform to seconds for application validation. Keep the hook reader private and switch on the unit without importing Effect.

```ts
export const agentAutoCompactEnvironmentKey = (agentId: string): string =>
  `DUFFLEBAG_${agentId.replaceAll("-", "_").toUpperCase()}_AUTO_COMPACT`;
```

Add `idleAutoCompact` to `BagConfig`, `defaultBagConfig`, `ENV_KEYS`, `configToEnvMap`, snapshots, and daemon config comparisons. Unknown provider overrides return `null` and write only a diagnostic when debug logging is enabled.

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/config/autoCompactDuration.test.ts src/config/bagConfigSchema.test.ts src/runtime/config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the configuration contract**

```bash
git add src/config/autoCompactDuration.ts src/config/autoCompactDuration.test.ts src/config/bagConfigSchema.ts src/config/bagConfigSchema.test.ts src/runtime/config.ts src/runtime/config.test.ts
git commit -m "feat(config): add provider idle compact durations"
```

### Task 2: Catalog-native hook capability

**Files:**
- Modify: `src/catalog/agentCatalog.ts`
- Modify: `src/catalog/agentCatalog.test.ts`
- Modify: `src/catalog/featureCatalog.ts`
- Modify: `src/catalog/featureCatalog.test.ts`

**Interfaces:**
- Produces: `nativeHooks` on `AgentDefinition`, tagged as `unsupported`, `claudeJson`, `codexJson`, or `grokJson` with config path and compact command.
- Expands lifecycle registration events to `SessionEnd`, `PreCompact`, and `PostCompact`.

- [ ] **Step 1: Write failing catalog tests**

```ts
expect(findAgent("claude-code").nativeHooks).toMatchObject({ _tag: "claudeJson", configPath: ".claude/settings.json" });
expect(findAgent("codex").nativeHooks).toMatchObject({ _tag: "codexJson", configPath: ".codex/hooks.json" });
expect(findAgent("grok").nativeHooks).toMatchObject({ _tag: "grokJson", configPath: ".grok/hooks/dufflebag.json" });
expect(findAgent("kimi-code").nativeHooks).toEqual({ _tag: "unsupported" });
```

- [ ] **Step 2: Run catalog tests and verify failure**

Run: `pnpm vitest run src/catalog/agentCatalog.test.ts src/catalog/featureCatalog.test.ts`

Expected: FAIL because native hook capability and Grok catalog detection do not exist.

- [ ] **Step 3: Add schema-owned capabilities and lifecycle registrations**

Add Grok as a catalog agent with `.grok` and `grok` detection. Declare verified adapters only for Claude Code, Codex, and Grok. Register one idle hook entrypoint for `SessionStart`, `UserPromptSubmit`, `Stop`, `PreCompact`, `PostCompact`, and `SessionEnd` under `context-guard`.

- [ ] **Step 4: Run catalog tests**

Run: `pnpm vitest run src/catalog/agentCatalog.test.ts src/catalog/featureCatalog.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the capability model**

```bash
git add src/catalog/agentCatalog.ts src/catalog/agentCatalog.test.ts src/catalog/featureCatalog.ts src/catalog/featureCatalog.test.ts
git commit -m "feat(catalog): declare native lifecycle hook adapters"
```

### Task 3: Pure idle state machine

**Files:**
- Create: `src/skills/contextGuard/lib/idleCompactGate.ts`
- Create: `src/skills/contextGuard/lib/idleCompactGate.test.ts`

**Interfaces:**
- Consumes: normalized lifecycle phases and timestamps.
- Produces: `decideIdleCompactAction(snapshot): IdleCompactAction` with tagged actions `wait`, `submitDraft`, `compact`, `park`, and `reap`.

- [ ] **Step 1: Write failing transition tests**

```ts
expect(decideIdleCompactAction(endedTurnBeforeDeadline)).toEqual({ _tag: "wait", reason: "idle-duration" });
expect(decideIdleCompactAction(endedTurnAfterDeadline)).toEqual({ _tag: "submitDraft" });
expect(decideIdleCompactAction(awaitingAckAfterTimeout)).toEqual({ _tag: "compact" });
expect(decideIdleCompactAction(compactionFinished)).toEqual({ _tag: "park" });
expect(decideIdleCompactAction(agentExited)).toEqual({ _tag: "reap", reason: "agent-exited" });
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run src/skills/contextGuard/lib/idleCompactGate.test.ts`

Expected: FAIL because the state machine is missing.

- [ ] **Step 3: Implement the deterministic state machine**

Keep all time, process, terminal, and lifecycle observations in the input snapshot. The function performs no I/O. A `PostCompact` event transitions to parked; only a later `UserPromptSubmit` rearms the next cycle.

- [ ] **Step 4: Run state-machine tests**

Run: `pnpm vitest run src/skills/contextGuard/lib/idleCompactGate.test.ts`

Expected: PASS, including working-turn, cancellation, duplicate-event, and repeated-empty-compaction cases.

- [ ] **Step 5: Commit the pure policy**

```bash
git add src/skills/contextGuard/lib/idleCompactGate.ts src/skills/contextGuard/lib/idleCompactGate.test.ts
git commit -m "feat(context): model idle draft and compact transitions"
```

### Task 4: Ghostty terminal ownership and input

**Files:**
- Create: `src/skills/contextGuard/lib/ghosttyTerminal.ts`
- Create: `src/skills/contextGuard/lib/ghosttyTerminal.test.ts`
- Modify: `src/skills/contextGuard/lib/state.ts`

**Interfaces:**
- Produces: `claimGhosttyTerminal(sessionId)`, `terminalExists(terminalId)`, `sendTerminalEnter(terminalId)`, and `sendTerminalText(terminalId, text)`.
- All AppleScript commands accept stable terminal IDs and return tagged refusal data rather than guessing.

- [ ] **Step 1: Write failing AppleScript-plan tests**

```ts
expect(terminalInputScript("term-2", "/compact", true)).toContain('id of t is "term-2"');
expect(terminalInputScript("term-2", "/compact", true)).not.toContain("focused terminal");
expect(decodeClaimResult("AMBIGUOUS")).toEqual({ _tag: "refused", reason: "terminal-not-proven" });
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run src/skills/contextGuard/lib/ghosttyTerminal.test.ts`

Expected: FAIL because the controller is missing.

- [ ] **Step 3: Implement safe terminal claiming and direct input**

At `SessionStart` or human `UserPromptSubmit`, require Ghostty to be frontmost and claim `front window → selected tab → focused terminal`, then retain its stable ID. Keep a temporary OSC-title proof as a fallback for controlling TTYs that allow it. Require Ghostty `>=1.3.0`. Escape AppleScript text and terminal IDs. Return refusal on ambiguity, missing terminal, disabled AppleScript, or unsupported version.

- [ ] **Step 4: Run Ghostty controller tests**

Run: `pnpm vitest run src/skills/contextGuard/lib/ghosttyTerminal.test.ts`

Expected: PASS without sending live keystrokes.

- [ ] **Step 5: Commit terminal ownership**

```bash
git add src/skills/contextGuard/lib/ghosttyTerminal.ts src/skills/contextGuard/lib/ghosttyTerminal.test.ts src/skills/contextGuard/lib/state.ts
git commit -m "feat(context): target stable Ghostty terminals"
```

### Task 5: Normalize provider lifecycle events and run the daemon

**Files:**
- Create: `src/skills/contextGuard/lib/idleCompactEvent.ts`
- Create: `src/skills/contextGuard/lib/idleCompactEvent.test.ts`
- Create: `src/skills/contextGuard/hooks/idleCompactHook.ts`
- Create: `src/skills/contextGuard/hooks/idleCompactWatch.ts`
- Create: `src/skills/contextGuard/hooks/idleCompactWatch.test.ts`
- Modify: `scripts/assembleHooks.mjs`

**Interfaces:**
- Consumes hook JSON on stdin plus `DUFFLEBAG_AGENT_ID` injected by provider registration.
- Produces normalized events persisted per `<agent-id>-<session-id>` and a detached watcher that applies `decideIdleCompactAction`.

- [ ] **Step 1: Add failing provider fixture tests**

Use representative Claude, Codex, and Grok payloads and assert all decode to:

```ts
{ agentId: "grok", sessionId: "abc", event: "turn-ended", occurredAtMs: 1_000 }
```

Also assert `PreCompact`, `PostCompact`, `SessionEnd`, invalid JSON, missing IDs, and subagent events.

- [ ] **Step 2: Run event and watcher tests and verify failure**

Run: `pnpm vitest run src/skills/contextGuard/lib/idleCompactEvent.test.ts src/skills/contextGuard/hooks/idleCompactWatch.test.ts`

Expected: FAIL because normalization and watcher entrypoints are missing.

- [ ] **Step 3: Implement one fail-open hook and one watcher**

The hook records lifecycle activity, claims the terminal at session start, and spawns one detached watcher. The watcher polls state, verifies the agent PID and terminal, sends Enter once, waits three seconds for `UserPromptSubmit`, sends the adapter compact command if no prompt starts, and parks after `PostCompact`. Retain the existing global keystroke mutex and kill switch.

- [ ] **Step 4: Assemble and run focused tests**

Run: `pnpm vitest run src/skills/contextGuard/lib/idleCompactEvent.test.ts src/skills/contextGuard/hooks/idleCompactWatch.test.ts && pnpm build`

Expected: PASS and assembled output contains `dist/hooks/idleCompactHook.js` and `dist/hooks/idleCompactWatch.js`.

- [ ] **Step 5: Commit runtime orchestration**

```bash
git add src/skills/contextGuard/lib/idleCompactEvent.ts src/skills/contextGuard/lib/idleCompactEvent.test.ts src/skills/contextGuard/hooks/idleCompactHook.ts src/skills/contextGuard/hooks/idleCompactWatch.ts src/skills/contextGuard/hooks/idleCompactWatch.test.ts scripts/assembleHooks.mjs
git commit -m "feat(context): run native idle compact sessions"
```

### Task 6: Transactional provider hook installation

**Files:**
- Create: `src/install/agentFormats/nativeHooks.ts`
- Create: `src/install/agentFormats/nativeHooks.test.ts`
- Modify: `src/install/install.ts`
- Modify: `src/install/install.test.ts`
- Modify: `src/install/update.test.ts`
- Modify: `src/install/uninstall.test.ts`
- Modify: `src/install/artifactPlan.ts`
- Modify: `src/install/artifactReceipt.ts`

**Interfaces:**
- Produces one native-hook artifact per supported selected agent and receipt-owned restoration evidence.
- Claude and Codex merge event arrays in their single JSON files; Grok owns `.grok/hooks/dufflebag.json` as a whole file.

- [ ] **Step 1: Write failing round-trip tests**

For each provider, start with user-owned bytes, install context guard, assert six lifecycle events reference `idleCompactHook.js`, update idempotently, uninstall, and assert byte-for-byte restoration. Assert unsupported Kimi receives no hook artifact.

- [ ] **Step 2: Run install lifecycle tests and verify failure**

Run: `pnpm vitest run src/install/agentFormats/nativeHooks.test.ts src/install/install.test.ts src/install/update.test.ts src/install/uninstall.test.ts`

Expected: FAIL because only Claude application hooks are currently planned.

- [ ] **Step 3: Implement format-owned planning and restoration**

Reuse lexical JSON editing for Claude and Codex. Keep one provider format owner responsible for inspect, desired hook groups, ownership validation, update, and reverse restoration. Treat Grok's dedicated file as a receipt-owned whole file. Do not share Claude application ownership with agent-owned hook artifacts.

- [ ] **Step 4: Run install lifecycle tests**

Run: `pnpm vitest run src/install/agentFormats/nativeHooks.test.ts src/install/install.test.ts src/install/update.test.ts src/install/uninstall.test.ts`

Expected: PASS, including user modification refusal and stale artifact cleanup.

- [ ] **Step 5: Commit native installation**

```bash
git add src/install/agentFormats/nativeHooks.ts src/install/agentFormats/nativeHooks.test.ts src/install/install.ts src/install/install.test.ts src/install/update.test.ts src/install/uninstall.test.ts src/install/artifactPlan.ts src/install/artifactReceipt.ts
git commit -m "feat(install): wire provider lifecycle hooks"
```

### Task 7: CLI configuration, doctor, and generated documentation

**Files:**
- Modify: `src/cli/configCommand.ts`
- Modify: `src/cli/configCommand.test.ts`
- Modify: `src/doctor.ts`
- Modify: `src/doctor.test.ts`
- Modify: `src/cli/doctorCommand.ts`
- Modify: `src/skills/autorun/SKILL.md`
- Modify: `templates/mdFiles/PROJECT.md`
- Modify: `CONTEXT.md`
- Modify: `LANGUAGE.md`
- Modify: `README.md` through `pnpm generate-readme`

**Interfaces:**
- CLI: `dufflebag config --auto-compact-idle <duration|off>`.
- Doctor agent rows add `idleAutoCompact: supported | unsupported | installed | inactive` and refusal diagnostics.

- [ ] **Step 1: Write failing CLI and doctor tests**

Assert `--auto-compact-idle 1m` persists `idleAutoCompact: "1m"`, `off` disables it, invalid values fail at CLI decode, and doctor distinguishes detected supported, installed, inactive, and unsupported agents.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm vitest run src/cli/configCommand.test.ts src/doctor.test.ts`

Expected: FAIL because the option and report fields are missing.

- [ ] **Step 3: Implement the user surface and truthful docs**

Add the option, config label, doctor schema/report presentation, Claude/Codex/Grok examples, agent-specific override names, Ghostty 1.3 requirement, explicit draft-submission warning, and unsupported-agent behavior. Update project direction from Claude-only hooks to verified native adapters.

- [ ] **Step 4: Regenerate README and run focused tests**

Run: `pnpm generate-readme && pnpm vitest run src/cli/configCommand.test.ts src/doctor.test.ts`

Expected: README marker sections regenerate and tests PASS.

- [ ] **Step 5: Commit the operator surface**

```bash
git add src/cli/configCommand.ts src/cli/configCommand.test.ts src/doctor.ts src/doctor.test.ts src/cli/doctorCommand.ts src/skills/autorun/SKILL.md templates/mdFiles/PROJECT.md CONTEXT.md LANGUAGE.md README.md
git commit -m "feat(cli): configure and diagnose idle compaction"
```

### Task 8: Full verification, live install, release, and global proof

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `docs/agents/native-idle-auto-compact-proof.md`

**Interfaces:**
- Release version: `0.13.0`.
- Published package: `ys-dufflebag@0.13.0`.

- [ ] **Step 1: Run the repository gate**

Run: `pnpm test && pnpm typecheck && pnpm verify`

Expected: all commands exit 0.

- [ ] **Step 2: Perform a dry-run three-terminal Ghostty proof**

Open or reuse three Ghostty terminals, register three synthetic session records, and run the watcher with keystroke dry-run enabled. Record distinct terminal IDs and prove each action resolves only its claimed ID. Do not submit real drafts during this dry run.

- [ ] **Step 3: Install globally from the verified checkout**

Run: `pnpm cli install --global --features context-guard,autonomous-loop --agents claude-code,codex,grok`

Expected: receipt owns the runtime and native hook registrations for every detected supported agent.

- [ ] **Step 4: Configure and run one live short-duration proof**

Run: `pnpm cli config --global --auto-compact-idle 10s`, launch one disposable supported-agent session in a dedicated Ghostty terminal, leave a harmless prompt draft, and verify the draft submits only in that terminal. Then leave an empty prompt, verify one compact command, and verify it parks. Restore the persistent value to `off` after proof.

- [ ] **Step 5: Record proof and bump the minor version**

Write exact versions, terminal IDs redacted to short suffixes, hook events, refusal checks, and command results to `docs/agents/native-idle-auto-compact-proof.md`. Update `package.json` and `pnpm-lock.yaml` to `0.13.0` without creating a tag yet.

- [ ] **Step 6: Re-run the complete gate and inspect package contents**

Run: `pnpm verify && pnpm pack --dry-run`

Expected: gate exits 0 and package includes compiled idle hooks, runtime libraries, catalog, and docs without test files or credentials.

- [ ] **Step 7: Commit and push the release source**

```bash
git add package.json pnpm-lock.yaml docs/agents/native-idle-auto-compact-proof.md
git commit -m "chore(release): 0.13.0"
git push origin main
```

- [ ] **Step 8: Tag, publish, and verify immutable identity**

```bash
git tag -a v0.13.0 -m "v0.13.0"
git push origin v0.13.0
gh run watch --exit-status
npm view ys-dufflebag@0.13.0 version dist.integrity --json
```

Expected: publish workflow succeeds and npm returns version `0.13.0` plus an integrity hash.

- [ ] **Step 9: Reinstall published package globally and diagnose**

Run: `npx --yes ys-dufflebag@0.13.0 install --global --features context-guard,autonomous-loop` followed by `npx --yes ys-dufflebag@0.13.0 doctor --global`.

Expected: installed receipt reports `0.13.0`; Claude Code, Codex, and Grok are supported and managed when detected; Kimi and other unsupported agents are reported without hook mutations.
