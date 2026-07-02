# skill-ui — components (moved to the package)

The copy-paste HTML kit that used to live here has been **retired**. The components, theme, and post-back script are now the open-source [`skill-ui`](https://github.com/YosefHayim/skill-ui) package — one source of truth: typed, tested, and shown in a live gallery.

- **See every component live** — `skill-ui library --open` (preview + usage + props table for each).
- **Author a page** — `import { render, SectionCard, PickBlock, Callout, Steps, OptionCompare, … } from "skill-ui"`, or `skill-ui render <template> --data data.json` (`--sample` for demo data).
- **Collect a decision** — `skill-ui serve <html> <out>` (pre-publish bridge: `node scripts/serve-plan.mjs <html> <out>`).

The full component list, the plan-native pieces (`Callout` · `RiskList` · `Steps` · `Timeline` · `OptionCompare` · `PlanSummary` · `Accordion` · `AnnotatedCode`), the `render()`/`serve` API, and the recipes live in the package's `README.md` + `CODE-STYLE.md`. The decision contract and `data-id` conventions are unchanged — see [SKILL.md](SKILL.md).
