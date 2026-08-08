# RULESET.md — emit the machine mirror of CODE-STYLE.md ("biome config, as a skill")

`CODE-STYLE.md` is the human prose. `code-style.rules.json` (beside it) is its **machine
mirror**: every rule as an object declaring the exact command that proves it. This is what
makes review deterministic across hundreds of changed files — the reviewer walks *every* rule
by its command, not just the `## Never` list. Emit it in Step 8, right after the formatter/
linter config, and generate the artifacts each rule points to.

Schema and slot rules: [CODE-STYLE-FORMAT.md](CODE-STYLE-FORMAT.md). Exemplar to
copy: this package’s root `code-style.rules.json` (scaffold:
`templates/mdFiles/code-style.rules.json`).

```json
{ "id": "function.arrow-only", "statement": "…one sentence…", "verify": "pnpm style" }
```

`statement` is byte-identical to the card's assertion; `verify` is byte-identical to the card's
command, or `judgment`. A linter enforces both — see the format spec.

## Pick the cheapest real command

Classify **each** rule by the cheapest mechanism that actually catches it, then record *that
mechanism's command* as `verify`. Prefer left over right — deterministic Biome over AI judgment:

| Mechanism | When | Artifact it generates | `verify` becomes |
|---|---|---|---|
| Biome **recommended** rule | already catches it | nothing — runs in `biome ci` | `biome ci .` |
| Biome rule, path-scoped | a Biome rule for a path subset | a `biome.json` **`overrides[]`** entry (`includes` + the rule) | `biome ci .` |
| `noRestrictedImports` | a path/dependency **boundary** (layer X can't import Y) | `noRestrictedImports` inside an `overrides[]` entry | `biome ci .` |
| GritQL plugin | a **custom**, call/expression-shaped rule Biome lacks | `biome-rules/<id>.grit`, listed in `biome.json` `plugins` | `biome ci .` |
| Repo AST checker | a shape GritQL cannot match (declarations, import graphs, paths) | a script like dufflebag's `scripts/checkCodeStyle.ts` | that script's script name, e.g. `pnpm style` |
| — | taste/architecture with no honest detector | nothing mechanical — review sub-agents + `deslop`/`deslop-v2` | `judgment` |

## How to decide (run this, don't guess)

1. **Does `recommended` already flag it?** Write a 3-line fixture and run `biome lint` — if it
   fires, you are done. (Verified: `no-any` → `noExplicitAny`; `node:` prefix →
   `useNodejsImportProtocol`.)
2. **Is it path-scoped?** → `overrides` (e.g. `noConsole` only in the CLI dirs; a harness stays
   exempt by omission).
3. **Is it an import/dep boundary?** → `noRestrictedImports`.
4. **Custom + call/expression shaped?** (a call, member access, `x as T` cast, `.only(`) → write
   a `.grit` plugin.
5. **Declaration- or graph-shaped?** (`enum`, `interface`, import graphs, file paths) → a repo
   AST checker, and point `verify` at its script.
6. **Everything else** → `judgment`. Be honest here — a fake detector is worse than none.

## Hard-won GritQL facts (Biome 2.5, plugins are beta)

- **Works:** call / member / cast patterns — `` `$c.forEach($...)` ``, `` `console.$m($...)` ``,
  `` `$e as any` ``, `` `$s.only($...)` ``. Bind the node with `as $x`, then
  `register_diagnostic(span = $x, message = "…", severity = "error")`; add a `=> rewrite`
  with `fix_kind = "safe"` for autofix.
- **Does NOT work yet:** matching **declarations** like `enum $n { … }` — no pattern form
  matched in 2.5. Such rules need a repo AST checker (step 5), not `judgment`, if you want them
  gated. Say which in the rule's `verify`.
- **Plugin scoping is unreliable:** the `{ "path": …, "includes": … }` plugin form did **not**
  scope in 2.5 (nothing fired). For anything path-scoped use **`overrides`** with a builtin
  rule, not a scoped plugin. Keep `.grit` plugins repo-wide.

## Generate the artifacts (Step 8)

- Biome builtin → confirm it is on (it is, via `recommended`); nothing to write.
- Path-scoped / restricted-import → add an `overrides[]` entry to `biome.json`. Keep
  `biome.json` **strict JSON — no comments** (a stray `//` silently makes Biome scan `dist/`).
- GritQL → write `biome-rules/<id>.grit`, add its path to `plugins`.
- Repo AST checker → add the detector and a script that runs it over the tree, so the `verify`
  command is real and runnable.
- `judgment` → nothing; the review skill reads these from the ruleset.

**Then prove it, don't assume:** every new rule must **catch a planted violation** (drop a temp
fixture in the right dir, run the command, delete it), and must not redden the gate unexpectedly
— if the existing tree already violates it, either fix the tree or keep the command out of
`verify`'s gate and say so plainly in the guide. A rule that never fires is not shipped.

## The plan (Step 7) and the digest

- In the planpage plan, show each rule's `verify` command beside its `PickBlock`, and the
  generated `overrides`/`plugins` diff for `biome.json` in the "review the exact writes" block.
- `code-style.rules.json` is the SSOT the **`grill-me-code-style-coach`** (build-time) and
  **`grill-me-code-style-review`** (diff-time) skills consume — point the AGENTS.md digest at it.
