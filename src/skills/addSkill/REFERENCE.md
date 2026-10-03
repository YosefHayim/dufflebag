# Add skill — reference

## Question bank

Ask only what the description and exploration left open. Offer concrete options with a recommendation, not open-ended prompts.

| Topic | Question | Lands in |
|---|---|---|
| Triggers | What would you say to start it? Give 2–3 phrases. | description `Say "…"` |
| Hand-offs | What is close to this but belongs to another skill? | description "For X, use Y" |
| Input | What does it start from — a repo, a file, a URL, a past session, nothing? | Workflow step 1 |
| Done | What exists when it is finished — a file, a PR, a report, a running app? | Verification |
| Never | What must it never do without asking — work on main, deploy, delete, merge, spend money, message people, touch secrets? | Safety |
| Questions | Does it ask questions as it goes, or run alone after one approval? | Workflow gates |
| Edits | Does it change files, or only advise? | Safety, Workflow |
| Scope | One file, one feature, a whole repo, or many repos? | Workflow |
| Platform | Any OS, macOS only, or macOS + Ghostty? | catalog `platform` |
| Extra files | Does it need scripts, templates, or reference docs next to `SKILL.md`? | catalog `shippedPaths` |
| Siblings | Which existing skills does it use or hand off to? | catalog `dependencies`, Workflow |
| Proof | How will we both know it worked? | Verification |
| Name | Offer 2–3 ids: plain verb + noun, kebab-case, like `add-mcp-server`. | `id`, `name` |

## Proposal

Fill this in and show it before writing anything.

```markdown
## Proposed skill: <id>

| Field | Value |
|---|---|
| id / `name` | <kebab-case> |
| sourceDirectory | src/skills/<camelCase>/ |
| title | <Title case, 2–4 words> |
| summary | <one sentence for the README table> |
| type | flow (repeated workflow with gates) or none (short instruction) |
| shippedPaths | SKILL.md[, REFERENCE.md, scripts, templates] |
| dependencies | <catalog ids it needs installed, or none> |
| platform | any / macos / macos+ghostty |

**Description:** Use when you want … It … Say "…", "…", or "…". For …, use <sibling>.

**Safety**
- …

**Workflow**
1. …

**Verification** — the report lists: …

**Example run**
You say: "…" → it asks: … → it produces: …
```

## Choosing `type`

- `type: flow` — a repeated workflow with steps and gates; most skills. The description must start with `Use when `, the body needs `## Safety`, `## Workflow`, and `## Verification`, and the file stays at 500 lines or fewer. `src/skills/skills.test.ts` enforces all of it.
- No `type` — a short instruction such as `src/skills/questionMyPlan/SKILL.md`.

Both need a `name` equal to the catalog id (lowercase letters, digits, hyphens; 64 characters at most) and a `description` of 1024 characters at most.

## Registration checklist

All paths are in the dufflebag repo. Put the new skill next to related skills and use the same position in every list.

1. **Skill files** — `src/skills/<sourceDirectory>/SKILL.md`, plus every extra file the proposal named. Mirror `src/skills/githubRepoAbout/` for a one-file skill.
2. **Catalog** — one entry in `src/catalog/featureCatalog.ts`:

   ```ts
   skillFeature({
     id: "<id>",
     sourceDirectory: "<sourceDirectory>",
     title: "<title>",
     summary: "<summary>",
     shippedPaths: ["SKILL.md"],
     // dependencies: ["<sibling-id>"],   only when it needs a sibling installed
     // platform: "macos",                 only when not "any"
   }),
   ```

3. **Catalog tests** — `src/catalog/featureCatalog.test.ts` has three lists in catalog order: `expectedFeatureIds` (add `"<id>"`), `expectedSourceDirectories` (add `"<sourceDirectory>"`), and the shipped-paths list in "derives defaults, installed skills, and exact shipped allowlists" (add `["<id>", [<shippedPaths>]]`).
4. **Routing** — a row in the fitting table of `src/skills/whichSkill/REFERENCE.md`: the user's phrases → `` `<id>` ``.
5. **Siblings** — when the new skill takes work from a sibling, add "For …, use <id>." to that sibling's description.
6. **README** — run `pnpm generate-readme`. Never edit the generated sections by hand.

## Install

Explicit feature IDs replace the installed selection, so always pass what is already installed plus the new id. Run from the dufflebag repo after `pnpm verify` (it builds `dist/`, which the hooks install from):

```bash
receipt=~/.claude/dufflebag/receipt.json
if [ -f "$receipt" ]; then
  pnpm cli install $(node -p "require('$receipt').features.join(' ')") <id>
else
  pnpm cli install <id>
fi
ls ~/.claude/skills/<id>/SKILL.md
```

For a project install, add `--scope project` and use `.claude/dufflebag/receipt.json` in the repo.
