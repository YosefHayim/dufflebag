---
name: skill-ui
description: Render a skill's plan, review gate, or report as a beautiful, self-contained, INTERACTIVE HTML page — a reusable component kit (plan shell, section cards, before→after diffs, ✓/✗ pick blocks, ASCII-tree panels, Mermaid flows, code blocks) plus a local post-back server so the user can approve / adjust / flip decisions in the browser and the choice comes straight back to the agent. Use whenever a skill needs an approval gate, a decision review, or a shareable before/after report — instead of hand-rolling HTML each time.
---

# skill-ui — an interactive HTML kit for skills

Like `mcp-ui`, but for terminal skills. A drop-in kit so any skill renders a polished, **interactive** review page — the user approves, adjusts, or flips individual decisions in the browser and the verdict comes back to you as JSON — without reinventing the HTML/CSS/JS every time.

Two pieces:
- **[COMPONENTS.md](COMPONENTS.md)** — the copy-paste HTML component library (the "plug and display" templates) + the theme + the wired submit script.
- **[scripts/serve-plan.mjs](scripts/serve-plan.mjs)** — a zero-dependency Node server that serves the page, opens the browser, blocks until the user submits once, writes the decision JSON, and exits.

## Quick start (how a skill uses it)

1. **Assemble** the page from COMPONENTS.md — nest your content into `plan-shell`, keep the theme and the `submit-bar`. Give every decision an interactive `pick-block` with a stable `data-id`.
2. **Write** it to the OS temp dir: `$TMPDIR/<name>-<timestamp>.html` (fall back to `/tmp`, `%TEMP%` on Windows). Nothing lands in the repo.
3. **Serve + collect** the decision:
   ```bash
   node <path-to>/skill-ui/scripts/serve-plan.mjs <html-path> <decision-out.json> [--timeout=600]
   ```
   It prints the local URL, opens the browser, and blocks until the user clicks **Approve** or **Adjust** (or the idle timeout fires). On submit it writes `<decision-out.json>` and exits `0`.

   **Safe port by default.** The server binds an **OS-assigned ephemeral port** (49152+), so it never clashes with dev servers on `3000` / `5173` / `8000` / `8080` / `8787` / `19006` and friends. Pass `--port=N` only if you need a fixed one; if that port is taken it falls back to a free ephemeral port rather than failing.
4. **Read** `<decision-out.json>` and act on it.

**Fallback — never hang.** If Node is unavailable, the environment is headless, or the port can't bind: `open` the HTML file directly (`file://`). The controls still work, and the page's **Copy decision** button puts the same JSON (base64) on the clipboard for the user to paste back into the terminal. A non-TTY caller therefore always has a decision path.

## The decision contract

The page posts one JSON object; the server writes it verbatim to the out-path:

```json
{ "approved": true, "flips": ["rule.function-form"], "revisit": ["rule.error-shape"], "notes": "keep classes only in the DB layer" }
```

- **`approved`** — Approve (`true`) vs Adjust (`false`).
- **`flips`** — `data-id`s of `pick-block`s the user flipped (chosen ↔ rejected). Re-open the grill on these.
- **`revisit`** — `data-id`s marked "revisit" without a firm decision.
- **`notes`** — free text from the notes box.

Every interactive component carries a stable `data-id`; that id is what appears in `flips` / `revisit`. Name ids meaningfully (`rule.error-shape`, `move.orders-dir`) so a bare id tells you what to re-open.

## Components (see COMPONENTS.md for the HTML)

| Component | Purpose |
|---|---|
| **plan-shell** | The page: Tailwind + Mermaid (CDN), dark theme, sticky header, the wired submit-bar. Everything nests inside. |
| **section-card** | A titled section with an optional state chip (`create` · `validate ✓` · `drift` · `✓ clean`). |
| **diff-block** | Green/red before→after for a file or snippet. |
| **pick-block** | A ✓ chosen / ✗ rejected pair (the pick-the-code result) — flippable, carries `data-id`. |
| **tree-panel** | An ASCII directory tree in `<pre>`, side-by-side before │ after. Feed it output from `ascii-architecture-flow-mapper`. |
| **flow** | A Mermaid `flowchart` / `graph` wrapper. |
| **code-block** | A highlighted snippet or the composed **canonical-example** block. |
| **submit-bar** | Approve / Adjust / Copy-decision + a notes box; wired to post the decision contract. |

## Rules

- **Self-contained + CDN-only.** No repo assets, no app code, no build step. Tailwind + Mermaid from CDN; everything else inline in the one file.
- **Content in, structure fixed.** Skills supply content and `data-id`s; they do **not** restyle the shell — a fixed shell is what keeps every skill's report consistent and recognizable.
- **Never block a script.** The server carries an idle timeout; the fallback is copy-paste. A headless / non-TTY caller must still reach a decision.
- **The kit owns the HTML; the skill owns the content.** Reference this skill and plug in — don't re-derive the shell. When a report needs a new widget, add it here so the next skill inherits it.
