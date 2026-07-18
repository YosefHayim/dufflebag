# Formatter & Linter Lookup

Language → recommended tooling. For languages with **one canonical formatter** (Go, Rust), skip the question — just confirm. For languages with real choices, present the options as a pick.

| Language | Formatter (recommended first) | Linter | Notes |
|----------|-------------------------------|--------|-------|
| TypeScript / JavaScript | **biome** · prettier | **biome** · eslint | biome does both; if the repo already has eslint+prettier, offer migration |
| Rust | rustfmt (canonical — no choice) | clippy | Skip the formatter question; just confirm |
| Go | gofmt (canonical — no choice) | golangci-lint | Skip the formatter question; gofmt is non-negotiable |
| Python | **ruff format** · black | **ruff** · flake8 · pylint | ruff does both; black is legacy-but-stable |
| Swift | swift-format | SwiftLint | |
| Kotlin | **ktfmt** · ktlint | detekt | ktfmt (Google style) preferred for consistency |
| Java | google-java-format · spotless | checkstyle · Error Prone | |
| Ruby | rubocop (does both) | rubocop | Single tool |
| PHP | php-cs-fixer · pint (Laravel) | phpstan · psalm | |
| C# | dotnet format (canonical) | Roslyn analyzers | Skip the formatter question |
| Elixir | mix format (canonical) | credo | Skip the formatter question |
| Dart | dart format (canonical) | dart analyze / custom_lint | Skip the formatter question |

## How the grill uses this

1. After language detection (Q0 / auto-detect), look up the row.
2. If only one formatter exists → confirm it, don't ask.
3. If multiple → present as a pick (recommended is bold).
4. The chosen formatter config file is generated in Step 7.
5. Linter rules for machine-catchable slop tells are added to the linter config, not just documented in CODE-STYLE.md.
