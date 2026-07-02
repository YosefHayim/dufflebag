---
name: planpage
description: Render a skill's plan, review gate, or report as a beautiful, self-contained, INTERACTIVE HTML page — via the open-source planpage package (Preact components → static HTML + a local post-back server so the user can approve / adjust / flip decisions in the browser and the choice comes straight back to the agent). Use whenever a skill needs an approval gate, a decision review, or a shareable before/after report — author with the kit's components instead of hand-rolling HTML each time.
---

# planpage — interactive HTML plans for skills

Like `mcp-ui`, but for terminal skills. This skill is a **thin consumer of the open-source [`planpage`](https://github.com/YosefHayim/planpage) package** (on npm — `npm i planpage`, or zero-install with `npx planpage`). The components, the render engine, the auto-captured gallery, and the post-back server all live there as the single source of truth. Don't hand-roll HTML here; author with the package.

## What the package gives you

- **Components** — `SectionCard`, `PickBlock`, `DiffBlock`, `TreePanel`, `Flow`, `CodeBlock`, plus plan-native pieces: `Callout`, `RiskList`, `Steps`, `Timeline`, `OptionCompare`, `PlanSummary`, `Accordion`, `AnnotatedCode`. Browse them live: `npx planpage library --open`.
- **Templates** — `plan-brief` (a whole agent plan on one page), `before-after`, `code-style-plan`, `library`.
- **`render()`** — `render(<Template {...data} />)` → a self-contained HTML string (Tailwind + Mermaid from CDN, light/dark theme).
- **`serve`** — a never-hang post-back server (OS-assigned ephemeral port 49152+, idle timeout, `file://` + clipboard fallback) that collects one `Decision`.

## Quick start (how a skill uses it)

1. **Assemble** the page from the package's components (or a whole template):
   ```tsx
   import { render, PlanBrief } from "planpage";
   const html = render(<PlanBrief title="…" steps={/* … */} risks={/* … */} />);
   ```
   or straight from the CLI: `npx planpage render plan-brief --data plan.json`.
2. **Write** it to the OS temp dir (`$TMPDIR/<name>-<timestamp>.html`) — nothing lands in the repo.
3. **Serve + collect** the decision on a safe ephemeral port:
   ```bash
   npx planpage serve <html-path> <decision-out.json> --timeout 600
   ```
   It prints the local URL, opens the browser, and blocks until the user clicks **Approve** / **Adjust** (or the idle timeout fires), then writes the decision JSON and exits `0`.
4. **Read** `<decision-out.json>` and act on it.

**Fallback — never hang.** Headless / no Node / port blocked → `open` the file directly (`file://`); the page's **Copy decision** button puts the same JSON (base64) on the clipboard to paste back. A non-TTY caller always has a decision path.

## The decision contract

The page posts one JSON object; the server writes it verbatim to the out-path:

```json
{ "approved": true, "flips": ["rule.function-form"], "revisit": ["rule.error-shape"], "notes": "keep classes only in the DB layer" }
```

- **`approved`** — Approve (`true`) vs Adjust (`false`).
- **`flips`** — `data-id`s of `PickBlock`s the user flipped (chosen ↔ rejected). Re-open the grill on these.
- **`revisit`** — `data-id`s marked "revisit" without a firm decision.
- **`notes`** — free text from the notes box.

Every interactive component carries a stable `data-id`; that id is what appears in `flips` / `revisit`. Name ids meaningfully (`rule.error-shape`, `move.orders-dir`) so a bare id tells you what to re-open.

## Rules

- **The package owns the HTML; the skill owns the content.** Reference `planpage` and plug in content — don't re-derive the shell. When a report needs a new widget, add it to the package (with a gallery entry) so every skill inherits it.
- **Self-contained + CDN-only.** No repo assets, no build step at render time; Tailwind + Mermaid from CDN.
- **Never block a script.** `serve` carries an idle timeout; the fallback is copy-paste. A headless / non-TTY caller must still reach a decision.
- **Installing the package adds no skills.** `npx planpage init` scaffolds one ready `render-plan` skill (wired to `npx planpage`) into `.claude/skills/` — ship that to end users; the package itself is just the engine.
