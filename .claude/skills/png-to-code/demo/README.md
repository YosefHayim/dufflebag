# Local case-study assets

These files are for a legacy animated-illustration case study. Its binary assets are **not committed** to git, so this folder is not the canonical example for normal PNG → SVG/HTML work. Use the canonical before/after loop in [`../README.md`](../README.md#canonical-iteration) for new tasks.

## Quick start

1. Add your own PNGs and optional mask config:

   ```bash
   mkdir -p demo/config demo/out
   # place robot.png and target.png in demo/
   # optional: demo/config/mask-base.json and mask-hand.json for the robot example
   ```

2. Install the harness (once):

   ```bash
   cd ../scripts && npm i && npx playwright install chromium
   ```

3. Run scripts from `scripts/` with paths relative to your working directory, e.g.:

   ```bash
   npm run diff -- --target ../demo/robot.png --input ../demo/robot.html
   npx tsx src/png/extractBlob.ts --input ../demo/robot.png --output ../demo/out/blob.svg
   npx tsx src/examples/robot/compose.ts --out-dir ../demo/out
   ```

## Expected layout (local only)

```text
demo/
├── robot.png          # source illustration
├── target.png         # diff target (may match robot.png)
├── config/
│   ├── mask-base.json
│   └── mask-hand.json
└── out/               # generated intermediates (gitignored)
```

Deliverables like `robot.html` and `robot.svg` also stay local unless you choose to keep them outside this repo.
