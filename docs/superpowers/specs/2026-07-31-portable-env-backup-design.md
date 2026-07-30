# Portable Environment Backup Design

## Goal

Create one email-friendly archive named `mac-env-backup-2026-07-31.zip` that can restore every current untracked runtime environment file after the repositories are cloned onto a new Mac.

The archive contains one independently encrypted vault per repository and one vault for the `Code` workspace root. Every vault uses its own passphrase. The archive contains the portable restore tool, but no passphrase and no plaintext environment value.

Git remains the recovery system for source history. This backup covers only ignored environment state that Git intentionally does not preserve.

## Approved Decisions

- Package all vaults into one ZIP attachment instead of creating many email attachments.
- Name each vault after its repository, such as `MYPR-App.env.vault`.
- Store workspace-root environment state in `_workspace.env.vault`.
- Restore every file to its original relative path rather than flattening files into one root `.env`.
- Prompt invisibly for a different passphrase for every repository and for the workspace vault.
- Confirm each passphrase during encoding and reject reuse within the backup run.
- Never print, persist, commit, email, or accept passphrases through command-line arguments or environment variables.
- Keep both plaintext files and ciphertext vaults out of every application repository.
- Include one dependency-free Node.js tool with `encode` and `decode` commands in the ZIP.
- Do not create a recovery-codes or password file. A forgotten passphrase makes only that repository's vault unrecoverable.

## Current Scope

The audited source set contains 42 runtime paths in 19 independently encrypted scopes: 18 repositories plus the workspace root.

| Scope | Runtime paths |
| --- | --- |
| `_workspace` | `.env` |
| `MYPR-App` | `.env`, `client/ios/.xcode.env` |
| `Oly-App` | `.env`, `ios/.xcode.env` |
| `ai-chat-saas` | `.env`, `apps/chatWorker/.dev.vars`, `apps/web/.env.local` |
| `ai-visibility` | `.env`, `.dev.vars` |
| `alg` | `.env`, `.tmp/d1-backup/lean-prod-secrets.env` |
| `ebay-mcp` | `.env` |
| `email-sender` | `.env` |
| `extension-studio` | `.env` |
| `extensions` | `.env`, `.dev.vars` |
| `fresh-squeezy` | `.env`, `.env.live.local`, `.env.test.local` |
| `genshot` | `.env`, `apps/operator/.env.local`, `apps/worker/.dev.vars` |
| `ib-bot` | `.env` |
| `jts-agency` | `.env` |
| `mobile-apps-monorepo` | `apps/booking/ios/.xcode.env` |
| `portfolio` | `server/.env` |
| `vybekiit` | `.env`, `apps/landing/.env.local`, `cli/.env`, `templates/backend/.env`, `templates/mobile/ios/.xcode.env` |
| `wedding-digital-invites` | `.env` |
| `zaatar-tech-main-repo` | `.env`, `apps/mypr/.env`, `apps/mypr/ios/.xcode.env`, `apps/poker/.env`, `apps/poker/ios/.xcode.env`, `apps/pomedero/.env`, `apps/pomedero/ios/.xcode.env`, `server/src/apps/mypr/.env.local`, `server/src/apps/pomedero/.env` |

The `ai-visibility/.dev.vars` path is a symlink to `.env`; the vault must preserve that link instead of replacing it with a second file.

Tracked examples and safe configuration files are outside this backup. Examples include `.env.example`, the tracked `launch-store` preview and production templates, `email-sender/.envrc`, and other files already recoverable from Git. Dependency folders, build output, deployment-platform state, and unrelated ignored files are also outside scope.

The encoder consumes this reviewed allowlist. It does not use a broad filename scan as authority, because a scan could silently add templates, caches, or newly generated files.

## Archive Layout

After extraction, the email attachment has this shape:

```text
mac-env-backup-2026-07-31/
├── README.txt
├── env-vault.mjs
├── manifest.json
└── vaults/
    ├── MYPR-App.env.vault
    ├── Oly-App.env.vault
    ├── ...
    ├── zaatar-tech-main-repo.env.vault
    └── _workspace.env.vault
```

`manifest.json` contains only non-secret archive metadata: format version, scope names, vault filenames, ciphertext byte sizes, and ciphertext SHA-256 digests. It does not contain environment paths, plaintext hashes, credentials, or passphrase material.

The ZIP itself is not password-protected. Its environment content is protected at the vault layer, so every copied or emailed ZIP contains only authenticated ciphertext. Repository names and the non-secret README remain visible.

## Cryptographic Format

SHA-256 is a one-way digest and cannot provide an encode/decode workflow by itself. The vault therefore uses authenticated encryption and uses SHA-256 only for integrity comparisons.

Each vault uses:

- AES-256-GCM for confidentiality and authenticated tamper detection;
- a 32-byte key derived from the vault passphrase with scrypt;
- scrypt parameters `N=262144`, `r=8`, `p=1`, and a 32-byte output key;
- a unique cryptographically random 16-byte salt;
- a unique cryptographically random 12-byte GCM nonce;
- a 16-byte GCM authentication tag;
- authenticated additional data binding the format name, version, scope kind, and exact scope directory name.

The scrypt implementation sets a 512 MiB memory ceiling so the configured work factor is accepted consistently by Node.js. These parameters are versioned in the envelope so a future decoder can retain compatibility.

The JSON vault envelope contains only the fields needed before decryption:

```text
format, version, scope, kdf parameters, salt, cipher, nonce, tag, ciphertext
```

Binary values use base64. Vault files use whitespace-free canonical JSON with lexicographically sorted object keys. After parsing, the decoder requires byte-for-byte equality with canonical reserialization; this rejects duplicate fields, alternate encodings, whitespace, and trailing data. It also rejects missing or unexpected fields, unsupported versions, malformed lengths, and unsafe scrypt parameters before attempting restoration.

## Encrypted Payload

The authenticated ciphertext decrypts to a versioned JSON payload containing:

- the scope kind and repository directory name;
- the creation timestamp;
- a sorted list of original entries;
- for each regular file: its relative POSIX path, mode, base64 bytes, byte length, and SHA-256 digest;
- for each symlink: its relative POSIX path, relative target, target byte length, and SHA-256 digest.

Hashes are calculated over exact file bytes or exact symlink-target bytes. They stay inside the ciphertext. The decoder verifies all lengths and hashes before writing any path.

No environment file is parsed, normalized, reserialized, trimmed, or newline-converted. Backup and restore operate on exact bytes.

## Passphrase Contract

Encoding requires an interactive TTY. For each scope, the tool:

1. shows only the non-secret repository name;
2. reads the passphrase without echoing it;
3. rejects an empty passphrase or one with fewer than 16 Unicode code points;
4. reads a hidden confirmation;
5. rejects a mismatch;
6. rejects a passphrase already used for another vault in the same run.

Reuse detection uses a process-local keyed fingerprint and is never written or printed. The tool does not trim or Unicode-normalize passphrases, so decoding uses the exact characters originally entered.

Decoding prompts once for the selected repository vault and never echoes the input. A wrong passphrase produces a repository-scoped authentication error without revealing file names or values.

The prompt implementation restores terminal echo and raw-mode state on success, rejection, interruption, and ordinary process errors. Non-interactive execution fails rather than reading a secret from an insecure fallback.

Passphrases should be unique password-manager-generated values. They must be stored separately from the email attachment. There is no backdoor or recovery file.

## Encode Flow

The maintained implementation is a local migration tool under Dufflebag's ignored `scripts/dev/` area. It uses only Node.js 20-or-newer built-ins. A copy becomes `env-vault.mjs` inside the archive, so the restore capability survives the Mac reset without becoming an application-repository feature.

Encoding proceeds as follows:

1. Load the reviewed inventory and validate that it contains exactly 42 unique normalized paths across the 19 expected scopes.
2. Resolve every scope against the selected `Code` directory and reject missing or unexpected repository roots.
3. Use `lstat` to distinguish regular files and symlinks. Reject directories, devices, sockets, absolute links, and links that escape their scope.
4. Record a source identity for every file, then read it once and confirm its device, inode, size, and modification time did not change during the read.
5. Prompt for and confirm a unique passphrase for the scope.
6. Build the payload in memory, encrypt it, and write only ciphertext through an exclusive temporary file with mode `0600` followed by an atomic rename.
7. Immediately decrypt the completed vault in memory and compare every byte hash, file mode, and symlink target with the live source.
8. Repeat for every scope. Any failure prevents creation of the final ZIP.
9. Write the non-secret manifest and README, then create the ZIP from the ciphertext staging directory.
10. Extract the finished ZIP into a fresh temporary directory, verify every manifest digest, decrypt each extracted vault using keys retained only in process memory, and compare all 42 entries with the live sources again.
11. Remove temporary archive staging, overwrite derived-key buffers on a best-effort basis, and print a redacted 42-of-42 summary plus the final ZIP SHA-256 digest.

The encoder never creates a plaintext staging copy. Process diagnostics include scope names, counts, and statuses only. They must not include environment paths, values, passphrases, plaintext hashes, decrypted payloads, or command invocations containing secrets.

The final archive is written outside the `Code` workspace at:

```text
/Users/yosefhayimsabag/Desktop/mac-env-backup-2026-07-31.zip
```

No partial ZIP is published. Interrupted or failed runs remove only their uniquely named ciphertext staging directory and leave all original environment files untouched.

## Decode Flow

The user first clones the repositories under a chosen `Code` directory, extracts the ZIP, and runs the included tool with Node.js 20 or newer.

```text
node env-vault.mjs decode --repo MYPR-App --code-dir /path/to/Code
node env-vault.mjs decode --all --code-dir /path/to/Code
```

`--repo` restores one independently recoverable scope. `--all` processes each vault separately and prints a redacted success or failure summary, allowing a missing clone or wrong passphrase for one repository to leave every other repository recoverable.

Before writing a repository, the decoder:

1. validates the manifest digest and vault envelope;
2. prompts invisibly for that repository's passphrase;
3. authenticates and decrypts the entire payload;
4. verifies the bound scope identity, entry count, byte lengths, and internal SHA-256 digests;
5. validates every destination and symlink target;
6. confirms the repository root exists and is contained by the selected `Code` directory;
7. inspects all destination conflicts.

Only after the full repository preflight succeeds may restoration begin. Regular files are written to exclusive sibling temporary files with mode `0600`, assigned their stored mode, and atomically renamed. Parent components are checked with `lstat`; a symlink parent is never followed. Stored symlinks are created only when their relative targets normalize inside the same scope.

An existing destination with identical bytes, mode, and link identity is reported as already restored. A differing destination is refused by default. `--force` is an explicit opt-in for replacement; the decoder retains the prior bytes and metadata in memory until the repository transaction completes so it can roll back a failed replacement.

If a write fails, the decoder removes paths created by that repository transaction and restores any explicitly replaced destination. It never removes a pre-existing path merely because another repository failed.

## Path-Safety Rules

Every payload entry must be a non-empty normalized relative POSIX path. The decoder rejects:

- absolute paths;
- empty, `.` or `..` components;
- NUL bytes;
- duplicate normalized paths;
- case-folding collisions;
- destinations outside the exact repository or workspace root;
- a symlink in any destination parent component;
- absolute symlink targets or normalized targets outside the same scope.

The scope name is resolved through the authenticated manifest rather than accepted as an arbitrary filesystem path. `_workspace` maps only to the selected `Code` root; repository scopes map to an exact direct child directory.

## Verification

Implementation starts with fake-value fixtures and Node's built-in test runner. Tests cover:

- byte-exact regular-file round trips;
- per-vault passphrases and reuse rejection;
- hidden-prompt cleanup on success and interruption;
- wrong-passphrase behavior;
- ciphertext, nonce, tag, manifest, and payload tampering;
- truncated and oversized envelopes;
- path traversal, symlink escape, symlink-parent pivots, and case collisions;
- regular-file modes and relative symlink preservation;
- overwrite refusal, identical-file skipping, explicit replacement, and rollback;
- workspace-root restoration;
- missing-repository isolation during `--all`;
- redacted errors and summaries;
- rejection of passphrases from arguments, environment variables, or non-TTY input;
- ZIP extraction and manifest-digest verification.

Fixtures contain synthetic credentials only. Tests and diagnostics never snapshot or print real environment content.

The final proof uses the real audited inventory without disclosing values. It must report:

- 19 of 19 vaults created and authenticated;
- 42 of 42 source entries matched after decrypting the extracted ZIP;
- exact regular-file byte hashes and modes matched internally;
- exact symlink targets matched internally;
- zero plaintext environment files added to Git;
- zero ciphertext vaults added to Git;
- final ZIP location, byte size, and SHA-256 digest.

The proof fails closed. A count mismatch, changed source, authentication failure, restore mismatch, secret-bearing diagnostic, or Git inclusion prevents a completion claim.

## Email and Recovery Contract

The tool creates the ZIP locally; it does not send email. The user attaches the single ZIP to an email addressed to themselves. The passphrases must not appear in that email thread or in the same attachment.

The email provider will retain a copy of the encrypted archive. Security therefore depends on the independent passphrases remaining strong and separate. Compromise or loss of one passphrase affects only its matching vault.

After downloading on the new Mac, the user can compare the archive's SHA-256 digest with the value reported at creation. AES-GCM authentication and the internal digests remain the authoritative per-vault tamper and restore checks.

## Git Boundaries

- Commit this design document to the private Dufflebag repository as the migration contract.
- Keep the local implementation and real inventory under ignored `scripts/dev/` paths during construction.
- Do not stage plaintext env files, the inventory, generated vaults, the staging directory, or the final ZIP.
- Do not add encode/decode scripts to all repositories.
- Do not bypass application-repository secret protections because no backup artifact belongs in those repositories.
- Do not change application branches, deployment branches, GitHub visibility, environment schemas, or deployment-provider secrets.

## Alternatives Rejected

- **SHA-256-only encoding:** a digest is irreversible, so it cannot restore environment values.
- **One shared archive passphrase:** fewer prompts, but one leak exposes every repository and violates the separate-passphrase requirement.
- **One email attachment per repository:** independent, but easier to omit, scatter, or lose than one manifest-backed ZIP.
- **Ciphertext committed to private repositories:** technically possible, but spreads permanent secret-bearing artifacts across Git history and creates public/private classification risk.
- **A copy of the passphrases or recovery codes in the ZIP:** convenient, but removes meaningful protection if the email account is compromised.
- **Broad automatic env discovery:** convenient, but can include examples, caches, generated backups, or future files that were never reviewed.

## Out of Scope

- Automatically sending the email.
- Cloning repositories on the new Mac.
- Backing up non-environment ignored files.
- Exporting secrets held only by GitHub, Cloudflare, Vercel, Apple, or other providers.
- Rotating or regenerating credentials.
- Changing application configuration contracts.
- Making the archive decryptable without its repository-specific passphrases.
