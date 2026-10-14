# Codex Config TOML Editor

リポジトリの `.codex/config.toml` をVSCodeから編集する拡張機能です。機密ファイルの読み取り禁止ルールを中心に、基本設定と設定の診断をまとめています。

## インストールと使い方

1. VSCode 1.120以降の拡張機能画面の「…」から **VSIXからのインストール** を選び、`codex-config-toml-editor-0.1.0.vsix` を指定します。
2. リポジトリを開き、コマンドパレットから **Codex Config TOML Editor: リポジトリ設定を開く** を実行します。複数のワークスペースがある場合は対象を選べます。
3. ファイル保護で相対パスやglobを追加します。エクスプローラーからファイル・フォルダーを右クリックして追加することもできます（複数選択対応）。
4. **対象ファイルを確認** でパターンに一致するパスを確認します。
5. **差分を確認** でVSCodeの差分エディターを開き、**確認した変更を保存** を押します。右クリックだけでは設定を書き込みません。
6. Codexでプロジェクトを信頼し、新しいセッションで設定を確認してください。

## 表示言語 / Display language

画面右上の「言語」で **VSCodeに合わせる / 日本語 / English** を選べます。選択は拡張機能に保存され、次回も引き継ぎます。切り替えても未保存の編集内容や差分の確認状態は維持されます。初期状態はVSCodeの表示言語に合わせます。日本語（`ja`）では日本語、それ以外では英語で表示します。画面、操作メッセージ、診断を切り替えます。コマンドパレットと右クリックメニューはVSCodeの表示言語に従います。設定値やファイル名は翻訳しません。

Use the **Language** selector in the editor header to choose **Follow VSCode / 日本語 / English**. Your selection persists across editor sessions; switching preserves unsaved edits and reviewed changes. In automatic mode, the editor follows the VSCode display language: Japanese for `ja`, English for other languages. The selector changes editor labels, status messages, and diagnostics. Command and context-menu names continue to follow the VSCode display language. Configuration values and file names stay unchanged. Use **Configure Display Language** in the command palette to change the VSCode display language, then restart VSCode.

## 初版の機能

- ファイル・フォルダー・`*` / `**` パターンの読み取り禁止設定
- `.env`、`.env.*`、秘密鍵などのプリセットと名前による候補表示
- モデル、推論の強さ、承認方針、Web検索のフォーム編集
- リポジトリ・親リポジトリ設定・ユーザー共通設定・Unixシステム設定の比較
- TOML構文、旧sandbox設定との競合、継承元の存在などの診断
- 既存コメント・改行・未編集項目を残す局所的な書き換え
- 保存前の差分確認、外部変更の検出、シンボリックリンクへの保存の拒否
- 日英UI、VSCodeのテーマに追従する配色、キーボード操作

編集するのは、選択したワークスペース直下の `.codex/config.toml` です。共通設定は診断用に読み込み、変更しません。機密ファイル候補の内容を読んだり、設定値やパスを外部サービスに送信したりする処理はありません。CLIのバージョンは `codex --version` で取得します。

## ファイル保護の動作

Codexのベータ機能である権限プロファイルを使用します。新規作成時の例です。

```toml
default_permissions = "repository-protection"

[permissions.repository-protection]
extends = ":workspace"

[permissions.repository-protection.filesystem]
glob_scan_max_depth = 20

[permissions.repository-protection.filesystem.":workspace_roots"]
"**/.env" = "deny"
"**/.env.*" = "deny"
```

既存の `default_permissions` があればそのプロファイルを継承します。既存の `repository-protection` が共通設定にある場合は、その定義を維持します。他のプロファイルのルールやネットワーク設定はフォームから変更しません。専用プロファイルを無効にする操作はTOMLで直接行ってください。

`sandbox_mode` が読み込まれると権限プロファイルより旧設定が優先されるため、保護設定の保存を止めます。リポジトリに `sandbox_mode = "read-only"` または `"workspace-write"` だけがある場合は、チェックボックスで移行できます。`read-only` は `:read-only` を継承します。`sandbox_workspace_write`、共通設定の旧設定、旧設定と既存の権限プロファイルが混在する場合は、権限を維持するため手動移行が必要です。

## 確認範囲と制限

**「ルール設定済み」と「Codexの実行時に読み取り拒否を確認済み」は異なります。** この拡張は設定の作成とパスのプレビューを行います。実行中のCodexセッションを検査したり、他のVSCode拡張や外部MCPの読み取りを遮断したりする機能はありません。

- 権限プロファイルの対応状況はCodexのバージョン・OS・起動方法に依存します。CLIバージョンは表示しますが、対応を自動判定しません。IDE内蔵のCodexはCLIとバージョンが異なる場合があります。
- VSCodeのワークスペースの信頼と、Codex側のプロジェクトの信頼は別です。Codexがプロジェクトを信頼していなければリポジトリ設定は読み込まれません。
- CLI引数、選択中の別プロファイル、クラウド管理設定、管理ポリシー、子フォルダー設定などを完全には解決しません。設定元の比較は有効値の確定表示ではありません。
- Linux・WSL・Windowsのglob事前展開には深度と開始時点の制限があります。初版は必要に応じて `glob_scan_max_depth = 20` を追加します。起動時間、深い階層、新規作成ファイルの挙動は対象環境で確認してください。
- 一致表示は大文字小文字を区別するglob近似です。OSやCodexの実際のglob処理との完全一致、シンボリックリンク先の保護は保証しません。
- パス走査は最大10,000ファイル。`.git`、`node_modules`、`.venv`、`venv`、`bin`、`obj`、`dist`、`build`、`.next`、`.test-build` は走査対象外です。除外はプレビュー・候補検出だけに使い、生成する禁止ルールには影響しません。候補は先頭300件、各パターンの一致表示は先頭200件です。
- `.env.example` も `.env.*` に一致します。プリセット追加後に対象を確認してください。
- インラインテーブル内の設定、配列テーブル内の設定、複雑なglob、特殊文字を含むパスはTOMLで直接編集してください。安全に局所編集できない記法は書き換えずにエラーを表示します。
- ファイルの禁止だけでは環境変数、コマンド出力、既に添付された内容、コピー済みのデータなどからの情報提供を制御できません。
- Remote SSH / WSLではワークスペース側で拡張を実行します。仮想ワークスペースと未信頼ワークスペースには対応しません。

公式仕様: [権限プロファイル](https://learn.chatgpt.com/docs/permissions) / [設定の読み込み](https://learn.chatgpt.com/docs/config-file/config-basic) / [設定リファレンス](https://learn.chatgpt.com/docs/config-file/config-reference)。2026-10-14に確認。

## 開発

Node.js 22以降を推奨します。

```sh
npm ci
npm run check
npm test
npm run build
```

VSCodeでこのフォルダーを開いてF5を押すとExtension Development Hostが起動します。テスト用のリポジトリを開いてコマンドを実行してください。

```sh
# 実ブラウザーでのWebviewテスト（Chromiumの起動が可能な環境）
npx playwright install chromium
npm run test:ui

# VSIX生成（固定バージョンの公式vsceをnpm経由で実行）
npm run package
```

自動テストは設定変換、コメント保持、権限の継承、競合・移行の拒否、モックVSCode API上の差分と保存、DOM操作を確認します。実際のVSCodeでの表示・操作とCodexサンドボックスでの読み取り拒否は、これらのテストとは別に確認が必要です。
