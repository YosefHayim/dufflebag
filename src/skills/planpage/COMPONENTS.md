# planpage skill — components live in the `planpage` package

The copy-paste HTML kit that used to live here has been **retired**. The components, theme, and post-back script are now the open-source [`planpage`](https://github.com/YosefHayim/planpage) package — one source of truth: typed, tested, and shown in a live gallery.

- **See every component live** — `npx planpage library --open` (preview + usage + props table for each).
- **Author a page** — `import { render, SectionCard, PickBlock, Callout, Steps, OptionCompare, … } from "planpage"`, or `npx planpage render <template> --data data.json` (`--sample` for demo data).
- **Collect a decision** — `npx planpage serve <html> <out>`.

The full component list, the plan-native pieces (`Callout` · `RiskList` · `Steps` · `Timeline` · `OptionCompare` · `PlanSummary` · `Accordion` · `AnnotatedCode`), the `render()`/`serve` API, and the recipes live in the package's `README.md` + `CODE-STYLE.md`. The decision contract and `data-id` conventions are unchanged — see [SKILL.md](SKILL.md).
