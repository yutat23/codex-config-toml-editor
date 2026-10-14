import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguage, setLanguage, t, translate } from '../src/i18n.js';
import { diagnose, layer, validateDraft, validatePattern } from '../src/config.js';
import { errorMessage } from '../src/errors.js';

test('locale selection handles Japanese variants and falls back to English', () => {
  for (const locale of ['ja', 'ja-JP', 'JA-jp']) assert.equal(resolveLanguage(locale), 'ja');
  for (const locale of ['en', 'en-US', 'de', '']) assert.equal(resolveLanguage(locale), 'en');
  assert.equal(translate('en', '{0} を削除', '<secret>{1}.key'), 'Remove <secret>{1}.key');
  assert.equal(translate('ja', '{0} を削除', 'test.key'), 'test.key を削除');
});

test('English validation and diagnostics retain safe error handling and user values', () => {
  setLanguage('en');
  try {
    assert.match(validatePattern('../private')!, /repository-relative/);
    assert.throws(() => validateDraft(null), /Invalid configuration data/);
    const current = layer('Repository', 'password = "secret\n');
    const issues = diagnose(current, [], 'codex-cli test', true);
    assert.ok(issues.length > 1);
    for (const issue of issues) {
      assert.doesNotMatch(issue.message, /[\u3040-\u9fff]/);
      assert.ok(!issue.message.includes('secret'));
    }
    assert.equal(errorMessage(new Error('password = secret')), 'Unable to complete the operation. Check TOML syntax and file access permissions.');
    assert.equal(t('モデル名'), 'Model name');
  } finally { setLanguage('ja'); }
});
