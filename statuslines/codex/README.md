# Codex status line

This preset configures the Codex footer exactly as:

`current directory · model · reasoning level · context remaining · context window · weekly limit`

From the `dufflebag` repository root, run:

```sh
./statuslines/codex/install.sh
```

The installer updates only `tui.status_line` in `~/.codex/config.toml` and preserves every other setting. When it changes an existing configuration, it saves the previous file as `~/.codex/config.toml.bak`.

Pass a configuration path to install the preset somewhere else:

```sh
./statuslines/codex/install.sh /path/to/config.toml
```

Restart Codex if an open session does not refresh immediately.
