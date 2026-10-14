import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edit, get, parse } from '../src/toml.js';

test('only a changed value is replaced; comments, unknown fields and CRLF survive', () => {
  const input = '# hello\r\nmodel = "old"  # choice\r\nunknown = { x = 2 }\r\n';
  assert.equal(edit(input, ['model'], 'new'), input.replace('"old"', '"new"'));
});
test('a new root key is inserted before tables, never into the last table', () => {
  const input = '[mcp_servers.test]\ncommand = "node"\n';
  const next = edit(input, ['model'], 'test');
  assert.equal(parse(next).model, 'test');
  assert.equal(get(parse(next), ['mcp_servers', 'test', 'model']), undefined);
});
test('multiline strings containing fake sections and keys remain untouched', () => {
  const input = 'notes = """\nmodel = "fake"\n[permissions.test]\n# hi\n"""\nmodel = "old"\n';
  const next = edit(input, ['model'], 'new');
  assert.equal(next, input.replace('model = "old"', 'model = "new"'));
});
test('multiline arrays with comments and quoted hashes remain intact', () => {
  const input = 'things = [\n "a#b", # comment\n "c"\n]\nmodel = "old"\n';
  assert.equal(edit(input, ['model'], 'new'), input.replace('"old"', '"new"'));
});
test('quoted and dotted keys can be changed without reformatting', () => {
  const input = '[permissions."p.x".filesystem.":workspace_roots"]\n"**/.env" = "deny" # secret files\n';
  const next = edit(input, ['permissions', 'p.x', 'filesystem', ':workspace_roots', '**/.env'], 'read');
  assert.equal(next, input.replace('"deny"', '"read"'));
});
test('removing a field preserves its trailing explanatory comment', () => {
  const next = edit('model = "old" # explanation\nx = 2\n', ['model'], undefined);
  assert.equal(next, '# explanation\nx = 2\n');
});
test('inline parent tables are refused instead of silently replaced', () => {
  assert.throws(() => edit('permissions = { p = { extends = ":workspace" } }\n', ['permissions', 'p', 'extends'], ':read-only'), /直接編集/);
});
test('array-table values are never confused with scalar settings', () => {
  assert.throws(() => edit('[[agents]]\nmodel = "old"\n', ['agents', 'model'], 'new'), /配列テーブル/);
});
test('invalid TOML fails before any changes', () => {
  assert.throws(() => edit('model = [', ['model'], 'new'));
});
test('implicit table can receive a new sibling without changing existing data', () => {
  const input = '[permissions.p.filesystem]\n":root" = "read"\n';
  const next = edit(input, ['permissions', 'p', 'extends'], ':workspace');
  assert.equal(get(parse(next), ['permissions', 'p', 'filesystem', ':root']), 'read');
  assert.equal(get(parse(next), ['permissions', 'p', 'extends']), ':workspace');
});
test('literal multiline strings and escaped quotes do not confuse boundaries', () => {
  const input = `note = '''\n[model]\n'''\nother = "escaped \\\"#"\nmodel = "old"\n`;
  assert.equal(edit(input, ['model'], 'new'), input.replace('"old"', '"new"'));
});
