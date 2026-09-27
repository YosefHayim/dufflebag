#!/bin/sh
# Copy the Claude Code status line into the Claude folder and point settings.json at it.
set -eu

claude_dir="${CLAUDE_CONFIG_DIR:-${HOME}/.claude}"
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)

mkdir -p "$claude_dir"
cp "$script_dir/statusline.mjs" "$claude_dir/statusline.mjs"

node -e '
const fs = require("node:fs");
const [settingsPath, scriptPath] = process.argv.slice(1);
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
settings.statusLine = { type: "command", command: `node "${scriptPath}"`, padding: 0 };
fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
' "$claude_dir/settings.json" "$claude_dir/statusline.mjs"

echo "Installed $claude_dir/statusline.mjs"
