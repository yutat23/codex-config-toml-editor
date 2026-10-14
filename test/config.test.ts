import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDraft, diagnose, isCandidate, layer, makeDraft, matches, PROFILE, validatePattern, type Draft } from '../src/config.js';
import { get, parse } from '../src/toml.js';

function protection(text = ''): Draft { return { ...makeDraft(parse(text)), protect: true, patterns: ['**/.env', '**/.env.*'] }; }

test('a new protection config is valid, selected and scoped to workspace roots', () => {
  const result = parse(applyDraft('', protection()));
  assert.equal(result.default_permissions, PROFILE);
  assert.equal(get(result, ['permissions', PROFILE, 'extends']), ':workspace');
  assert.equal(get(result, ['permissions', PROFILE, 'filesystem', ':workspace_roots', '**/.env']), 'deny');
  assert.equal(get(result, ['permissions', PROFILE, 'filesystem', 'glob_scan_max_depth']), 20);
});
test('creating a protection profile inherits the existing custom permissions', () => {
  const input = 'default_permissions = "locked"\n[permissions.locked]\nextends = ":read-only"\n';
  const result = parse(applyDraft(input, protection(input)));
  assert.equal(get(result, ['permissions', PROFILE, 'extends']), 'locked');
  assert.equal(get(result, ['permissions', 'locked', 'extends']), ':read-only');
});
test('a common permission profile is inherited without weakening it', () => {
  const common = layer('user', 'default_permissions = "locked"\n[permissions.locked]\nextends = ":read-only"\n');
  assert.equal(get(parse(applyDraft('', protection(), [common])), ['permissions', PROFILE, 'extends']), 'locked');
});
test('an existing common protection profile is never overwritten with workspace access', () => {
  const common = layer('user', `default_permissions = "${PROFILE}"\n[permissions.${PROFILE}]\nextends = ":read-only"\n`);
  const result = parse(applyDraft('', protection(), [common]));
  assert.equal(get(result, ['permissions', PROFILE, 'extends']), undefined);
});
test('only owned deny rules are removed; unrelated profile and read rules survive', () => {
  const input = applyDraft('', protection()) + '\n[permissions.other]\nextends = ":read-only"\n';
  const draft = makeDraft(parse(input)); draft.patterns = ['**/.env'];
  const next = applyDraft(input, draft);
  assert.equal(get(parse(next), ['permissions', PROFILE, 'filesystem', ':workspace_roots', '**/.env.*']), undefined);
  assert.equal(get(parse(next), ['permissions', 'other', 'extends']), ':read-only');
});
test('basic edits leave granular approvals, unknown tables and protection untouched', () => {
  const input = '# keep\napproval_policy = { granular = { rules = false } }\nunknown = "value"\n';
  const draft = makeDraft(parse(input)); draft.basics.model = 'my-model';
  const next = applyDraft(input, draft);
  assert.equal(get(parse(next), ['approval_policy', 'granular', 'rules']), false);
  assert.ok(next.includes(input));
});
test('legacy sandbox is blocked until explicit migration', () => {
  const input = 'sandbox_mode = "read-only"\n';
  assert.throws(() => applyDraft(input, protection(input)), /移行/);
  const draft = protection(input); draft.migrateLegacy = true;
  const result = parse(applyDraft(input, draft));
  assert.equal(result.sandbox_mode, undefined);
  assert.equal(get(result, ['permissions', PROFILE, 'extends']), ':read-only');
});
test('legacy nested sandbox configuration requires manual migration', () => {
  const input = 'sandbox_mode = "workspace-write"\n[sandbox_workspace_write]\nnetwork_access = true\n';
  const draft = protection(input); draft.migrateLegacy = true;
  assert.throws(() => applyDraft(input, draft), /手動移行/);
});
test('external legacy configuration and unreadable layers block protection saves', () => {
  assert.throws(() => applyDraft('', protection(), [layer('user', 'sandbox_mode = "workspace-write"')]), /共通・親/);
  assert.throws(() => applyDraft('', protection(), [layer('user', 'bad = [')]), /読み込めない/);
});
test('mixed old and new permissions cannot accidentally turn a read-only sandbox writable', () => {
  const input = 'sandbox_mode = "read-only"\ndefault_permissions = ":workspace"\n';
  const draft = protection(input); draft.migrateLegacy = true;
  assert.throws(() => applyDraft(input, draft), /手動移行/);
});
test('patterns cannot escape the repository or use unsupported glob syntax', () => {
  for (const pattern of ['../secret', '/etc/passwd', 'C:/secret', '~/.ssh', '**', '**/*', 'a\\b', 'a\nb', '**/[abc]', '!public']) assert.ok(validatePattern(pattern), pattern);
  for (const pattern of ['.env', '**/.env.*', 'config/private.json', 'secret folder']) assert.equal(validatePattern(pattern), undefined, pattern);
});
test('preview matches hidden files, nested .env variants and folder subtrees', () => {
  assert.ok(matches('.env', '**/.env'));
  assert.ok(matches('server/.env.production', '**/.env.*'));
  assert.ok(matches('.private/config.json', '.private'));
  assert.ok(!matches('server/.env.example', '**/.env'));
  assert.ok(!matches('secret-other/file', 'secret'));
});
test('secret candidates include common .NET settings and SSH keys', () => {
  assert.ok(isCandidate('server/appsettings.Production.json'));
  assert.ok(isCandidate('keys/id_ed25519'));
  assert.ok(!isCandidate('src/index.ts'));
});
test('diagnostics report conflict and never claim runtime protection', () => {
  const issues = diagnose(layer('project', 'sandbox_mode = "workspace-write"'), [], 'codex-cli 0.162.1', true);
  assert.ok(issues.some(i => i.message.includes('旧sandbox')));
  assert.ok(issues.some(i => i.message.includes('パスのプレビュー')));
});
test('unchanged unknown enums survive while newly introduced invalid enums are rejected', () => {
  const input = 'web_search = "future-mode"\n';
  const draft = makeDraft(parse(input)); draft.basics.model = 'example';
  assert.equal(parse(applyDraft(input, draft)).web_search, 'future-mode');
  draft.basics.web_search = 'invalid';
  assert.throws(() => applyDraft(input, draft), /未対応/);
});
test('saving an unchanged configuration is idempotent', () => {
  const text = applyDraft('', protection());
  assert.equal(applyDraft(text, makeDraft(parse(text))), text);
});
test('diagnostics do not disclose parser error excerpts containing secrets', () => {
  const current = layer('project', 'password = "super-secret\n');
  assert.ok(!JSON.stringify(diagnose(current, [], '', true)).includes('super-secret'));
});
