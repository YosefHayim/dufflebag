# Specialist: GRILL + DESLOP + CODE-STYLE

**Scope:** `code_style_docs` (98 prompts / 96 sessions), `deslop` (53/53), `grill_me_family` (45/45).  
**Skills:** `grillMeCodeStyleWithDocs`, `grillMeCodeStyle`, coach, review, `deslop`, `deslopV2` (+ `grillMe`, `grillWithDocs`, `grillMeStack`).  
**Verdict:** **improve** the grill family (do not create, do not merge body into deslop, do not leave).

## Evidence

| Pattern | Count / notes |
|--------|----------------|
| Exact cluster: `$grill-me-code-` **line-broken** + “full deslop on entire repo” + ban `result/payload/data/raw` | **20** unique sessions (top exact cluster) |
| Full `<skill>…grill-me-code-style-with-docs…</skill>` body paste | **16** sessions (Codex) |
| “proper cleanup and `$grill-me-code-style-with-docs`” + CODE-STYLE + ban generics | **4+** |
| “leaner and tighten `$grill-me-code-style-with-docs`” | **4** |
| Freeform: “huge deslop… maybe new **gridme**… code styles, structure…” | **5** (voice: gridme = grill-me) |
| Freeform deslop without skill name (structure / 0 AI slop / ban payload) | many in `deslop` bucket |

Dominant job (spoken): **define style + structure via grill, then mass-clean the repo** (deslop / deslop-v2). User already treats them as one mission; skills split define vs apply (correct product design, weak routing).

## Diagnosis

1. **Trigger is too long for voice**  
   Canonical slug `$grill-me-code-style-with-docs` wraps mid-token (`$grill-me-code-\n  style-with-docs`). Dictation produces `gridme`, `preform`, `thigtehn`. Frontmatter description does not list short aliases or these freeform phrases.

2. **Skill paste = invocation failure mode**  
   16 pastes of entire SKILL.md body imply agents/harnesses often need the full doc, or user does not trust `$name` alone. Prefer auto-load + short alias over paste.

3. **Combo job not first-class**  
   Top prompt is always “grill **from the beginning** so we can do a **full deslop**…”. Today: long multi-step grill (Steps 1–9) then separate deslop/deslop-v2. No explicit “grill → planpage approve → ceremony kill + readability apply” fast path in description or Step 0.

4. **Family is wide but sessions only use one star**  
   Live traffic = **with-docs** (+ freeform deslop). Coach/review appear as skill-body pastes, not organic jobs. Greenfield `grill-me-code-style` almost unused vs with-docs. Cross-links in deslop/deslop-v2 → grill already good; reverse handoff weak.

5. **Not a missing skill**  
   Body quality is strong (scan, Round 7, ceremony kill list, planpage, golden path). Pain is **entry, aliases, combo routing, completion criteria** (“when is full-repo deslop done?”).

## Per-skill recommendations

| Skill | Rec | Why |
|-------|-----|-----|
| **grillMeCodeStyleWithDocs** | **improve** | Primary; fix triggers + combo handoff |
| **grillMeCodeStyle** | **leave** | Greenfield gate; low session volume |
| **grillMeCodeStyleCoach / Review** | **leave** | Distinct lifecycle; no merge |
| **deslop** | **improve** | Freeform “0 ai slop / ban payload / cleanup repo” → auto; if no CODE-STYLE, offer grill first |
| **deslopV2** | **improve** | Same freeform + “full deslop / leaner / ceremony / kill wrappers”; post-grill default apply |
| **grillMe / grillWithDocs / grillMeStack** | **leave** | Adjacent; don’t fold into code-style |

**Do not merge** grill into deslop (define ≠ apply). **Do not create** a new mega-skill; add a **named combo mode** on with-docs.

## Concrete improvements (priority)

1. **Voice-friendly aliases** in description + any slash registry:  
   `$grill`, `$grill-style`, `$style-docs`, `$grill-docs`, typos `gridme` / `grill me code style`. Match broken `$grill-me-code-` + `style-with-docs`.
2. **Freeform entry phrases** (same job as top cluster):  
   “full deslop on this entire repo”, “from the beginning… code style”, “0 ai slop”, “ban result/payload/data”, “leaner structure + code-style.md”, “proper cleanup and code style”.
3. **Combo mode** when grill + deslop co-occur:  
   After planpage approval of CODE-STYLE/`## Never`/ceremony kill list → **auto-queue** deslop-v2 (ceremony first) then deslop (naming/readability) on approved scope; state stop conditions (public API, missing tests).
4. **Shorter path option**: “refresh vs full grill” on re-run; skip structure-doc deep dive when PROJECT/CONTEXT/LANGUAGE already `validate ✓`.
5. **Completion criteria** in with-docs: files written, AGENTS digest, kill list applied or deferred with checkbox TODO — so “full deslop” sessions don’t restart 20×.
6. **deslop / deslop-v2 description**: add “full repo deslop”, “structure cleanup”, “generic variable names”, and “if no CODE-STYLE.md, start grill-me-code-style-with-docs”.

## Out of scope / non-goals

- Merging coach/review into with-docs  
- Replacing deslop-v2 line/structure/ceremony catalogs  
- New skill for “gridme” alone  

## Bottom line

**Improve, don’t create or merge.** The skill exists and is used by name ~20+ times; friction is voice-hostile slug, paste-as-invocation, and missing grill→deslop combo path for the user’s actual repeated job.
