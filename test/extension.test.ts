import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { activate } from '../src/extension.js';
import { state, Uri, env } from './vscode-mock.js';
import { parse } from '../src/toml.js';

async function message(value: unknown) {
  const start = state.messages.length;
  state.handler!(value);
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const messages = state.messages.slice(start);
    if (messages.some(m => m.type === 'idle')) return messages;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('message timed out');
}

for (const locale of ['ja', 'en']) {
test(`${locale}: extension preview/save lifecycle blocks stale writes, preserves source and refuses symlink targets`, async () => {
  env.language = locale;
  const subscriptions: { dispose(): void }[] = [];
  const stored = new Map<string, unknown>();
  const globalState = { get: (key: string) => stored.get(key), update: async (key: string, value: unknown) => { stored.set(key, value); } };
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-config-test-'));
  state.root = root;
  const config = path.join(root, '.codex/config.toml');
  try {
    activate({ extensionUri: Uri.file(process.cwd()), subscriptions, globalState } as any);
    await state.commands.get('codexConfig.open')!();
    let messages = await message({ type: 'ready' });
    const loaded = messages.find(m => m.type === 'loaded');
    assert.ok(loaded);
    assert.ok(state.html.includes(`lang="${locale}"`));
    if (locale === 'en') {
      for (const issue of loaded.issues) assert.doesNotMatch(issue.message, /[\u3040-\u9fff]/);
      assert.equal(loaded.sources.at(-1).name, 'Repository .codex/config.toml');
    }
    assert.deepEqual(loaded.candidates, ['.env']);
    const draft = loaded.draft; draft.protect = true; draft.patterns = ['**/.env'];
    messages = await message({ type: 'save' });
    assert.ok(messages.some(m => m.type === 'error' && m.message.includes(locale === 'ja' ? '差分' : 'Preview')));
    messages = await message({ type: 'preview', draft, revision: 1 });
    assert.ok(messages.some(m => m.type === 'prepared' && m.revision === 1));
    assert.equal(state.diff?.[0], 'vscode.diff');
    await assert.rejects(readFile(config));
    const other = locale === 'ja' ? 'en' : 'ja';
    messages = await message({ type: 'setLanguage', choice: other });
    assert.equal(stored.get('editorLanguage'), other);
    assert.equal(messages.find(m => m.type === 'language').locale, other);
    messages = await message({ type: 'setLanguage', choice: 'invalid' });
    assert.equal(stored.get('editorLanguage'), other);
    messages = await message({ type: 'setLanguage', choice: 'auto' });
    assert.equal(messages.find(m => m.type === 'language').locale, locale);
    messages = await message({ type: 'rescan', scanLimit: 1 });
    let scanned = messages.find(m => m.type === 'scanned');
    assert.equal(scanned.count, 1);
    assert.equal(scanned.truncated, true);
    assert.equal(state.scanRequests?.at(-1), 2);
    assert.equal(stored.get(`scanLimit:${Uri.file(root).toString()}`), 1);
    messages = await message({ type: 'rescan', scanLimit: 2 });
    scanned = messages.find(m => m.type === 'scanned');
    assert.equal(scanned.count, 2);
    assert.equal(scanned.truncated, false);
    assert.equal(state.scanRequests?.at(-1), 3);
    for (const limit of [0, -1, 1.5, '3', 1000001]) {
      messages = await message({ type: 'rescan', scanLimit: limit });
      assert.ok(messages.some(m => m.type === 'error' && m.operation === 'rescan'));
      assert.equal(stored.get(`scanLimit:${Uri.file(root).toString()}`), 2);
    }
    state.scanError = true;
    messages = await message({ type: 'rescan', scanLimit: 3 });
    state.scanError = false;
    assert.ok(messages.some(m => m.type === 'error' && m.operation === 'rescan'));
    assert.equal(stored.get(`scanLimit:${Uri.file(root).toString()}`), 2);
    // Language changes and rescans must preserve the prepared preview.
    messages = await message({ type: 'save' });
    assert.ok(messages.some(m => m.type === 'saved'));
    assert.equal(parse(await readFile(config, 'utf8')).default_permissions, 'repository-protection');

    const next = messages.find(m => m.type === 'loaded').draft;
    next.basics.model = 'test-model';
    messages = await message({ type: 'preview', draft: next, revision: 2 });
    assert.ok(messages.some(m => m.type === 'prepared'));
    await writeFile(config, (await readFile(config, 'utf8')) + '# external edit\n');
    messages = await message({ type: 'save' });
    assert.ok(messages.some(m => m.type === 'error' && m.message.includes(locale === 'ja' ? '変更' : 'changed')));
    assert.ok((await readFile(config, 'utf8')).endsWith('# external edit\n'));

    await message({ type: 'reload' });
    messages = await message({ type: 'preview', draft: next, revision: 3 });
    assert.ok(messages.some(m => m.type === 'prepared'));
    state.handler!({ type: 'invalidate' });
    messages = await message({ type: 'save' });
    assert.ok(messages.some(m => m.type === 'error' && m.message.includes(locale === 'ja' ? '差分' : 'Preview')));

    const outside = path.join(root, 'external');
    await mkdir(outside); await writeFile(path.join(outside, 'config.toml'), '');
    await rm(path.join(root, '.codex'), { recursive: true });
    await symlink(outside, path.join(root, '.codex'));
    messages = await message({ type: 'reload' });
    const symlinkDraft = messages.find(m => m.type === 'loaded').draft;
    symlinkDraft.basics.model = 'changed';
    messages = await message({ type: 'preview', draft: symlinkDraft });
    assert.ok(messages.some(m => m.type === 'error' && m.message.includes(locale === 'ja' ? 'シンボリックリンク' : 'symbolic link')));
    assert.equal(await readFile(path.join(outside, 'config.toml'), 'utf8'), '');
    await message({ type: 'setLanguage', choice: other });
    subscriptions.forEach(subscription => subscription.dispose());
    subscriptions.length = 0;
    activate({ extensionUri: Uri.file(process.cwd()), subscriptions, globalState } as any);
    await state.commands.get('codexConfig.open')!();
    assert.ok(state.html.includes(`lang="${other}"`));
    messages = await message({ type: 'ready' });
    assert.equal(messages.find(m => m.type === 'loaded').scanLimit, 2);
  } finally {
    subscriptions.forEach(subscription => subscription.dispose());
    env.language = 'ja';
    state.scanError = false;
    await rm(root, { recursive: true, force: true });
  }
});
}
