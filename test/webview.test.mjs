import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { html } from '../.test-build/view.js';

test('webview handles protection, tabs, literal paths, preview invalidation and save gating', async () => {
  const dom = new JSDOM(html('https://editor.test', 'nonce', '', ''), { runScripts: 'outside-only', url: 'https://editor.test/' });
  const { window } = dom;
  const document = window.document;
  const sent = [];
  window.acquireVsCodeApi = () => ({ postMessage: message => sent.push(message) });
  const $ = id => document.getElementById(id);
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  try {
    window.eval(await readFile('media/editor.js', 'utf8'));
    assert.equal(sent[0].type, 'ready');
    dispatch({ type: 'loaded', root: 'fixture', invalid: false, draft: { basics: { model: '', model_reasoning_effort: '', approval_policy: '', web_search: '' }, patterns: [], protect: false },
      issues: [{ level: 'warning', message: '未検証' }], sources: [], candidates: ['<script>alert(1)</script>.key'], extraRules: [], count: 1 });
    dispatch({ type: 'idle' });
    assert.equal($('save').disabled, true);
    assert.equal($('candidates').querySelector('script'), null);
    assert.match($('candidates').textContent, /<script>/);
    $('preset').click();
    assert.equal(document.querySelectorAll('.pattern').length, 6);
    assert.equal($('protect').checked, true);
    $('pattern').value = 'config/private.json';
    $('addForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(document.querySelectorAll('.pattern').length, 7);
    $('match').click();
    assert.equal(sent.at(-1).type, 'previewFiles');
    $('preview').click();
    const revision = sent.at(-1).revision;
    assert.equal(sent.at(-1).type, 'preview');
    dispatch({ type: 'prepared', revision }); dispatch({ type: 'idle' });
    assert.equal($('save').disabled, false);
    document.querySelector('[data-tab=basics]').click();
    assert.equal($('basics').hidden, false); assert.equal($('protection').hidden, true);
    $('model').value = 'my-model'; $('model').dispatchEvent(new window.Event('input'));
    assert.equal($('save').disabled, true);
    dispatch({ type: 'prepared', revision });
    assert.equal($('save').disabled, true, 'a late preview result cannot enable stale saves');
    dispatch({ type: 'error', message: '競合しています。' });
    assert.equal($('status').textContent, '競合しています。');
    assert.equal($('save').disabled, true);
    $('reload').click();
    assert.equal(sent.at(-1).type, 'reload');
    assert.equal(sent.at(-1).dirty, true);
    dispatch({ type: 'idle' });
    assert.equal(document.querySelector('main').inert, false);
  } finally { window.close(); }
});

test('English webview translates labels, dynamic messages, matches and accessibility names', async () => {
  const dom = new JSDOM(html('https://editor.test', 'nonce', '', '', 'en'), { runScripts: 'outside-only' });
  const { window } = dom;
  const document = window.document;
  const $ = id => document.getElementById(id);
  window.acquireVsCodeApi = () => ({ postMessage() {} });
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  try {
    window.eval(await readFile('media/editor.js', 'utf8'));
    assert.equal(document.documentElement.lang, 'en');
    assert.equal($('model').placeholder, 'Not set (inherit shared settings)');
    dispatch({ type: 'loaded', root: 'fixture', invalid: false, draft: { basics: { model: 'custom-model', model_reasoning_effort: '', approval_policy: '', web_search: '' }, patterns: [], protect: false }, issues: [], sources: [], candidates: ['<script>{0}.key'], extraRules: ['custom-profile'], count: 12, truncated: true });
    dispatch({ type: 'idle' });
    assert.equal($('model').value, 'custom-model');
    assert.match($('status').textContent, /Scanned 12 paths. Scan limit reached/);
    assert.equal($('patterns').textContent, 'No read-deny rules yet.');
    $('preset').click();
    assert.equal($('patternCount').textContent, '6 rules');
    assert.equal(document.querySelector('.pattern button').getAttribute('aria-label'), 'Remove **/.env');
    assert.match($('status').textContent, /Unsaved changes/);
    dispatch({ type: 'matches', rules: [{ pattern: '**/.env', count: 201, files: ['.env'] }], truncated: true });
    assert.equal($('matches').querySelector('summary').textContent, '**/.env: 201 matches');
    dispatch({ type: 'saved' });
    assert.match($('status').textContent, /Saved/);
    assert.doesNotMatch(document.body.textContent.replace('日本語', ''), /[\u3040-\u9fff]/);
    assert.equal(document.querySelector('#candidates script'), null);
  } finally { window.close(); }
});


test('language switching preserves unsaved drafts, active tab, expanded sections and reviewed changes', async () => {
  const dom = new JSDOM(html('https://editor.test', 'nonce', '', '', 'ja'), { runScripts: 'outside-only' });
  const { window } = dom;
  const document = window.document;
  const $ = id => document.getElementById(id);
  const sent = [];
  window.acquireVsCodeApi = () => ({ postMessage: message => sent.push(message) });
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  try {
    window.eval(await readFile('media/editor.js', 'utf8'));
    dispatch({ type: 'loaded', root: 'fixture', invalid: false, draft: { basics: { model: '', model_reasoning_effort: '', approval_policy: 'custom', web_search: '' }, patterns: [], protect: false }, issues: [], sources: [], candidates: ['secret.key'], extraRules: [], count: 12, truncated: true });
    dispatch({ type: 'idle' });
    $('preset').click();
    $('model').value = 'draft-model'; $('model').dispatchEvent(new window.Event('input'));
    $('pattern').value = 'unfinished/path';
    document.querySelector('[data-tab=basics]').click();
    document.querySelector('.advanced-card').open = true;
    $('migrateLegacy').checked = true;
    $('preview').click();
    const revision = sent.at(-1).revision;
    dispatch({ type: 'prepared', revision }); dispatch({ type: 'idle' });
    assert.equal($('save').disabled, false);
    const englishInfo = { issues: [{ level: 'warning', message: 'Check project trust.' }], sources: [], candidates: ['secret.key'], extraRules: [] };
    $('language').value = 'en'; $('language').dispatchEvent(new window.Event('change'));
    assert.equal(sent.at(-1).type, 'setLanguage');
    assert.equal(sent.at(-1).choice, 'en');
    assert.equal($('language').disabled, true);
    dispatch({ type: 'language', locale: 'en', choice: 'en', info: englishInfo }); dispatch({ type: 'idle' });
    assert.equal(document.documentElement.lang, 'en');
    assert.equal($('model').value, 'draft-model');
    assert.equal($('approval_policy').value, 'custom');
    assert.equal($('pattern').value, 'unfinished/path');
    assert.equal($('migrateLegacy').checked, true);
    assert.equal($('protect').checked, true);
    assert.equal($('save').disabled, false);
    assert.equal($('basics').hidden, false);
    assert.equal(document.querySelector('.advanced-card').open, true);
    assert.equal($('patternCount').textContent, '6 rules');
    assert.match($('status').textContent, /Diff opened/);
    assert.equal($('root').textContent, 'fixture / .codex/config.toml');
    assert.equal($('issues').textContent, 'Check project trust.');
    assert.doesNotMatch(document.body.textContent.replace('日本語', ''), /[\u3040-\u9fff]/);
    $('language').value = 'auto'; $('language').dispatchEvent(new window.Event('change'));
    dispatch({ type: 'language', locale: 'ja', choice: 'auto', info: { ...englishInfo, issues: [] } }); dispatch({ type: 'idle' });
    assert.equal($('model').placeholder, '未指定（共通設定を継承）');
    assert.equal($('language').value, 'auto');
    assert.match($('status').textContent, /差分を開きました/);
    $('save').click();
    assert.equal(sent.at(-1).type, 'save');
    assert.equal(sent.at(-1).revision, revision);
    assert.equal(sent.at(-1).draft.basics.model, 'draft-model');
  } finally { window.close(); }
});
