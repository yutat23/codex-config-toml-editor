# Codex Config TOML Editor

English | [日本語](README.ja.md) · [Changelog](CHANGELOG.md)

A VSCode extension for editing a repository’s `.codex/config.toml`. Manage file protection, general settings such as the model, and configuration diagnostics in one editor.

## Features

- Read-deny rules for files, folders, and glob patterns
- Presets for `.env` and private keys, protection candidates, and matching-file previews
- Editing for model, reasoning effort, approval policy, and web search
- Configuration-source comparison and diagnostics for TOML syntax and legacy sandbox conflicts
- Saves that preserve comments and untouched settings, with diff review and external-change detection

The extension edits `.codex/config.toml` under the workspace folder. Shared settings remain unchanged. It does not read the contents of protection candidates or send settings or paths to external services.

## Usage

VSCode 1.120 or later is required. In the Extensions view’s “…” menu, choose **Install from VSIX** and select this extension’s `.vsix` file.

1. Open a repository and run **Codex Config TOML Editor: Open Repository Settings** from the command palette.
2. Add relative paths or glob patterns under **File protection**.
3. Use **Check matching files** to review the matching paths.
4. Choose **Preview changes**, review the diff, and click **Save reviewed changes**.
5. Trust the project in Codex and check the settings in a new session.

You can also right-click Explorer items and choose **Codex Config TOML Editor: Deny Reading This File or Folder**. Multiple selections are supported. Review and save the changes in the settings editor after adding items.

## Notes

This extension configures protection rules. It does not verify read denial in a running Codex session or control information supplied through other extensions, external MCPs, environment variables, or attachments.

- It uses Codex permission profiles, a beta feature. Support depends on the Codex version, OS, and launch method. Values shown in diagnostics may differ from the running session’s effective settings.
- Legacy `sandbox_mode` conflicts block saving protection settings. Repository-level `read-only` / `workspace-write` settings can be migrated in the editor; migrate shared or complex settings manually in TOML. Disable protection directly in TOML as well.
- File scans default to 10,000 files. **Search settings** allows limits from 1 to 1,000,000. `.git`, dependencies, and build outputs are excluded. Candidates are limited to 300 entries; matches show up to 200 files per pattern. These limits and exclusions do not affect protection rules.
- Matches are path previews and may differ from actual glob behavior or protection of symbolic-link targets. Linux, WSL, and Windows limit glob pre-expansion depth; the extension adds `glob_scan_max_depth = 20` when needed. `.env.example` also matches `.env.*`.
- Edit inline tables, array tables, and complex globs directly in TOML. Saving through symbolic links, virtual workspaces, and untrusted workspaces are not supported. With Remote SSH or WSL, the extension runs on the workspace side.

For Codex configuration details, see the official [Permission profiles](https://learn.chatgpt.com/docs/permissions), [Configuration loading](https://learn.chatgpt.com/docs/config-file/config-basic), and [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## Development

Node.js 22 or later is recommended.

```sh
npm ci
npm run check
npm test
npm run build

# Browser UI tests
npx playwright install chromium
npm run test:ui

# Generate a VSIX
npm run package
```

Open this folder in VSCode and press F5 to launch the Extension Development Host.
