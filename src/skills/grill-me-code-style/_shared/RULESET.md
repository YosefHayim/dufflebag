# RULESET.md — emit the machine mirror of CODE-STYLE.md ("biome config, as a skill")

`CODE-STYLE.md` is the human prose. `code-style.rules.json` (beside it) is its **machine
mirror**: every rule as an object that declares **how it is enforced**. This is what makes
the review deterministic across hundreds of changed files — the reviewer walks *every* rule
by its channel, not just the `## Never` list. Emit it in Step 8, right after the formatter/
linter config, and generate the Biome artifacts each rule points to.

Exemplar to copy: `templates/mdFiles/code-style.rules.json` in dufflebag.

## The four enforcement channels

Classify **each** rule into the cheapest channel that actually catches it. Prefer left over
right — deterministic Biome over AI judgment:

| Channel | When | Artifact it generates |
|---|---|---|
| `biome-builtin` | a Biome **recommended** rule already catches it | nothing — it already runs in `biome ci` |
| `biome-builtin-scoped` | a Biome rule, but only for a path subset | a `biome.json` **`overrides[]`** entry (`includes` + the rule) |
| `biome-restricted-import` | a path/dependency **boundary** (layer X can't import Y) | `noRestrictedImports` inside an `overrides[]` entry |
| `biome-grit-plugin` | a **custom** rule Biome lacks, **call/expression shaped** | a `biome-rules/<id>.grit` GritQL file, listed in `biome.json` `plugins` |
| `judgment` | taste/architecture, **or** a shape GritQL can't match yet | nothing mechanical — the review sub-agents + `deslop`/`deslop-v2` per-diff |

## How to decide the channel (run this, don't guess)

1. **Does `recommended` already flag it?** Write a 3-line fixture and run
   `biome lint` — if it fires, it's `biome-builtin`. (Verified: `no-any` →
   `noExplicitAny`; `node:` prefix → `useNodejsImportProtocol`.)
2. **Is it path-scoped?** → `biome-builtin-scoped` via `overrides` (e.g. `noConsole` only
   in the CLI dirs; the harness stays exempt by omission).
3. **Is it an import/dep boundary?** → `biome-restricted-import` (`noRestrictedImports`).
4. **Custom + call/expression shaped?** (a call, member access, `x as T` cast, `.only(`) →
   write a `.grit` plugin. GritQL handles these well.
5. **Everything else** → `judgment`. Be honest here — a fake detector is worse than none.

## Hard-won GritQL facts (Biome 2.5, plugins are beta)

- **Works:** call / member / cast patterns — `` `$c.forEach($...)` ``, `` `console.$m($...)` ``,
  `` `$e as any` ``, `` `$s.only($...)` ``. Bind the node with `as $x`, then
  `register_diagnostic(span = $x, message = "…", severity = "error")`; add a `=> rewrite`
  with `fix_kind = "safe"` for autofix.
- **Does NOT work yet:** matching **declarations** like `enum $n { … }` — no pattern form
  matched in 2.5. Rules like "prefer a union over `enum`" fall to `judgment` until Biome adds
  declaration matching. Say so in the rule's `artifact`.
- **Plugin scoping is unreliable:** the `{ "path": …, "includes": … }` plugin form did **not**
  scope in 2.5 (nothing fired). For anything path-scoped use **`overrides`** with a builtin
  rule, not a scoped plugin. Keep `.grit` plugins repo-wide.

## Generate the artifacts (Step 8)

For each rule, materialize its `artifact`:

- `biome-builtin` → confirm it's on (it is, via `recommended`); nothing to write.
- `biome-builtin-scoped` / `biome-restricted-import` → add an `overrides[]` entry to
  `biome.json`. Keep `biome.json` **strict JSON — no comments** (a stray `//` silently makes
  Biome scan `dist/`).
- `biome-grit-plugin` → write `biome-rules/<id>.grit`, add its path to `plugins`.
- `judgment` → nothing; the review skill reads these from the ruleset.

**Then prove it, don't assume:** every new rule must have **zero violations in the existing
tree** (grep first) so the gate stays green, and must **catch a planted violation** (drop a
temp fixture in the right dir, `biome lint` it, delete it). Run the repo's `verify` gate — it
must stay green. A rule that reddens the existing build or never fires is not shipped.

## The plan (Step 7) and the digest

- In the planpage plan, add each rule's **channel** beside its `PickBlock`, and show the
  generated `overrides`/`plugins` diff for `biome.json` in the "review the exact writes" block.
- The `code-style.rules.json` is the SSOT the **`grill-me-code-style-coach`** (build-time) and
  **`grill-me-code-style-review`** (diff-time) skills consume — point AGENTS.md's digest at it.
