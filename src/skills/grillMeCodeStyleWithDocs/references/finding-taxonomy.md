# Finding taxonomy (audit mode)

Use these IDs and severities so mechanical reports stay comparable across repos.

## Severity

| Level | Meaning |
| --- | --- |
| `critical` | Instruction system broken (no CODE-STYLE in a style-led repo) |
| `high` | Clear documented rule violated with strong mechanical evidence |
| `medium` | Default house rules (generic names, vague mappers) |
| `low` | Smell / drift worth noting |
| `info` | Map-only observation |

## Confidence

| Value | Meaning |
| --- | --- |
| `mechanical` | Regex / path rule matched user-defined code |
| `judgment` | Agent interpretation of intent — not machine-certain |
| `doc-stated` | Explicit statement in a project doc |

## Rule families

### `docs.*`

- `docs.missing` — expected instruction file not found
- `docs.contradiction` — parent vs nested instruction conflict
- `docs.orphan-rule` — rule in JSON with no CODE-STYLE card (or reverse)
- `docs.stale-path` — doc names paths that do not exist

### `naming.*`

- `naming.no-generic-local` — banned user-defined locals/params
- `naming.no-vague-mapper` — `to*` / `build*` / `resolve*` pure re-shape layers
- `naming.domain-miss` — judgment: name does not name the business concept

### `structure.*`

- `structure.shallow-passthrough` — file only re-exports or forwards
- `structure.cross-slice-import` — feature internals imported across boundary
- `structure.wrong-role-dir` — module not under role-owned directory

## Suppressions

Allow only when CODE-STYLE documents the exemption, the symbol is framework/stdlib API surface, or the user scoped the audit away from that path.
