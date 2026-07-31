#!/bin/sh

set -eu

status_line='status_line = ["current-dir", "model", "reasoning", "context-remaining", "context-window-size", "weekly-limit"]'
config_file="${1:-${CODEX_HOME:-${HOME}/.codex}/config.toml}"
config_dir=$(dirname -- "$config_file")

if [ -e "$config_file" ] && [ ! -f "$config_file" ]; then
  echo "Refusing to replace non-file path: $config_file" >&2
  exit 1
fi

mkdir -p "$config_dir"
temp_file=$(mktemp "$config_dir/.config.toml.XXXXXX")
trap 'rm -f "$temp_file"' EXIT HUP INT TERM

if [ -f "$config_file" ]; then
  source_file=$config_file
else
  source_file=/dev/null
fi

awk -v status_line="$status_line" '
  BEGIN {
    in_tui = 0
    tui_seen = 0
    status_written = 0
  }

  function write_status() {
    if (!status_written) {
      print status_line
      status_written = 1
    }
  }

  {
    if ($0 ~ /^[[:space:]]*\[[^]]+\]/) {
      if (in_tui) {
        write_status()
      }

      in_tui = $0 ~ /^[[:space:]]*\[tui\][[:space:]]*(#.*)?$/
      if (in_tui) {
        tui_seen = 1
      }
    }

    if (in_tui && $0 ~ /^[[:space:]]*status_line[[:space:]]*=/) {
      write_status()
      next
    }

    print
  }

  END {
    if (in_tui) {
      write_status()
    }

    if (!tui_seen) {
      if (NR > 0) {
        print ""
      }
      print "[tui]"
      print status_line
    }
  }
' "$source_file" > "$temp_file"

if [ -f "$config_file" ] && cmp -s "$config_file" "$temp_file"; then
  echo "Codex status line is already configured in $config_file"
  exit 0
fi

if [ -f "$config_file" ]; then
  cp -p "$config_file" "$config_file.bak"
fi

mv "$temp_file" "$config_file"
trap - EXIT HUP INT TERM

echo "Configured Codex status line in $config_file"
if [ -f "$config_file.bak" ]; then
  echo "Previous configuration: $config_file.bak"
fi
