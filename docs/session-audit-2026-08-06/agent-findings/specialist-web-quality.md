# Specialist: web quality (perf + a11y + best practices)

Scope: refined intents `web_best_practices`, `web_perf`; skills `webBestPractices`, `webPerfCi`; job-like examples.

## Verdicts

| Intent | n (prompts / sessions) | Skill | Refined rec | Specialist rec |
| --- | ---: | --- | --- | --- |
| `web_best_practices` | 28 / 22 | `webBestPractices` | improve | **leave** skill body; **tighten triggers only** (optional) |
| `web_perf` | 1 / 1 | `webPerfCi` | leave | **leave** |

No new skill. No merge of the two skills (already hand-off: glance perf vs CI CWV gates).

## Why `web_best_practices` count is misleading

Refined examples are almost all **phrase collisions on “best practices”**, not web-platform audits:

| Example class | Real job | Route |
| --- | --- | --- |
| “next.js best practices” / “best practices structure for next.js” / “i18n … next.js structure” | App Router layout, folder names, route wrappers | **Not** web-quality skills |
| “best practices of effect” | Effect-TS idioms / lean code | library / code-style, not a11y/SEO |
| “code style.md … best practices for this kind of repo” | repo structure + CODE-STYLE | `grillMe*` / code-style family |
| e2e “best practices” + `publicAccessibility.spec` paths | test engineering in MYPR | Playwright/helpers, not site audit |
| `features/accessibility/**` in deslop/mapper jobs | product feature folder | domain cleanup, not WCAG |

True `webBestPractices` work (semantic HTML, ARIA, CSP/HSTS, SEO meta, JSON-LD, `llms.txt`, image/font CLS fixes) barely appears as freeform user jobs in this audit window. Coarse bucket `web_perf_a11y` (47) was the same noisy keyword net before split.

## Freeform “next.js best practices”

**Do not route here.** That string means framework conventions (structure, i18n folder names, unified route wrappers, avoid repeated try/catch)—not the seven-dimension site audit.

Route to web skills only when the user also signals platform quality: accessibility/a11y, semantic HTML, CSP/security headers, SEO/meta/OG, schema.org/JSON-LD, llms.txt/agent-ready, Core Web Vitals/Lighthouse/LCP/INP/CLS, or “audit this site.”

## Skill fit (as written)

- **`webBestPractices`**: solid audit+fix workflow + scanner; description already lists good positive triggers and defers CWV CI to `web-perf-ci`. Gap is not content—it’s false-positive invocation if agents match on bare “best practices” / “Next best practices.”
- **`webPerfCi`**: CI lab (LHCI) + field (CrUX) + optional RUM. Single session prompt (“lighthouse … flaky css leak / clean cache”) is **ad-hoc FOUC debugging**, not “wire perf gates.” Skill sufficient; leave.

## Optional trigger tweak (only if misfires observed)

In `webBestPractices` description frontmatter, add explicit **negative** triggers:

- do **not** use for framework folder structure, “Next.js best practices” alone, Effect/library idioms, CODE-STYLE audits, or e2e-spec hygiene;
- keep positives: a11y, CSP, SEO, schema.org, llms.txt, semantic HTML, agent-ready.

Do **not** broaden skill to cover Next app structure—that would dilute the audit tool and steal traffic from grill/stack skills.

## Action

1. **`webPerfCi`**: leave.
2. **`webBestPractices`**: leave workflow/scripts; optional negative-trigger line only.
3. Rebucket future audits: bare “best practices” ≠ web quality; require platform signals above.
