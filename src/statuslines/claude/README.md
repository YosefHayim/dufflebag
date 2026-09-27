# Claude Code status line

Two lines:

`folder · branch · model · 58k/1M · 5H 5%/100% · W 10%/100%`
`User:5 & Claude:10 · Total 15 · Compacts:2 · In:503k Out:105k · 1h 12m`

The 5-hour and weekly limits are green below 50%, blue from 50%, and red from 80%. Message, compact, and
token counts come from the session transcript and are cached per session under
`~/.claude/dufflebag/state/statusline/`, so each refresh reads only new lines.

From the `dufflebag` repository root, run:

```sh
./src/statuslines/claude/install.sh
```

It copies `statusline.mjs` to `~/.claude/statusline.mjs` and sets only `statusLine` in `~/.claude/settings.json`.
Set `CLAUDE_CONFIG_DIR` to install into another Claude folder.
