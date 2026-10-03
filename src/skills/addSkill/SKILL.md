---
name: add-skill
description: Use when you want a new skill and can describe it. It asks you questions until the skill is clear, shows what it will do and its steps for you to approve, then adds it to dufflebag, runs the checks, and installs it. Say "add a skill", "new skill", or "make a skill that…". To fix a skill, use improve-skill. To reuse what we just did, use save-as-skill.
type: flow
---

# Add skill

Turn a description into a working, installed skill. The user describes it; you ask until it is clear, propose the whole skill, and write nothing until the user says yes.

## Safety

- Write no files, create no branch, and run no install until the user approves the proposal in step 5. Reading and exploring are fine.
- Do not add a skill that repeats an existing one. When an existing skill covers most of the request, recommend `improve-skill` instead.
- Work on a topic branch `feat/<id>`, never on main or the default branch.
- Never put secrets, tokens, account IDs, absolute home paths, or customer data in a skill.
- Give the new skill its own gates: a skill that deploys, deletes, merges, sends messages, or spends money must ask first in its Safety section.
- Never run `dufflebag install <id>` alone over an existing install: explicit IDs replace the installed selection and remove every other feature. Use the install command in [REFERENCE.md → Install](REFERENCE.md#install).
- Commit, push, and open a PR only when the user asks, through `finish-and-push`.

## Workflow

### 1. Capture

Quote the user's description word for word. In the dufflebag repo (`src/catalog/featureCatalog.ts` exists) follow every step; anywhere else follow [Outside dufflebag](#outside-dufflebag).

### 2. Check for overlap

Read the frontmatter `description` of every skill (`src/skills/*/SKILL.md` in dufflebag, the installed skills under `~/.claude/skills/` elsewhere).

- One skill already covers most of the request → name it and what is missing, recommend `improve-skill`, and stop unless the user still wants a new skill.
- Two skills each cover a part → name both and the gap; the new skill covers only the gap and hands off to them.

### 3. Explore before asking

Answer from the repo and docs whatever can be answered there: sibling skills to hand off to, how nearby skills are written, the tools the new skill will use and their official docs. Do not ask the user what you can look up.

### 4. Interview

Ask every question from [REFERENCE.md → Question bank](REFERENCE.md#question-bank) that the description and exploration did not settle. A vague skill needs many questions; a precise one may need few. Either way:

- Put them in the fewest `AskUserQuestion` cards (4 questions per card); never one question per turn.
- Recommended option first, marked `(Recommended)`, with the reason in its description.
- A follow-up card only for questions that could not exist until earlier answers landed.
- With no question tool, send one numbered list in a single message.

### 5. Propose and wait

Show the whole skill before writing anything, filled in from [REFERENCE.md → Proposal](REFERENCE.md#proposal): catalog fields, description, triggers and hand-offs, Safety bullets, numbered Workflow steps, the Verification report, and one example run.

Then stop. On changes, revise and show the proposal again. Continue only on a clear yes.

### 6. Write

Create branch `feat/<id>` from the default branch, then follow [REFERENCE.md → Registration checklist](REFERENCE.md#registration-checklist): the skill files, the catalog entry, the catalog test lists, the `which-skill` routing row, sibling "For X, use <id>" lines, and `pnpm generate-readme`.

### 7. Check

Run `pnpm vitest run src/skills/skills.test.ts src/catalog/featureCatalog.test.ts`, then `pnpm verify`. Fix and re-run until both pass. Never skip or weaken a check to make it pass.

### 8. Install and try it

Install with the command in [REFERENCE.md → Install](REFERENCE.md#install) and confirm `~/.claude/skills/<id>/SKILL.md` exists. Tell the user to start a new session so the agent loads it.

Then test 3–5 of the user's own phrases against the new description and its closest siblings: would each phrase load this skill, and not a sibling? Fix the description when one would not.

### Outside dufflebag

Run steps 1–5 the same way; in the step 4 card also ask where it lives: `.claude/skills/<id>/` (this project) or `~/.claude/skills/<id>/` (every project). On a yes, write `SKILL.md` and any extra files there, and skip the catalog, tests, README, and install.

## Verification

Report:

- skill id, source path, and branch;
- the approved proposal and any change made after approval;
- files changed;
- the two test commands and `pnpm verify`, with results;
- the install path, and each tried phrase → which skill it loads;
- one sentence the user can say to try the skill now.

The skill is not done until the checks pass and the installed `SKILL.md` exists.
