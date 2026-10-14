import { t } from './i18n.js';
import { UserError } from './errors.js';
import { minimatch } from 'minimatch';
import { edit, get, isTable, parse, type Table } from './toml.js';

export const PROFILE = 'repository-protection';
export const PRESETS = ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.pfx', '**/*.p12'];
export const BASIC_KEYS = ['model', 'model_reasoning_effort', 'approval_policy', 'web_search'] as const;
export interface Draft { basics: Record<string, string>; patterns: string[]; protect: boolean; migrateLegacy: boolean }
export interface Issue { level: 'error' | 'warning' | 'info'; message: string }
export interface Layer { name: string; text: string; data?: Table; error?: string }
export function layer(name: string, text: string): Layer {
  try { return { name, text, data: parse(text) }; }
  catch { return { name, text, error: t("TOMLを解析できません。ファイルを直接開いて構文を確認してください。") }; }
}

export function validatePattern(value: string): string | undefined {
  if (!value || value.length > 500) return t("パターンは1〜500文字で指定してください。");
  if (value === '.' || value === '**' || value === '**/*' || value === '*') return t("リポジトリ全体を禁止するパターンはこの画面では指定できません。");
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.startsWith('~') || value.split('/').includes('..') || value.includes('\\')) return t("リポジトリ内の相対パスを / 区切りで指定してください。");
  if (/[\x00-\x1f\x7f]/.test(value) || /[{}\[\]?!]/.test(value)) return t("使用できるglobは * と ** です。特殊な名前はTOMLで直接設定してください。");
  return undefined;
}
export function matches(file: string, pattern: string): boolean {
  return minimatch(file, pattern, { dot: true, nocase: false, nobrace: true, noext: true, nonegate: true, nocomment: true }) || file.startsWith(pattern.replace(/\/$/, '') + '/');
}
export const isCandidate = (file: string) => PRESETS.some(p => matches(file, p)) || /(^|\/)(appsettings\.(?!Development\.|example\.)[^/]+\.json|credentials(?:\.[^/]+)?|id_(rsa|ed25519)|secrets(?:\.[^/]+)?)$/i.test(file);
export function ownedPatterns(data: Table): string[] {
  const rules = get(data, ['permissions', PROFILE, 'filesystem', ':workspace_roots']);
  return isTable(rules) ? Object.entries(rules).filter(([, v]) => v === 'deny').map(([k]) => k) : [];
}
export function makeDraft(data: Table): Draft {
  return { basics: Object.fromEntries(BASIC_KEYS.map(k => [k, typeof data[k] === 'string' ? data[k] : ''])),
    patterns: ownedPatterns(data), protect: data.default_permissions === PROFILE, migrateLegacy: false };
}

export function validateDraft(value: unknown): Draft {
  if (!isTable(value) || !isTable(value.basics) || !Array.isArray(value.patterns) || value.patterns.length > 200 || typeof value.protect !== 'boolean' || typeof value.migrateLegacy !== 'boolean') throw new UserError(t("設定データが不正です。"));
  const basics: Record<string, string> = {};
  for (const k of BASIC_KEYS) {
    const v = value.basics[k];
    if (typeof v !== 'string' || v.length > 200 || /[\x00-\x1f]/.test(v)) throw new UserError(t("{0} の値が不正です。", k));
    basics[k] = v.trim();
  }
  const patterns = value.patterns.map(p => {
    if (typeof p !== 'string') throw new UserError(t("パターンは文字列で指定してください。"));
    const error = validatePattern(p); if (error) throw new UserError(error); return p;
  });
  return { basics, patterns: [...new Set(patterns)], protect: value.protect, migrateLegacy: value.migrateLegacy };
}

export function applyDraft(text: string, draft: Draft, layers: Layer[] = []): string {
  draft = validateDraft(draft);
  const original = parse(text);
  const initial = makeDraft(original);
  for (const key of BASIC_KEYS) {
    if (draft.basics[key] !== initial.basics[key]) {
      if (key === 'approval_policy' && draft.basics[key] && !['on-request', 'never'].includes(draft.basics[key])) throw new UserError(t("未対応の承認方針です。"));
      if (key === 'web_search' && draft.basics[key] && !['disabled', 'cached', 'live'].includes(draft.basics[key])) throw new UserError(t("未対応の検索設定です。"));
      text = edit(text, [key], draft.basics[key] || undefined);
    }
  }
  if (!draft.protect && (draft.patterns.length || initial.protect)) throw new UserError(t("保護ルールを保存するには「ファイル保護を有効にする」を選択してください。保護の解除はTOMLで直接行ってください。"));
  if (draft.protect) {
    if (layers.some(l => l.error)) throw new UserError(t("読み込めない設定ファイルがあります。診断を確認してください。"));
    const externalLegacy = layers.filter(l => l.data?.sandbox_mode !== undefined || l.data?.sandbox_workspace_write !== undefined);
    if (externalLegacy.length) throw new UserError(t("共通・親設定に旧sandbox設定があります。該当ファイルで先に権限プロファイルへ移行してください。"));
    if (original.sandbox_mode !== undefined || original.sandbox_workspace_write !== undefined) {
      if (!draft.migrateLegacy) throw new UserError(t("旧sandbox設定が競合します。「旧sandbox_modeを移行」を確認してください。"));
      // Preserve nested sandbox_workspace_write settings: silently dropping them could expand access.
      if (original.sandbox_workspace_write !== undefined) throw new UserError(t("sandbox_workspace_write の設定をTOMLで確認し、権限プロファイルへ手動移行してください。"));
      if (!['workspace-write', 'read-only'].includes(String(original.sandbox_mode))) throw new UserError(t("このsandbox_modeは自動移行できません。TOMLで確認してください。"));
      if (original.default_permissions !== undefined || layers.some(l => l.data?.default_permissions !== undefined)) throw new UserError(t("旧sandbox設定と既存の権限プロファイルが混在しています。意図した権限を確認して手動移行してください。"));
      text = edit(text, ['sandbox_mode'], undefined);
    }
    const existingProfile = get(original, ['permissions', PROFILE]) ?? [...layers].reverse().map(l => get(l.data, ['permissions', PROFILE])).find(v => v !== undefined);
    if (!existingProfile) {
      const inherited = [...layers].reverse().map(l => l.data?.default_permissions).find(v => typeof v === 'string');
      const selected = original.default_permissions ?? inherited;
      const parent = selected === PROFILE ? ':workspace' : selected ?? (original.sandbox_mode === 'read-only' ? ':read-only' : ':workspace');
      text = edit(text, ['permissions', PROFILE, 'extends'], String(parent));
    }
    text = edit(text, ['default_permissions'], PROFILE);
    // Explicit high enough depth for typical repositories, exposed in diagnostics.
    if (draft.patterns.some(p => p.includes('**')) && get(parse(text), ['permissions', PROFILE, 'filesystem', 'glob_scan_max_depth']) === undefined) {
      text = edit(text, ['permissions', PROFILE, 'filesystem', 'glob_scan_max_depth'], 20);
    }
    const base = ['permissions', PROFILE, 'filesystem', ':workspace_roots'];
    for (const p of initial.patterns) if (!draft.patterns.includes(p)) text = edit(text, [...base, p], undefined);
    for (const p of draft.patterns) {
      const existing = get(original, [...base, p]);
      if (existing !== undefined && existing !== 'deny') throw new UserError(t("{0} には別の権限があります。TOMLで確認してください。", p));
      text = edit(text, [...base, p], 'deny');
    }
  }
  parse(text);
  return text;
}

export function diagnose(current: Layer, others: Layer[], version: string, trusted: boolean): Issue[] {
  const issues: Issue[] = [];
  for (const l of [...others, current]) {
    if (l.error) issues.push({ level: 'error', message: `${l.name}: ${l.error}` });
    if (l.data?.sandbox_mode !== undefined || l.data?.sandbox_workspace_write !== undefined) issues.push({ level: 'warning', message: t("{0}: 旧sandbox設定があります。権限プロファイルが適用されない可能性があります。", l.name) });
  }
  if (!trusted) issues.push({ level: 'error', message: t("VSCodeで信頼されていないワークスペースです。") });
  issues.push({ level: 'info', message: t("CLI: {0}。IDEに内蔵されたCodexのバージョンとは異なる場合があります。権限プロファイルはベータ機能で、対応バージョンは自動判定していません。", version) });
  issues.push({ level: 'warning', message: t("Codex側でもプロジェクトの信頼が必要です。CLI引数、選択プロファイル、管理ポリシー、子フォルダーの設定はこの画面だけでは確定できません。") });
  issues.push({ level: 'info', message: t("ルールの一致表示はパスのプレビューです。サンドボックス外のMCP、添付内容、実行ログや環境変数から渡る情報は別途管理してください。") });
  if (process.platform !== 'darwin') issues.push({ level: 'warning', message: t("Linux・WSL・Windowsでは ** の事前展開深度に制限があります。新規ファイルや深い階層の保護は実行環境で確認してください。") });
  const depth = get(current.data, ['permissions', PROFILE, 'filesystem', 'glob_scan_max_depth']);
  if (depth !== undefined) issues.push({ level: 'info', message: t("glob事前展開の最大深度: {0}。深度を超えるファイルはプレビューに一致しても保護されない可能性があります。", depth) });
  const parent = get(current.data, ['permissions', PROFILE, 'extends']);
  if (typeof parent === 'string' && !parent.startsWith(':') && ![...others, current].some(l => get(l.data, ['permissions', parent]) !== undefined)) issues.push({ level: 'error', message: t("継承元の権限プロファイル {0} が見つかりません。", parent) });
  return issues;
}

