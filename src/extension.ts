import { t, setLanguage, getLanguage } from './i18n.js';
import { html } from './view.js';
import { UserError, errorMessage } from './errors.js';
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomBytes } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { applyDraft, BASIC_KEYS, diagnose, isCandidate, layer, makeDraft, matches, PROFILE, validateDraft, validatePattern, type Draft, type Layer } from './config.js';
import { get, type Table } from './toml.js';

type LanguageChoice = 'auto' | 'ja' | 'en';
let languageChoice: LanguageChoice = 'auto';
const languageStorageKey = 'editorLanguage';
const panels = new Map<string, Editor>();
const previews = new Map<string, string>();
const decoder = new TextDecoder();
const excludes = '**/{.git,node_modules,.venv,venv,bin,obj,dist,build,.next,.test-build}/**';
const defaultFileLimit = 10000;
const maxFileLimit = 1000000;
function validFileLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= maxFileLimit;
}

async function read(uri: vscode.Uri): Promise<string> {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try { return decoder.decode(await vscode.workspace.fs.readFile(uri)); }
  catch (error) { if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return ''; throw error; }
}

interface Snapshot { text: string; layers: Layer[]; fingerprint: string }
async function snapshot(root: vscode.WorkspaceFolder): Promise<Snapshot> {
  const target = vscode.Uri.joinPath(root.uri, '.codex', 'config.toml');
  const layers: Layer[] = [];
  const user = vscode.Uri.file(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'));
  const locations: { name: string; uri: vscode.Uri }[] = [];
  if (process.platform !== 'win32') locations.push({ name: "システム /etc/codex/config.toml", uri: vscode.Uri.file('/etc/codex/config.toml') });
  locations.push({ name: "ユーザー共通 config.toml", uri: user });
  // Codex project layers start at the nearest repository boundary.
  let boundary = root.uri.fsPath;
  for (let dir = root.uri.fsPath; ; dir = path.dirname(dir)) {
    try { await lstat(path.join(dir, '.git')); boundary = dir; break; } catch { /* not a repository boundary */ }
    if (path.dirname(dir) === dir) break;
  }
  const ancestors: string[] = [];
  for (let dir = path.dirname(root.uri.fsPath); dir !== root.uri.fsPath && dir.startsWith(boundary + path.sep); dir = path.dirname(dir)) ancestors.unshift(dir);
  if (boundary !== root.uri.fsPath) ancestors.unshift(boundary);
  locations.push(...ancestors.map(dir => ({ name: `親 ${path.relative(boundary, dir) || '.'}/.codex/config.toml`, uri: vscode.Uri.file(path.join(dir, '.codex/config.toml')) })));
  for (const location of locations) {
    try { const text = await read(location.uri); if (text) layers.push(layer(location.name, text)); }
    catch { layers.push({ name: location.name, text: '', error: "設定ファイルを読み込めません。" }); }
  }
  const text = await read(target);
  return { text, layers, fingerprint: JSON.stringify(layers.map(l => [l.name, l.text, Boolean(l.error)])) };
}

async function safeTarget(root: vscode.WorkspaceFolder): Promise<void> {
  const base = await realpath(root.uri.fsPath);
  for (const suffix of ['.codex', path.join('.codex', 'config.toml')]) {
    const file = path.join(base, suffix);
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new UserError(t(".codex または config.toml がシンボリックリンクです。保存先を確認して直接編集してください。"));
      const resolved = await realpath(file);
      if (!resolved.startsWith(base + path.sep)) throw new UserError(t("保存先がワークスペース外です。"));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

function cliVersion(): Promise<string> {
  return new Promise(resolve => execFile('codex', ['--version'], { timeout: 4000, maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
    const version = stdout.match(/codex-cli\s+[\w.+-]+/)?.[0];
    resolve(!error && version ? version : t("未検出（IDE拡張のみの環境を含む）"));
  }));
}

async function choose(uri?: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> {
  if (!vscode.workspace.isTrusted) throw new UserError(t("信頼されたワークスペースで実行してください。"));
  const fromUri = uri && vscode.workspace.getWorkspaceFolder(uri);
  if (fromUri) return fromUri;
  const folders = vscode.workspace.workspaceFolders?.filter(f => f.uri.scheme === 'file');
  if (!folders?.length) throw new UserError(t("ローカルのリポジトリフォルダーを開いてください。"));
  return folders.length === 1 ? folders[0] : vscode.window.showWorkspaceFolderPick({ placeHolder: t("設定するリポジトリを選択") });
}

class Editor {
  private panel: vscode.WebviewPanel;
  private base?: Snapshot;
  private pending?: { before: Snapshot; after: string };
  private queuedPatterns: string[] = [];
  private files: string[] = [];
  private truncated = false;
  private fileLimit = defaultFileLimit;
  private get scanStorageKey() { return `scanLimit:${this.root.uri.toString()}`; }
  private busy = false;
  private version = t("確認中");
  private previewUris: vscode.Uri[] = [];
  constructor(private root: vscode.WorkspaceFolder, private context: vscode.ExtensionContext) {
    const savedLimit = context.globalState?.get<number>(this.scanStorageKey);
    if (validFileLimit(savedLimit)) this.fileLimit = savedLimit;
    this.panel = vscode.window.createWebviewPanel('codexConfig', t("Codex設定: {0}", root.name), vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')], retainContextWhenHidden: true });
    const nonce = randomBytes(24).toString('hex');
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'editor.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'editor.css'));
    this.panel.webview.html = html(webview.cspSource, nonce, css.toString(), script.toString());
    this.panel.onDidDispose(() => { panels.delete(root.uri.toString()); for (const uri of this.previewUris) previews.delete(uri.toString()); });
    this.panel.webview.onDidReceiveMessage(message => { void this.handle(message); });
  }
  reveal(patterns: string[] = []) {
    this.panel.reveal();
    this.queuedPatterns.push(...patterns);
    if (this.base && !this.busy) this.deliverPatterns();
  }
  private deliverPatterns() {
    if (this.queuedPatterns.length) this.send({ type: 'addPatterns', patterns: this.queuedPatterns.splice(0) });
  }
  private send(value: unknown) { void this.panel.webview.postMessage(value); }
  private async load() {
    this.pending = undefined;
    this.base = await snapshot(this.root);
    const current = layer(t("リポジトリ .codex/config.toml"), this.base.text);
    const draft = makeDraft(current.data ?? {});
    await this.scan();
    this.send({ type: 'loaded', root: this.root.name, draft, invalid: Boolean(current.error),
      ...this.information(), choice: languageChoice,
      count: this.files.length, scanLimit: this.fileLimit, truncated: this.truncated });
    this.deliverPatterns();
  }
  private async scan(limit = this.fileLimit, persist = false) {
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(this.root, '**/*'), excludes, limit + 1);
    if (persist) await this.context.globalState.update(this.scanStorageKey, limit);
    this.fileLimit = limit;
    this.truncated = found.length > limit;
    this.files = found.slice(0, limit).map(uri => path.relative(this.root.uri.fsPath, uri.fsPath).split(path.sep).join('/')).sort();
  }
  private information() {
    if (!this.base) return {};
    const current = layer(t("リポジトリ .codex/config.toml"), this.base.text);
    const layers = this.base.layers.map(source => {
      const parent = /^親 (.*)\/\.codex\/config\.toml$/.exec(source.name);
      const name = parent ? t("親 {0}/.codex/config.toml", parent[1]) : t(source.name);
      return source.text ? layer(name, source.text) : { ...source, name, error: source.error ? t("設定ファイルを読み込めません。") : undefined };
    });
    return {
      issues: diagnose(current, layers, this.version.startsWith('codex-cli ') ? this.version : t("未検出（IDE拡張のみの環境を含む）"), vscode.workspace.isTrusted),
      sources: [...layers, current].map(l => ({ name: l.name, values: Object.fromEntries([...BASIC_KEYS, 'default_permissions'].map(k => [k, summary(l.data?.[k])])) })),
      candidates: this.files.filter(isCandidate).slice(0, 300),
      extraRules: this.otherRules(current.data, layers)
    };
  }
  private refreshLanguage() {
    this.panel.title = t("Codex設定: {0}", this.root.name);
    this.send({ type: 'language', locale: getLanguage(), choice: languageChoice, info: this.information() });
  }
  private otherRules(data: Table | undefined, layers: Layer[]): string[] {
    const entries: string[] = [];
    for (const l of [...layers, { name: t("リポジトリ"), data }]) {
      const profile = get(l.data, ['permissions']);
      if (profile && typeof profile === 'object') {
        for (const name of Object.keys(profile)) {
          if (l.name === t("リポジトリ") && name === PROFILE) continue;
          entries.push(`${l.name}: ${name}`);
        }
      }
    }
    return entries;
  }
  private async handle(message: unknown) {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const m = message as Record<string, unknown>;
    if (m.type === 'invalidate') { this.pending = undefined; return; }
    if (m.type === 'previewFiles') {
      try {
        const draft = validateDraft(m.draft);
        const rules = draft.patterns.map(pattern => { const all = this.files.filter(f => matches(f, pattern)); return { pattern, files: all.slice(0, 200), count: all.length }; });
        this.send({ type: 'matches', rules, truncated: this.truncated, scanLimit: this.fileLimit });
      } catch (error) { this.send({ type: 'error', message: errorMessage(error) }); }
      return;
    }
    if (this.busy) return;
    this.busy = true;
    try {
      if (m.type === 'setLanguage') {
        if (!['auto', 'ja', 'en'].includes(String(m.choice))) return;
        const choice = m.choice as LanguageChoice;
        await this.context.globalState.update(languageStorageKey, choice);
        languageChoice = choice;
        setLanguage(choice === 'auto' ? vscode.env.language : choice);
        for (const panel of panels.values()) panel.refreshLanguage();
        return;
      }
      if (!vscode.workspace.isTrusted) throw new UserError(t("ワークスペースを信頼してから実行してください。"));
      if (m.type === 'rescan') {
        if (!validFileLimit(m.scanLimit)) throw new UserError(t("検索上限は1〜1,000,000の整数で指定してください。"));
        await this.scan(m.scanLimit, true);
        this.send({ type: 'scanned', count: this.files.length, truncated: this.truncated, scanLimit: this.fileLimit, info: this.information() });
      } else if (m.type === 'ready' || m.type === 'reload') {
        if (m.type === 'reload' && m.dirty) {
          const answer = await vscode.window.showWarningMessage(t("未保存の変更を破棄して再読み込みしますか？"), { modal: true }, t("破棄して再読み込み"));
          if (answer !== t("破棄して再読み込み")) return;
        }
        if (m.type === 'ready') this.version = await cliVersion();
        await this.load();
      } else if (m.type === 'openToml') {
        const uri = vscode.Uri.joinPath(this.root.uri, '.codex', 'config.toml');
        try { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri)); }
        catch { throw new UserError(t("config.tomlはまだありません。設定画面で差分確認後に保存してください。")); }
      } else if (m.type === 'preview') {
        const draft = validateDraft(m.draft);
        const before = await snapshot(this.root);
        if (!this.base || before.text !== this.base.text || before.fingerprint !== this.base.fingerprint) throw new UserError(t("設定が外部で変更されています。再読み込みしてから編集してください。"));
        await safeTarget(this.root);
        const after = applyDraft(before.text, draft, before.layers);
        if (after === before.text) throw new UserError(t("保存する変更はありません。"));
        this.pending = { before, after };
        const previewUri = vscode.Uri.parse(`codex-config-preview:/${randomBytes(12).toString('hex')}/config.toml`);
        previews.set(previewUri.toString(), after);
        const originalUri = previewUri.with({ path: previewUri.path.replace('/config.toml', '/before.toml') });
        this.previewUris.push(previewUri, originalUri);
        previews.set(originalUri.toString(), before.text);
        await vscode.commands.executeCommand('vscode.diff', originalUri, previewUri, t("{0}: Codex設定の変更（未保存）", this.root.name), { viewColumn: vscode.ViewColumn.Beside, preview: true });
        if (this.pending) this.send({ type: 'prepared', revision: m.revision });
      } else if (m.type === 'save') {
        if (!this.pending) throw new UserError(t("先に差分を確認してください。"));
        const { before, after } = this.pending;
        this.pending = undefined;
        const now = await snapshot(this.root);
        if (now.text !== before.text || now.fingerprint !== before.fingerprint) throw new UserError(t("差分確認後に設定が変更されました。再読み込みしてください。"));
        await safeTarget(this.root);
        const uri = vscode.Uri.joinPath(this.root.uri, '.codex', 'config.toml');
        const edit = new vscode.WorkspaceEdit();
        let exists = true;
        try { await vscode.workspace.fs.stat(uri); } catch (e) { if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') exists = false; else throw e; }
        if (!exists) {
          await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root.uri, '.codex'));
          await safeTarget(this.root);
          edit.createFile(uri, { overwrite: false });
          edit.insert(uri, new vscode.Position(0, 0), after);
        } else {
          const document = await vscode.workspace.openTextDocument(uri);
          if (document.getText() !== before.text) throw new UserError(t("設定が変更されました。再読み込みしてください。"));
          edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), after);
        }
        if (!await vscode.workspace.applyEdit(edit)) throw new UserError(t("設定の変更を適用できませんでした。"));
        const document = await vscode.workspace.openTextDocument(uri);
        if (!await document.save()) throw new UserError(t("ファイルを保存できませんでした。TOMLエディターを確認してください。"));
        await this.load();
        this.send({ type: 'saved' });
      }
    } catch (error) {
      if (m.type !== 'rescan') this.pending = undefined;
      // Parser errors can contain config values. Only messages from our own
      // validation are shown; unknown library/I/O errors get a generic message.
      this.send({ type: 'error', message: errorMessage(error), operation: m.type });
    } finally { this.busy = false; this.send({ type: 'idle' }); if (this.base) this.deliverPatterns(); }
  }
}

function summary(value: unknown): string { return typeof value === 'string' ? value : value === undefined ? t("未設定") : t("詳細設定（TOMLで管理）"); }

export function activate(context: vscode.ExtensionContext) {
  const saved = context.globalState?.get<string>(languageStorageKey);
  languageChoice = saved === 'ja' || saved === 'en' ? saved : 'auto';
  setLanguage(languageChoice === 'auto' ? vscode.env.language : languageChoice);
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('codex-config-preview', { provideTextDocumentContent: uri => previews.get(uri.toString()) ?? '' }));
  const open = async (root: vscode.WorkspaceFolder, patterns: string[] = []) => {
    if (root.uri.scheme !== 'file') throw new UserError(t("ローカルのフォルダーを選択してください。"));
    let panel = panels.get(root.uri.toString());
    if (!panel) { panel = new Editor(root, context); panels.set(root.uri.toString(), panel); }
    panel.reveal(patterns);
  };
  const guarded = (fn: (...args: any[]) => Promise<void>) => async (...args: any[]) => {
    try { await fn(...args); } catch (error) { void vscode.window.showErrorMessage(errorMessage(error)); }
  };
  context.subscriptions.push(vscode.commands.registerCommand('codexConfig.open', guarded(async () => { const root = await choose(); if (root) await open(root); })));
  context.subscriptions.push(vscode.commands.registerCommand('codexConfig.protect', guarded(async (uri?: vscode.Uri, selection?: vscode.Uri[]) => {
    uri ??= vscode.window.activeTextEditor?.document.uri;
    if (!uri) throw new UserError(t("対象のファイルまたはフォルダーを選択してください。"));
    const root = await choose(uri); if (!root) return;
    const patterns: string[] = [];
    for (const selected of selection?.length ? selection : [uri]) {
      if (vscode.workspace.getWorkspaceFolder(selected)?.uri.toString() !== root.uri.toString()) throw new UserError(t("同じワークスペース内の項目を選択してください。"));
      const relative = path.relative(root.uri.fsPath, selected.fsPath).split(path.sep).join('/');
      if (relative.includes('*')) throw new UserError(t("* を含む名前はTOMLで直接設定してください。"));
      const problem = validatePattern(relative); if (problem) throw new UserError(problem);
      patterns.push(relative);
    }
    await open(root, patterns);
  })));
  context.subscriptions.push({ dispose: () => { previews.clear(); panels.clear(); } });
}


