# Changelog

English | [日本語](CHANGELOG.ja.md) · [README](README.md)

## [0.1.0] - 2026-10-14

### Added

- A repository settings editor for `.codex/config.toml`, with File protection, General, and Diagnostics sections.
- Read-deny rules for files, folders, and glob patterns, presets for `.env` and private keys, name-based candidates, and matching-path previews.
- An Explorer context-menu command for adding protection rules, including multiple selections.
- Form editing for model, reasoning effort, approval policy, and web search, plus comparison of configuration sources.
- Permission-profile inheritance, diagnostics for legacy sandbox conflicts, and migration of supported repository-level legacy settings.
- Diff review before saving, external-change detection, refusal to save through symbolic links, and targeted TOML edits that preserve comments and untouched settings.
- Japanese and English labels, status messages, diagnostics, and command names.
- A language selector with Follow VSCode, Japanese, and English options. The selection persists across editor sessions; switching preserves unsaved edits and reviewed changes.
- A configurable search limit (default: 10,000 files), saved per repository, with rescanning that preserves unsaved edits and reviewed changes.
- Theme-aware styling, responsive layouts, and keyboard navigation.
- A `publish:marketplace` npm command that checks, tests, builds, and publishes the extension using vsce.
