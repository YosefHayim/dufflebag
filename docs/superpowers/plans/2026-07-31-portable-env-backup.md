# Portable Environment Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove one portable ZIP containing 19 independently encrypted vaults that restore all 42 audited runtime environment paths on a new Mac.

**Architecture:** A dependency-free Node.js CLI captures an explicit allowlist, serializes exact bytes and symlinks into authenticated per-scope payloads, and protects each payload with an independently prompted scrypt-derived AES-256-GCM key. The same standalone script restores vaults transactionally; the encoder packages it with a redacted manifest and README, then decrypts the extracted ZIP in memory to prove the real archive before publication.

**Tech Stack:** Node.js 20+ built-ins, `node:test`, `node:crypto`, `node:fs/promises`, macOS `/usr/bin/ditto`, Git, SHA-256, scrypt, AES-256-GCM.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-31-portable-env-backup-design.md` exactly.
- Use one separate passphrase for each of 18 repositories and one separate passphrase for `_workspace`.
- Require at least 16 Unicode code points, hidden confirmation, and within-run passphrase-reuse rejection.
- Never accept passphrases through arguments, environment variables, files, chat, agent tool input, or echoed terminal input.
- Use AES-256-GCM with scrypt `N=262144`, `r=8`, `p=1`, a 32-byte key, a 16-byte random salt, a 12-byte random nonce, a 16-byte authentication tag, and `maxmem=536870912`.
- Use SHA-256 for byte comparisons and transfer integrity, never as reversible encryption.
- Preserve exact regular-file bytes and modes plus the relative `ai-visibility/.dev.vars -> .env` symlink.
- Reject unsafe paths, unsafe links, unreviewed inventory entries, changed sources, tampering, and differing restore targets by default.
- Keep real environment values, plaintext hashes, payload paths, passphrases, vaults, inventory, implementation, test fixtures, receipts, staging, and the ZIP out of Git.
- Do not modify application repositories, environment schemas, deployment providers, repository visibility, or normal branches.
- Write the final archive only to `/Users/yosefhayimsabag/Desktop/mac-env-backup-2026-07-31.zip` with mode `0600`.
- Use synthetic credentials in tests and redact all runtime diagnostics.
- Run the passphrase prompts in a local Terminal window so the agent never receives or relays secret input.
- Implementation tasks end in explicit verification checkpoints rather than commits because the approved design keeps migration code and artifacts under ignored `scripts/dev/`. Only this plan document is committed and pushed.

## File Map

- Create ignored source: `scripts/dev/portableEnvBackup/envVault.mjs` — standalone crypto, capture, archive, decode, restore, prompt, and CLI implementation copied into the ZIP as `env-vault.mjs`.
- Create ignored tests: `scripts/dev/portableEnvBackup/envVault.test.mjs` — synthetic fixtures, security cases, transaction tests, CLI tests, and macOS ZIP integration.
- Create ignored inventory: `scripts/dev/portableEnvBackup/inventory.json` — exact 42-path allowlist with repository names only; no values or hashes.
- Create ignored launcher: `scripts/dev/portableEnvBackup/runBackup.command` — opens the encoder in the user's Terminal without carrying any passphrase.
- Create ignored receipt: `scripts/dev/portableEnvBackup/run-receipt.json` — redacted counts, archive size, digest, and scope statuses from the completed real run.
- Create final artifact: `/Users/yosefhayimsabag/Desktop/mac-env-backup-2026-07-31.zip` — ordinary ZIP with ciphertext vaults, standalone tool, README, and non-secret manifest.
- Modify tracked plan only: `docs/superpowers/plans/2026-07-31-portable-env-backup.md` — execution checklist and review record.

---

### Task 1: Inventory, canonical JSON, and path contract

**Files:**
- Create: `scripts/dev/portableEnvBackup/envVault.mjs`
- Create: `scripts/dev/portableEnvBackup/envVault.test.mjs`
- Create: `scripts/dev/portableEnvBackup/inventory.json`

**Interfaces:**
- Consumes: UTF-8 inventory bytes and a selected absolute `Code` directory.
- Produces: `parseInventory(bytes)`, `assertExpectedInventory(inventory, expected)`, `canonicalJson(value)`, `validateRelativePath(path)`, and immutable `BackupInventory` values.

- [ ] **Step 1: Write failing canonicalization, inventory, and path tests**

Start the test file with Node built-ins and literal assertions:

```js
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  FORMAT,
  canonicalJson,
  parseInventory,
  validateRelativePath,
} from "./envVault.mjs";

test("canonicalJson sorts every object level without changing arrays", () => {
  assert.equal(
    canonicalJson({ z: 1, nested: { y: 2, a: 3 }, list: [{ b: 1, a: 2 }] }),
    '{"list":[{"a":2,"b":1}],"nested":{"a":3,"y":2},"z":1}',
  );
});

test("validateRelativePath rejects traversal and case collisions are rejected by inventory", () => {
  assert.equal(validateRelativePath("apps/web/.env.local"), "apps/web/.env.local");
  for (const value of ["", ".", "../.env", "/tmp/.env", "a//.env", "a/./.env", "a\\.env", "a\0.env"]) {
    assert.throws(() => validateRelativePath(value), { code: "UNSAFE_PATH" });
  }
  assert.throws(
    () => parseInventory(Buffer.from(JSON.stringify({
      version: 1,
      scopes: [{ kind: "repository", name: "sample", paths: [".env", ".ENV"] }],
    }))),
    { code: "CASE_COLLISION" },
  );
});
```

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
node --test --test-name-pattern='canonicalJson|validateRelativePath' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: FAIL because `envVault.mjs` and its exports do not exist.

- [ ] **Step 3: Add the minimal contract and canonical serializer**

Define fixed constants, an error with a stable code, recursive key sorting, and normalized POSIX-path validation:

```js
export const FORMAT = Object.freeze({
  archive: "dufflebag-env-archive",
  payload: "dufflebag-env-payload",
  vault: "dufflebag-env-vault",
  version: 1,
});

export class VaultError extends Error {
  constructor(code, scope = null) {
    super(code);
    this.name = "VaultError";
    this.code = code;
    this.scope = scope;
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new VaultError("INVALID_JSON_VALUE");
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function validateRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\")) {
    throw new VaultError("UNSAFE_PATH");
  }
  const parts = value.split("/");
  if (value.startsWith("/") || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new VaultError("UNSAFE_PATH");
  }
  return value;
}
```

`parseInventory(bytes)` must require the exact top-level keys `version` and `scopes`, version `1`, scope kinds `workspace` or `repository`, `_workspace` as the only workspace name, unique direct-child repository names, unique normalized paths, and no case-fold collisions. It must freeze the returned arrays and objects. `assertExpectedInventory(inventory, { scopeCount, entryCount })` applies the migration-specific 19-scope and 42-entry gate without preventing small synthetic inventories in unit tests.

- [ ] **Step 4: Create the reviewed 42-path inventory**

Write this exact non-secret JSON under the ignored migration directory:

```json
{
  "version": 1,
  "scopes": [
    { "kind": "workspace", "name": "_workspace", "paths": [".env"] },
    { "kind": "repository", "name": "MYPR-App", "paths": [".env", "client/ios/.xcode.env"] },
    { "kind": "repository", "name": "Oly-App", "paths": [".env", "ios/.xcode.env"] },
    { "kind": "repository", "name": "ai-chat-saas", "paths": [".env", "apps/chatWorker/.dev.vars", "apps/web/.env.local"] },
    { "kind": "repository", "name": "ai-visibility", "paths": [".env", ".dev.vars"] },
    { "kind": "repository", "name": "alg", "paths": [".env", ".tmp/d1-backup/lean-prod-secrets.env"] },
    { "kind": "repository", "name": "ebay-mcp", "paths": [".env"] },
    { "kind": "repository", "name": "email-sender", "paths": [".env"] },
    { "kind": "repository", "name": "extension-studio", "paths": [".env"] },
    { "kind": "repository", "name": "extensions", "paths": [".env", ".dev.vars"] },
    { "kind": "repository", "name": "fresh-squeezy", "paths": [".env", ".env.live.local", ".env.test.local"] },
    { "kind": "repository", "name": "genshot", "paths": [".env", "apps/operator/.env.local", "apps/worker/.dev.vars"] },
    { "kind": "repository", "name": "ib-bot", "paths": [".env"] },
    { "kind": "repository", "name": "jts-agency", "paths": [".env"] },
    { "kind": "repository", "name": "mobile-apps-monorepo", "paths": ["apps/booking/ios/.xcode.env"] },
    { "kind": "repository", "name": "portfolio", "paths": ["server/.env"] },
    { "kind": "repository", "name": "vybekiit", "paths": [".env", "apps/landing/.env.local", "cli/.env", "templates/backend/.env", "templates/mobile/ios/.xcode.env"] },
    { "kind": "repository", "name": "wedding-digital-invites", "paths": [".env"] },
    { "kind": "repository", "name": "zaatar-tech-main-repo", "paths": [".env", "apps/mypr/.env", "apps/mypr/ios/.xcode.env", "apps/poker/.env", "apps/poker/ios/.xcode.env", "apps/pomedero/.env", "apps/pomedero/ios/.xcode.env", "server/src/apps/mypr/.env.local", "server/src/apps/pomedero/.env"] }
  ]
}
```

- [ ] **Step 5: Verify the contract is GREEN**

Run:

```bash
node --test --test-name-pattern='canonicalJson|validateRelativePath|inventory' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: all focused tests pass; a direct parse of `inventory.json` reports exactly 19 scopes and 42 paths without opening any source env file.

- [ ] **Step 6: Add deterministic synthetic test helpers**

Keep all helpers inside the ignored test file so no real environment value can enter a fixture:

```js
async function createFixtureCodeTree(context, repositories) {
  const codeDir = await mkdtemp(join(tmpdir(), "env-vault-test-"));
  context.after(async () => rm(codeDir, { recursive: true, force: true }));
  for (const [repository, entries] of Object.entries(repositories)) {
    const root = repository === "_workspace" ? codeDir : join(codeDir, repository);
    await mkdir(root, { recursive: true });
    for (const [relativePath, bytes] of Object.entries(entries)) {
      const destination = join(root, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { mode: 0o600 });
    }
  }
  return codeDir;
}

function fakePayload(scopeName, bytes = Buffer.from("TOKEN=synthetic-only\n", "utf8")) {
  return {
    createdAt: "2026-07-31T00:00:00.000Z",
    entries: [{
      byteLength: bytes.length,
      bytes: bytes.toString("base64"),
      kind: "file",
      mode: 0o600,
      path: ".env",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }],
    format: FORMAT.payload,
    scope: { kind: "repository", name: scopeName },
    version: FORMAT.version,
  };
}

function createFakeTty() {
  const input = new EventEmitter();
  return Object.assign(input, {
    isRaw: false,
    isTTY: true,
    paused: true,
    rawModes: [],
    isPaused() { return this.paused; },
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    setRawMode(value) { this.isRaw = value; this.rawModes.push(value); },
  });
}

function createRecordedOutput() {
  return {
    text: "",
    write(value) { this.text += value; },
  };
}
```

### Task 2: Byte-exact source capture and encrypted payload validation

**Files:**
- Modify: `scripts/dev/portableEnvBackup/envVault.mjs`
- Modify: `scripts/dev/portableEnvBackup/envVault.test.mjs`

**Interfaces:**
- Consumes: `BackupInventory`, a `Code` directory, regular files, and relative in-scope symlinks.
- Produces: `captureScope({ codeDir, scope })`, `validatePayload(value, expectedScope)`, and sorted immutable `ScopePayload` values.

- [ ] **Step 1: Write failing regular-file and symlink capture tests**

Use a temporary fake `Code` tree with synthetic values:

```js
test("captureScope preserves bytes, mode, and an internal relative symlink", async (context) => {
  const fixture = await createFixtureCodeTree(context, {
    sample: { ".env": Buffer.from("TOKEN=synthetic-only\n", "utf8") },
  });
  await symlink(".env", join(fixture, "sample", ".dev.vars"));
  await chmod(join(fixture, "sample", ".env"), 0o600);
  const payload = await captureScope({
    codeDir: fixture,
    scope: { kind: "repository", name: "sample", paths: [".env", ".dev.vars"] },
  });
  assert.deepEqual(payload.entries.map((entry) => entry.kind), ["symlink", "file"]);
  assert.equal(payload.entries.find((entry) => entry.kind === "file").mode, 0o600);
  assert.equal(payload.entries.find((entry) => entry.kind === "symlink").target, ".env");
});
```

Add cases for a missing source, directory source, absolute symlink, escaping symlink, a root that is not a direct child of `Code`, and a file changed between pre-read and post-read stat checks. Inject a file adapter into the changed-source test so the mutation is deterministic.

- [ ] **Step 2: Run source tests to verify RED**

Run:

```bash
node --test --test-name-pattern='captureScope|source' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: FAIL because source capture and payload validation do not exist.

- [ ] **Step 3: Implement capture without parsing env content**

Represent entries exactly as these shapes:

```js
/** @typedef {{kind:"file", path:string, mode:number, bytes:string, byteLength:number, sha256:string}} FileEntry */
/** @typedef {{kind:"symlink", path:string, target:string, targetByteLength:number, sha256:string}} SymlinkEntry */
/** @typedef {{format:string, version:1, scope:{kind:"workspace"|"repository",name:string}, createdAt:string, entries:Array<FileEntry|SymlinkEntry>}} ScopePayload */
```

For files, call `lstat`, read exact bytes once, call `lstat` again, and require matching device, inode, size, mode, and nanosecond modification time. Store `mode & 0o777`, base64 bytes, byte length, and lowercase hex SHA-256. For symlinks, use `readlink` as bytes where supported, require a relative target that normalizes inside the scope, and hash its exact UTF-8 target bytes. Sort entries by `path` using code-point order.

`validatePayload` must enforce exact keys, supported format and version, authenticated scope equality, ISO timestamp syntax, entry-size bounds, base64 canonicality, byte lengths, digests, modes from `0000` through `0777`, sorted uniqueness, and the same path/link safety rules used during capture.

- [ ] **Step 4: Verify source capture is GREEN**

Run:

```bash
node --test --test-name-pattern='captureScope|source|payload' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: all capture and payload cases pass, including exact bytes and symlink identity.

### Task 3: Authenticated per-scope vault encryption

**Files:**
- Modify: `scripts/dev/portableEnvBackup/envVault.mjs`
- Modify: `scripts/dev/portableEnvBackup/envVault.test.mjs`

**Interfaces:**
- Consumes: validated `ScopePayload`, UTF-8 passphrase bytes, and an injected crypto profile for tests.
- Produces: `encryptPayload(options)`, `decryptVault(options)`, `decryptVaultWithKey(options)`, and canonical vault-envelope bytes.

- [ ] **Step 1: Write failing encryption and tamper tests**

Define a low-cost test-only scrypt profile; production CLI code must never select it:

```js
const TEST_CRYPTO_PROFILE = Object.freeze({
  N: 1024,
  r: 8,
  p: 1,
  keyLength: 32,
  maxmem: 32 * 1024 * 1024,
  saltLength: 16,
  nonceLength: 12,
  tagLength: 16,
});

test("one vault decrypts only with its matching passphrase and scope", async () => {
  const passphrase = Buffer.from("synthetic-password-one", "utf8");
  const encrypted = await encryptPayload({ payload: fakePayload("sample"), passphrase, profile: TEST_CRYPTO_PROFILE });
  const decoded = await decryptVault({ vaultBytes: encrypted.vaultBytes, passphrase, profile: TEST_CRYPTO_PROFILE });
  assert.deepEqual(decoded.payload, fakePayload("sample"));
  await assert.rejects(
    decryptVault({ vaultBytes: encrypted.vaultBytes, passphrase: Buffer.from("wrong-password-value"), profile: TEST_CRYPTO_PROFILE }),
    { code: "AUTHENTICATION_FAILED" },
  );
});
```

Add table tests that alter one byte of salt, nonce, tag, ciphertext, bound scope, format, or version. Add malformed base64, wrong decoded lengths, extra keys, duplicate-key raw JSON, whitespace, trailing bytes, unsupported scrypt parameters, and oversized envelope cases.

- [ ] **Step 2: Run crypto tests to verify RED**

Run:

```bash
node --test --test-name-pattern='vault|passphrase|tamper|envelope' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: FAIL because vault encryption and authentication do not exist.

- [ ] **Step 3: Implement the fixed production profile and envelope**

Use the exact profile and envelope:

```js
export const PRODUCTION_CRYPTO_PROFILE = Object.freeze({
  N: 262144,
  r: 8,
  p: 1,
  keyLength: 32,
  maxmem: 536870912,
  saltLength: 16,
  nonceLength: 12,
  tagLength: 16,
});

function authenticatedScope(scope) {
  return Buffer.from(canonicalJson({
    format: FORMAT.vault,
    scope,
    version: FORMAT.version,
  }), "utf8");
}
```

The envelope schema is:

```js
{
  cipher: { name: "aes-256-gcm", nonce: "base64", tag: "base64" },
  ciphertext: "base64",
  format: "dufflebag-env-vault",
  kdf: {
    N: 262144,
    keyLength: 32,
    maxmem: 536870912,
    name: "scrypt",
    p: 1,
    r: 8,
    salt: "base64"
  },
  scope: { kind: "repository", name: "sample" },
  version: 1
}
```

Validate the complete envelope and exact KDF profile before calling scrypt. Canonicalize the payload bytes, derive the key asynchronously, authenticate the scope object as GCM additional data, and return `{ vaultBytes, key }`. `decryptVaultWithKey` authenticates and validates the payload without deriving again; this is used only for same-process archive proof. On every exit path, callers overwrite key and passphrase buffers with zeroes on a best-effort basis.

- [ ] **Step 4: Add one real production-cost scrypt integration test**

Run a single round trip with `PRODUCTION_CRYPTO_PROFILE`, assert it succeeds, and set a generous 30-second test timeout. Keep all combinatorial tests on `TEST_CRYPTO_PROFILE` so verification remains practical.

- [ ] **Step 5: Verify crypto is GREEN**

Run:

```bash
node --test --test-name-pattern='vault|passphrase|tamper|envelope|production scrypt' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: every tamper fails authentication or validation, wrong passphrases reveal no payload metadata, and the production-cost round trip passes.

### Task 4: Hidden passphrase input and reuse prevention

**Files:**
- Modify: `scripts/dev/portableEnvBackup/envVault.mjs`
- Modify: `scripts/dev/portableEnvBackup/envVault.test.mjs`

**Interfaces:**
- Consumes: an interactive TTY and non-secret scope name.
- Produces: `readHiddenLine(options)`, `promptForNewPassphrase(options)`, `promptForExistingPassphrase(options)`, and `createReuseGuard(sessionKey)`.

- [ ] **Step 1: Write failing fake-TTY tests**

Use an in-memory `EventEmitter` with `isTTY=true`, `isRaw=false`, and a recorded `setRawMode` sequence:

```js
test("hidden input restores terminal state and never writes entered characters", async () => {
  const input = createFakeTty();
  const output = createRecordedOutput();
  const pending = readHiddenLine({ input, output, prompt: "Passphrase for sample: " });
  input.emit("data", Buffer.from("synthetic-password-one\r", "utf8"));
  assert.equal(await pending, "synthetic-password-one");
  assert.deepEqual(input.rawModes, [true, false]);
  assert.equal(output.text, "Passphrase for sample: \n");
  assert.equal(output.text.includes("synthetic-password-one"), false);
});
```

Add confirmation mismatch, fewer-than-16-code-points, emoji code-point count, Ctrl-C, SIGTERM cleanup, backspace, Ctrl-U, non-TTY rejection, reuse rejection, and two distinct-passphrase success cases.

- [ ] **Step 2: Run prompt tests to verify RED**

Run:

```bash
node --test --test-name-pattern='hidden|TTY|reuse|confirmation|code points' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: FAIL because prompt handling does not exist.

- [ ] **Step 3: Implement hidden prompts with guaranteed cleanup**

`readHiddenLine` must save the prior raw state, enter raw mode, collect printable input without echo, support delete and Ctrl-U, treat carriage return or newline as completion, and treat Ctrl-C as `INTERRUPTED`. Register scoped SIGINT, SIGTERM, and SIGHUP cleanup handlers and remove them after settlement. A `finally` block restores the prior raw mode, pauses an input that was initially paused, and writes one newline.

`promptForNewPassphrase` counts `[...value].length`, prompts twice, and returns a UTF-8 `Buffer` only after policy, confirmation, and reuse checks pass. `promptForExistingPassphrase` prompts once and rejects empty input.

Use this process-local comparison only:

```js
export function createReuseGuard(sessionKey) {
  const fingerprints = new Set();
  return (passphraseBytes) => {
    const fingerprint = createHmac("sha256", sessionKey).update(passphraseBytes).digest("hex");
    if (fingerprints.has(fingerprint)) throw new VaultError("PASSPHRASE_REUSED");
    fingerprints.add(fingerprint);
  };
}
```

Do not expose a passphrase option in the CLI parser and do not read a passphrase-named environment variable.

- [ ] **Step 4: Verify prompt behavior is GREEN**

Run:

```bash
node --test --test-name-pattern='hidden|TTY|reuse|confirmation|code points' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: all prompt tests pass and captured output contains no synthetic secret characters.

### Task 5: Transactional decoder and restore-path safety

**Files:**
- Modify: `scripts/dev/portableEnvBackup/envVault.mjs`
- Modify: `scripts/dev/portableEnvBackup/envVault.test.mjs`

**Interfaces:**
- Consumes: an authenticated `ScopePayload`, selected `Code` directory, and `force` boolean.
- Produces: `preflightRestore(options)`, `applyRestorePlan(plan)`, and repository-scoped redacted restore results.

- [ ] **Step 1: Write failing restore transaction tests**

Cover a new file, exact existing file, differing existing file, explicit replacement, missing repository, workspace mapping, symlink restoration, symlink parent pivot, case collision, injected mid-transaction write failure, and rollback of both created and replaced paths.

```js
test("restore refuses a differing destination unless force is explicit", async (context) => {
  const codeDir = await createFixtureCodeTree(context, {
    sample: { ".env": Buffer.from("EXISTING=synthetic\n", "utf8") },
  });
  const payload = fakePayload("sample", Buffer.from("RESTORED=synthetic\n", "utf8"));
  await assert.rejects(preflightRestore({ codeDir, payload, force: false }), { code: "DESTINATION_CONFLICT" });
  const plan = await preflightRestore({ codeDir, payload, force: true });
  const result = await applyRestorePlan(plan);
  assert.equal(result.restored, 1);
  assert.equal(await readFile(join(codeDir, "sample", ".env"), "utf8"), "RESTORED=synthetic\n");
});
```

- [ ] **Step 2: Run restore tests to verify RED**

Run:

```bash
node --test --test-name-pattern='restore|destination|rollback|symlink parent' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: FAIL because restoration does not exist.

- [ ] **Step 3: Implement complete preflight before the first write**

Resolve `_workspace` to `codeDir`; resolve repositories only to `join(codeDir, authenticatedName)`. Require the code root and repository root to be real directories, require the repository realpath to remain inside the code realpath, and inspect every destination parent with `lstat` without following links.

Build an immutable plan containing:

```js
{
  scope: { kind: "repository", name: "sample" },
  root: "/absolute/fake/Code/sample",
  actions: [
    { kind: "create-file", destination: "/absolute/fake/Code/sample/.env", bytes: Buffer.from("RESTORED=synthetic\n"), mode: 0o600 }
  ],
  skipped: 0
}
```

For pre-existing destinations, compare exact bytes, modes, and link identity. Skip exact matches. Reject differences unless `force` is true. When forced, retain prior bytes, mode, or link target only in the in-memory action so rollback is possible.

- [ ] **Step 4: Implement atomic application and rollback**

For each regular file, create a randomized sibling with flags `wx` and mode `0600`, write and sync it, apply the stored mode, then rename. Create symlinks only after all parent checks. Record completed actions. On failure, walk completed actions in reverse, remove newly created destinations, and atomically restore forced replacements from their in-memory prior state. Clean sibling temp files in `finally`.

- [ ] **Step 5: Verify restore behavior is GREEN**

Run:

```bash
node --test --test-name-pattern='restore|destination|rollback|symlink parent|workspace' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: all restore safety and rollback tests pass; no path outside the fixture scope changes.

### Task 6: Archive manifest, macOS ZIP, CLI, README, and redacted receipt

**Files:**
- Modify: `scripts/dev/portableEnvBackup/envVault.mjs`
- Modify: `scripts/dev/portableEnvBackup/envVault.test.mjs`
- Create: `scripts/dev/portableEnvBackup/runBackup.command`

**Interfaces:**
- Consumes: inventory, captured scopes, hidden passphrases, output ZIP path, and extracted archive directory.
- Produces: `parseArgs(argv)`, `renderResult(result)`, `runEncode(options)`, `runDecode(options)`, `manifest.json`, `README.txt`, ZIP packaging, and `run-receipt.json`.

- [ ] **Step 1: Write failing archive and CLI tests**

Add tests for exact argument parsing, forbidden secret-bearing arguments, non-TTY encode/decode, manifest sorting and digests, archive overwrite refusal, staging cleanup, ZIP extraction, `--repo`, `--all`, missing-repository isolation, `--force`, receipt schema, and redaction.

```js
test("CLI rejects every passphrase transport other than the hidden TTY", () => {
  for (const argv of [
    ["encode", "--passphrase", "synthetic-password"],
    ["decode", "--password=synthetic-password"],
    ["decode", "--passphrase-file", "/tmp/password"],
  ]) {
    assert.throws(() => parseArgs(argv), { code: "FORBIDDEN_SECRET_ARGUMENT" });
  }
});

test("safe diagnostics never contain synthetic values or payload paths", () => {
  const secret = "NEVER_PRINT_THIS_SYNTHETIC_VALUE";
  const rendered = renderResult({ code: "AUTHENTICATION_FAILED", scope: "sample", internal: secret });
  assert.equal(rendered, "sample: authentication failed");
  assert.equal(rendered.includes(secret), false);
  assert.equal(rendered.includes(".env"), false);
});
```

- [ ] **Step 2: Run archive and CLI tests to verify RED**

Run:

```bash
node --test --test-name-pattern='CLI|archive|manifest|ZIP|receipt|diagnostic' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: FAIL because orchestration, packaging, and CLI output do not exist.

- [ ] **Step 3: Implement manifest and archive staging**

Create a canonical manifest with this exact public shape:

```js
{
  createdAt: "2026-07-31T00:00:00.000Z",
  format: "dufflebag-env-archive",
  scopes: [
    {
      byteLength: 1234,
      filename: "sample.env.vault",
      scope: { kind: "repository", name: "sample" },
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ],
  version: 1
}
```

Sort scopes by name. The real manifest may expose scope names, ciphertext sizes, and ciphertext hashes only. Write `manifest.json`, generated `README.txt`, the current standalone source copied as `env-vault.mjs`, and mode-`0600` vaults into a unique temporary root named `mac-env-backup-2026-07-31`.

Create a temporary ZIP beside the final Desktop target with:

```bash
/usr/bin/ditto -c -k --keepParent /private/tmp/mac-env-backup-stage-0123456789/mac-env-backup-2026-07-31 /Users/yosefhayimsabag/Desktop/.mac-env-backup-2026-07-31.zip.0123456789abcdef.tmp
```

Refuse an existing final ZIP. Extract the temporary ZIP with `/usr/bin/ditto -x -k`, verify the exact entry set and every manifest ciphertext digest, decrypt every extracted vault with its retained in-process key, and compare all source entry hashes, modes, and symlink targets again. Rename to the final path only after every check passes, then set mode `0600`.

- [ ] **Step 4: Implement CLI commands and recovery README**

Support exactly:

```text
node env-vault.mjs encode --inventory /Users/yosefhayimsabag/Desktop/Code/dufflebag/scripts/dev/portableEnvBackup/inventory.json --code-dir /Users/yosefhayimsabag/Desktop/Code --output /Users/yosefhayimsabag/Desktop/mac-env-backup-2026-07-31.zip --receipt /Users/yosefhayimsabag/Desktop/Code/dufflebag/scripts/dev/portableEnvBackup/run-receipt.json
node env-vault.mjs decode --repo MYPR-App --code-dir /Users/yosefhayimsabag/Desktop/Code
node env-vault.mjs decode --all --code-dir /Users/yosefhayimsabag/Desktop/Code
node env-vault.mjs decode --repo MYPR-App --code-dir /Users/yosefhayimsabag/Desktop/Code --force
```

The decoder resolves `manifest.json` and `vaults/` relative to its own extracted script path. Unknown flags fail. `encode` and `decode` require TTY input. The README must say: clone repositories into one `Code` directory, install Node.js 20 or newer, extract the ZIP, run one of the decode commands, enter the matching passphrase locally, and never email the passphrases with the archive.

The redacted receipt schema is:

```js
{
  archiveByteLength: 12345,
  archiveSha256: "0000000000000000000000000000000000000000000000000000000000000000",
  completedAt: "2026-07-31T00:00:00.000Z",
  entryCount: 42,
  scopeCount: 19,
  scopes: [{ name: "sample", status: "verified" }],
  status: "complete",
  version: 1
}
```

It must not contain paths other than the final archive path, values, passphrases, plaintext hashes, payloads, exception stacks, or commands.

- [ ] **Step 5: Create the direct-Terminal launcher**

Create a mode-`0700` command file with no secret input:

```bash
#!/bin/zsh
set -euo pipefail
cd /Users/yosefhayimsabag/Desktop/Code/dufflebag
exec node scripts/dev/portableEnvBackup/envVault.mjs encode \
  --inventory scripts/dev/portableEnvBackup/inventory.json \
  --code-dir /Users/yosefhayimsabag/Desktop/Code \
  --output /Users/yosefhayimsabag/Desktop/mac-env-backup-2026-07-31.zip \
  --receipt scripts/dev/portableEnvBackup/run-receipt.json
```

The agent launches this file with `open -a Terminal`. The user types every passphrase only into that Terminal. The launcher, receipt, and Terminal transcript contain no passphrase.

- [ ] **Step 6: Verify archive and CLI behavior is GREEN**

Run:

```bash
node --test --test-name-pattern='CLI|archive|manifest|ZIP|receipt|diagnostic' scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: all orchestration tests pass, the test ZIP restores only synthetic fixture bytes, and captured stdout/stderr contains neither fixture secrets nor `.env` paths.

### Task 7: Full local verification and real encrypted archive run

**Files:**
- Verify: `scripts/dev/portableEnvBackup/envVault.mjs`
- Verify: `scripts/dev/portableEnvBackup/envVault.test.mjs`
- Verify: `scripts/dev/portableEnvBackup/inventory.json`
- Verify: `scripts/dev/portableEnvBackup/runBackup.command`
- Create: `scripts/dev/portableEnvBackup/run-receipt.json`
- Create: `/Users/yosefhayimsabag/Desktop/mac-env-backup-2026-07-31.zip`

**Interfaces:**
- Consumes: all tested components, the live 42-path inventory, and passphrases entered directly by the user.
- Produces: one proven archive plus a redacted completion receipt.

- [ ] **Step 1: Run the complete synthetic suite**

Run:

```bash
node --test scripts/dev/portableEnvBackup/envVault.test.mjs
```

Expected: all contract, capture, crypto, prompt, restore, archive, CLI, redaction, and real-production-scrypt tests pass.

- [ ] **Step 2: Run static and leak preflights without reading values**

Run syntax checking, inspect ignored status, confirm no inventory source is Git-tracked, confirm every source exists as a file or reviewed link, aggregate byte sizes without content output, and scan the migration source for forbidden secret transports.

```bash
node --check scripts/dev/portableEnvBackup/envVault.mjs
git check-ignore -v scripts/dev/portableEnvBackup/envVault.mjs scripts/dev/portableEnvBackup/envVault.test.mjs scripts/dev/portableEnvBackup/inventory.json scripts/dev/portableEnvBackup/runBackup.command
git ls-files --error-unmatch scripts/dev/portableEnvBackup/envVault.mjs
```

Expected: syntax succeeds, all migration files are ignored, and `git ls-files --error-unmatch` fails because the implementation is not tracked. The inventory-aware preflight reports only 19 scopes, 42 entries, and one integer aggregate-byte count.

- [ ] **Step 3: Launch the real hidden-prompt run outside agent input**

Run:

```bash
open -a Terminal /Users/yosefhayimsabag/Desktop/Code/dufflebag/scripts/dev/portableEnvBackup/runBackup.command
```

Tell the user that 19 independent passphrases will be requested and each new passphrase requires confirmation. Do not ask them to paste any passphrase into chat or an agent tool.

- [ ] **Step 4: Inspect only the redacted completion receipt**

After the user finishes the Terminal prompts, read `run-receipt.json` and require:

```json
{
  "status": "complete",
  "scopeCount": 19,
  "entryCount": 42
}
```

Also require 19 unique `verified` scope records, a positive archive size, and a 64-character lowercase archive SHA-256. If the receipt is absent or failed, report only its safe code and scope; do not inspect terminal history or plaintext env content.

- [ ] **Step 5: Independently inspect the published ZIP without decrypting secrets**

Verify the file mode, calculate its SHA-256, list its entries, extract it to a fresh temporary directory, compare the extracted manifest's 19 ciphertext hashes, run `node --check` on the included script, and confirm the README contains both decode commands. Require exactly one root directory, three public root files, and 19 `.env.vault` files.

Expected: the independently calculated byte size and SHA-256 match the receipt, and no plaintext `.env`, `.env.local`, `.dev.vars`, or `.xcode.env` entry exists in the ZIP.

### Task 8: Final Git and reset-readiness proof

**Files:**
- Verify: all Git repositories under `/Users/yosefhayimsabag/Desktop/Code`
- Verify: `/Users/yosefhayimsabag/Desktop/mac-env-backup-2026-07-31.zip`

**Interfaces:**
- Consumes: the existing remote-backup audit, the newly pushed Dufflebag plan commit, and the completed encrypted archive receipt.
- Produces: a final handoff with exact remote proof, archive proof, and new-Mac recovery commands.

- [ ] **Step 1: Prove Git still contains no backup artifacts or newly local-only commits**

Fetch every repository, require `git rev-list --branches --not --remotes=origin` to return no commit, and search tracked paths for `mac-env-backup`, `.env.vault`, `run-receipt.json`, and the ignored implementation names. Confirm the final ZIP resolves outside every Git worktree.

Expected: zero local-only branch commits and zero tracked plaintext or ciphertext backup artifacts.

- [ ] **Step 2: Reconfirm prior recovery refs without changing them**

Re-run the established exact-ref audit for the 88 dated backup refs, 35 stash snapshots, 24 dirty-tree snapshots, and 158 tags. Treat the two prunable worktree metadata records as informational because their commits are already remote-reachable.

Expected: every preserved source commit and tree still has an exact remote recovery object.

- [ ] **Step 3: Publish the recovery handoff**

Report the clickable ZIP path, byte size, SHA-256, 19-of-19 vault proof, 42-of-42 entry proof, and that passphrases were never received or stored by the agent. Give one literal `git clone` command for every audited origin URL, followed by these new-Mac recovery commands:

```bash
git -C /Users/yosefhayimsabag/Desktop/Code/dufflebag fetch --all --tags
node /Users/yosefhayimsabag/Desktop/mac-env-backup-2026-07-31/env-vault.mjs decode --all --code-dir /Users/yosefhayimsabag/Desktop/Code
```

State that each vault prompts for its matching passphrase, different existing env files are refused unless `--force` is explicit, and forgotten repository passphrases cannot be recovered.
