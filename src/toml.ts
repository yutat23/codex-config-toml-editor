import { t } from './i18n.js';
import { UserError } from './errors.js';
import { parseTOML } from 'confbox/toml';

export type Table = Record<string, unknown>;
export const parse = (text: string): Table => parseTOML<Table>(text);
export const isTable = (value: unknown): value is Table => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
export function get(root: unknown, path: string[]): unknown {
  return path.reduce<unknown>((value, key) => isTable(value) && Object.hasOwn(value, key) ? value[key] : undefined, root);
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((key, i) => key === b[i]);
const prefix = (a: string[], b: string[]) => a.length <= b.length && a.every((key, i) => key === b[i]);
const keyText = (key: string) => /^[\w-]+$/.test(key) ? key : JSON.stringify(key);

interface Statement { start: number; end: number; equal: number; valueEnd: number; path: string[]; header: boolean; array: boolean }

function leaf(root: Table): string[] {
  const [key] = Object.keys(root);
  return isTable(root[key]) ? [key, ...leaf(root[key])] : [key];
}
function markerPath(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return markerPath(value[0]);
  if (!isTable(value)) return;
  if (Object.hasOwn(value, '__codex_editor_marker__')) return [];
  for (const [key, child] of Object.entries(value)) {
    const path = markerPath(child);
    if (path) return [key, ...path];
  }
}

/** Locate complete TOML statements without reformatting untouched source. Parsing
 * remains the TOML library's job; the scanner only records source boundaries. */
function statements(text: string): Statement[] {
  const result: Statement[] = [];
  let start = 0, equal = -1, valueEnd = 0, depth = 0;
  let quote = '', triple = false, comment = false;
  let context: string[] = [], arrayContext = false;
  const finish = (end: number) => {
    const raw = text.slice(start, valueEnd).trim();
    if (raw) {
      if (raw.startsWith('[')) {
        context = markerPath(parse(`${raw}\n__codex_editor_marker__ = true`)) ?? [];
        arrayContext = raw.startsWith('[[');
        result.push({ start, end, equal: -1, valueEnd, path: context, header: true, array: arrayContext });
      } else if (equal >= start) {
        const path = leaf(parse(`${text.slice(start, equal).trim()} = 0`));
        result.push({ start, end, equal, valueEnd, path: [...context, ...path], header: false, array: arrayContext });
      }
    }
    start = end; equal = -1; valueEnd = end;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comment) {
      if (c !== '\n') continue;
      comment = false;
    } else if (quote) {
      if (quote === '"' && c === '\\') { i++; valueEnd = i + 1; continue; }
      if (c === quote) {
        if (!triple) quote = '';
        else if (text.slice(i, i + 3) === quote.repeat(3)) {
          while (text[i + 1] === quote) i++;
          quote = ''; triple = false;
        }
      }
      valueEnd = i + 1;
      continue;
    } else if (c === '#') { comment = true; continue; }
    else if (c === '"' || c === "'") {
      quote = c; triple = text.slice(i, i + 3) === c.repeat(3);
      if (triple) i += 2;
      valueEnd = i + 1; continue;
    } else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === '=' && equal < start && depth === 0) equal = i;
    if (c === '\n' && depth === 0) finish(i + 1);
    else if (!/\s/.test(c)) valueEnd = i + 1;
  }
  if (start < text.length) finish(text.length);
  return result;
}

/** Set/remove a scalar while retaining comments, newline style and other keys.
 * Inline parent tables and array tables are intentionally never rewritten. */
export function edit(text: string, path: string[], value: string | number | boolean | undefined): string {
  const data = parse(text);
  if (get(data, path) === value) return text;
  const all = statements(text);
  if (all.some(s => s.array && prefix(s.path, path))) throw new UserError(t("配列テーブル内の設定はTOMLで直接編集してください。"));
  const found = all.find(s => !s.header && same(s.path, path));
  if (found) {
    if (value === undefined) {
      const tail = text.slice(found.valueEnd, found.end);
      const comment = tail.indexOf('#');
      return text.slice(0, found.start) + (comment >= 0 ? tail.slice(comment) : '') + text.slice(found.end);
    }
    let valueStart = found.equal + 1;
    while (/\s/.test(text[valueStart] ?? '') && valueStart < text.length) valueStart++;
    const next = text.slice(0, valueStart) + JSON.stringify(value) + text.slice(found.valueEnd);
    parse(next);
    return next;
  }
  if (all.some(s => !s.header && prefix(s.path, path)) || get(data, path) !== undefined) {
    throw new UserError(t("{0} はインラインテーブル等で定義されています。TOMLで直接編集してください。", path.join('.')));
  }
  if (value === undefined) return text;
  const parent = path.slice(0, -1);
  // Prefer a declared ancestor, writing the remaining suffix as a dotted key.
  const headers = all.filter(s => s.header && !s.array && prefix(s.path, parent));
  const section = headers.sort((a, b) => b.path.length - a.path.length)[0];
  const sectionPath = section?.path ?? [];
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const inSection = () => {
    const at = all.find(s => s.header && s.start >= (section?.end ?? 0))?.start ?? text.length;
    const assignment = `${path.slice(sectionPath.length).map(keyText).join('.')} = ${JSON.stringify(value)}${nl}`;
    return text.slice(0, at) + (at > 0 && text[at - 1] !== '\n' ? nl : '') + assignment + text.slice(at);
  };
  const newTable = () => text + (text.endsWith('\n') || !text ? '' : nl) + nl + `[${parent.map(keyText).join('.')}]${nl}${keyText(path.at(-1)!)} = ${JSON.stringify(value)}${nl}`;
  const candidates = same(sectionPath, parent) ? [inSection()] : [newTable(), inSection()];
  for (const next of candidates) {
    try { if (get(parse(next), path) === value) return next; } catch { /* another legal table spelling may work */ }
  }
  throw new UserError(t("このTOMLの記法では設定を安全に追加できません。TOMLで直接編集してください。"));
}

