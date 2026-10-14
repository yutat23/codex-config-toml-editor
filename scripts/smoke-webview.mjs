import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

await build({ entryPoints: ['src/view.ts'], outfile: '.test-build/view.js', bundle: true, platform: 'node', format: 'esm' });
const { html } = await import('../.test-build/view.js');
await mkdir('artifacts', { recursive: true });
const css = await readFile('media/editor.css', 'utf8');
const js = await readFile('media/editor.js', 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  for (const locale of ['ja', 'en']) {
    const suffix = locale === 'en' ? '-en' : '';
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = {
      type: 'loaded', root: 'sample-repository', draft: { basics: { model: '', model_reasoning_effort: '', approval_policy: '', web_search: '' }, patterns: [], protect: false, migrateLegacy: false },
      invalid: false, issues: [{ level: 'warning', message: locale === 'ja' ? 'Codex側でもプロジェクトの信頼が必要です。' : 'Codex must trust this project.' }],
      sources: [{ name: locale === 'ja' ? 'リポジトリ' : 'Repository', values: { model: locale === 'ja' ? '未設定' : 'Not set', model_reasoning_effort: locale === 'ja' ? '未設定' : 'Not set', approval_policy: locale === 'ja' ? '未設定' : 'Not set', web_search: locale === 'ja' ? '未設定' : 'Not set', default_permissions: locale === 'ja' ? '未設定' : 'Not set' } }],
      candidates: ['.env', 'server/appsettings.Production.json', '<script>alert(1)</script>.key'], extraRules: [], count: 36, truncated: false
    };
    await page.addInitScript(({ fixture, locale }) => {
      window.sent = [];
      window.acquireVsCodeApi = () => ({ postMessage(message) {
        window.sent.push(message);
        if (message.type === 'ready') setTimeout(() => { window.dispatchEvent(new MessageEvent('message', { data: fixture })); window.dispatchEvent(new MessageEvent('message', { data: { type: 'idle' } })); }, 0);
        if (message.type === 'setLanguage') setTimeout(() => {
          const language = message.choice === 'auto' ? locale : message.choice;
          const info = { ...fixture,
            issues: [{ level: 'warning', message: language === 'ja' ? 'Codex側でもプロジェクトの信頼が必要です。' : 'Codex must trust this project.' }],
            sources: [{ name: language === 'ja' ? 'リポジトリ' : 'Repository', values: Object.fromEntries(Object.keys(fixture.sources[0].values).map(key => [key, language === 'ja' ? '未設定' : 'Not set'])) }]
          };
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'language', locale: language, choice: message.choice, info } }));
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'idle' } }));
        }, 0);
        if (message.type === 'preview') setTimeout(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'prepared', revision: message.revision } })); window.dispatchEvent(new MessageEvent('message', { data: { type: 'idle' } })); }, 0);
      } });
    }, { fixture, locale });
    const theme = `:root { --vscode-foreground:#ddd; --vscode-editor-background:#1e1e1e; --vscode-input-background:#313131; --vscode-input-foreground:#ddd; --vscode-descriptionForeground:#aaa; --vscode-button-secondaryBackground:#383838; --vscode-button-secondaryForeground:#ddd; --vscode-textBlockQuote-background:#292929; --vscode-focusBorder:#3794ff; } body {background:var(--vscode-editor-background)} @media(prefers-color-scheme:light){:root{--vscode-foreground:#222;--vscode-editor-background:#fff;--vscode-input-background:#fafafa;--vscode-input-foreground:#222;--vscode-descriptionForeground:#666;--vscode-button-secondaryBackground:#eee;--vscode-button-secondaryForeground:#333;--vscode-textBlockQuote-background:#f4f4f4}}`;
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.route('https://editor.test/**', route => {
      const url = route.request().url();
      const [contentType, body] = url.endsWith('editor.css') ? ['text/css', theme + css] : url.endsWith('editor.js') ? ['text/javascript', js] : ['text/html', html('https://editor.test', 'smoke', 'https://editor.test/editor.css', 'https://editor.test/editor.js', locale)];
      return route.fulfill({ contentType, body });
    });
    await page.goto('https://editor.test/');
    await page.waitForFunction(() => document.querySelector('main').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('html').getAttribute('lang'), locale);
    assert.equal(await page.locator('#save').isEnabled(), false);
    await page.locator('#preset').click();
    assert.equal(await page.locator('.pattern').count(), 6);
    assert.equal(await page.locator('#protect').isChecked(), true);
    await page.locator('#pattern').fill('config/private.json');
    await page.locator('#addForm button').click();
    assert.equal(await page.locator('.pattern').count(), 7);
    await page.locator('#match').click();
    assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'previewFiles' && m.draft.patterns.includes('config/private.json'))));
    await page.locator('#preview').click();
    await page.waitForFunction(() => !document.querySelector('#save').disabled);
    const other = locale === 'ja' ? 'en' : 'ja';
    await page.locator('#language').selectOption(other);
    await page.waitForFunction(language => document.documentElement.lang === language && !document.querySelector('#language').disabled, other);
    assert.equal(await page.locator('#save').isEnabled(), true);
    assert.equal(await page.locator('.pattern').count(), 7);
    await page.locator('#language').selectOption('auto');
    await page.waitForFunction(language => document.documentElement.lang === language && !document.querySelector('#language').disabled, locale);
    assert.equal(await page.locator('#save').isEnabled(), true);
    await page.screenshot({ path: `artifacts/protection-dark${suffix}.png`, fullPage: true });
    await page.locator('[data-tab="basics"]').click();
    await page.screenshot({ path: `artifacts/basics${suffix}.png`, fullPage: true });
    await page.locator('#model').fill('my-model');
    assert.equal(await page.locator('#save').isEnabled(), false);
    await page.locator('[data-tab="diagnostics"]').click();
    assert.equal(await page.locator('#issues .issue').count(), 1);
    await page.setViewportSize({ width: 400, height: 900 });
    await page.locator('[data-tab="protection"]').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `artifacts/protection-narrow${suffix}.png`, fullPage: true });
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({ path: `artifacts/protection-light${suffix}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Japanese/English webview smoke passed: language switching, patterns, preview, stale preview invalidation, tabs, escaping, dark/light and narrow layout.');
} finally { await browser.close(); }
