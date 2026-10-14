import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import * as path from 'node:path';

export class Uri {
  constructor(public value: string) {}
  static file(file: string) { return new Uri(`file://${file}`); }
  static parse(value: string) { return new Uri(value); }
  static joinPath(uri: Uri, ...parts: string[]) { return Uri.file(path.join(uri.fsPath, ...parts)); }
  get fsPath() { return new URL(this.value).pathname; }
  get path() { return this.fsPath; }
  get scheme() { return this.value.split(':')[0]; }
  with(change: { path: string }) { return Uri.parse(`${this.scheme}:${change.path}`); }
  toString() { return this.value; }
}
export class FileSystemError extends Error {
  constructor(public code = 'FileNotFound') { super(code); }
}
export class Position { constructor(public line: number, public character: number) {} }
export class Range { constructor(public start: Position, public end: Position) {} }
export class WorkspaceEdit {
  edits: { uri: Uri; text: string }[] = [];
  createFile() {}
  insert(uri: Uri, _position: Position, text: string) { this.edits.push({ uri, text }); }
  replace(uri: Uri, _range: Range, text: string) { this.edits.push({ uri, text }); }
}
export class RelativePattern { constructor(public root: unknown, public pattern: string) {} }
export const ViewColumn = { One: 1, Beside: 2 };
export const state: {
  root: string; messages: any[]; handler?: (m: unknown) => void; html: string;
  commands: Map<string, (...args: any[]) => Promise<void>>; errors: string[]; diff?: any[];
  scanRequests?: number[]; scanError?: boolean;
} = { root: '', messages: [], html: '', commands: new Map(), errors: [] };

async function read(file: string) {
  if (!file.startsWith(state.root + '/')) throw new FileSystemError();
  try { return await readFile(file); } catch { throw new FileSystemError(); }
}
export const workspace = {
  isTrusted: true,
  get workspaceFolders() { return [{ uri: Uri.file(state.root), name: 'fixture', index: 0 }]; },
  textDocuments: [] as any[],
  getWorkspaceFolder(uri: Uri) { return uri.fsPath.startsWith(state.root + '/') ? workspace.workspaceFolders[0] : undefined; },
  registerTextDocumentContentProvider() { return { dispose() {} }; },
  async findFiles(_include: unknown, _exclude: unknown, maxResults: number) {
    (state.scanRequests ??= []).push(maxResults);
    if (state.scanError) throw new Error('scan failed');
    return [Uri.file(path.join(state.root, '.env')), Uri.file(path.join(state.root, 'src/main.ts'))].slice(0, maxResults);
  },
  fs: {
    readFile: (uri: Uri) => read(uri.fsPath),
    async stat(uri: Uri) { try { return await stat(uri.fsPath); } catch { throw new FileSystemError(); } },
    async createDirectory(uri: Uri) { await mkdir(uri.fsPath, { recursive: true }); }
  },
  async openTextDocument(uri: Uri) {
    const text = (await read(uri.fsPath)).toString();
    return { uri, getText: () => text, positionAt: (offset: number) => new Position(0, offset), save: async () => true };
  },
  async applyEdit(edit: WorkspaceEdit) { for (const e of edit.edits) await writeFile(e.uri.fsPath, e.text); return true; }
};
export const commands = {
  registerCommand(name: string, callback: (...args: any[]) => Promise<void>) { state.commands.set(name, callback); return { dispose() {} }; },
  async executeCommand(...args: any[]) { state.diff = args; }
};
export const window = {
  activeTextEditor: undefined,
  createWebviewPanel() {
    return { reveal() {}, onDidDispose() {}, webview: {
      cspSource: 'http://127.0.0.1', asWebviewUri: (uri: Uri) => uri,
      set html(value: string) { state.html = value; },
      get html() { return state.html; },
      onDidReceiveMessage(callback: (m: unknown) => void) { state.handler = callback; },
      async postMessage(value: unknown) { state.messages.push(value); return true; }
    } };
  },
  async showWorkspaceFolderPick() { return workspace.workspaceFolders[0]; },
  async showTextDocument() {},
  async showWarningMessage() { return undefined; },
  showErrorMessage(message: string) { state.errors.push(message); }
};

export const env = { language: 'ja' };
