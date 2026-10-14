import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage, UserError } from '../src/errors.js';
import { parse } from '../src/toml.js';

test('library errors never expose source excerpts even when secrets contain Japanese', () => {
  try { parse('password = "日本語の機密パスワード\n'); assert.fail('must reject'); }
  catch (error) {
    assert.ok(!errorMessage(error).includes('機密パスワード'));
    assert.ok(!errorMessage(error).includes('password'));
  }
  assert.equal(errorMessage(new UserError('差分を確認してください。')), '差分を確認してください。');
});
