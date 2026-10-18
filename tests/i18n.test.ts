import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeLocale, translate, zhCN } from '../src/shared/i18n';

const placeholders = (text: string) => [...text.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();

test('normalizes VS Code language identifiers', () => {
  assert.equal(normalizeLocale('zh-cn'), 'zh-cn');
  assert.equal(normalizeLocale('zh-TW'), 'zh-cn');
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('de'), 'en');
  assert.equal(normalizeLocale(undefined), 'en');
});

test('translates known keys and interpolates placeholders', () => {
  assert.equal(translate('en', 'Staged {0} files.', 3), 'Staged 3 files.');
  assert.equal(translate('zh-cn', 'Staged {0} files.', 3), '已暂存 3 个文件。');
  assert.equal(translate('en', 'Unknown message'), 'Unknown message');
  assert.equal(translate('zh-cn', 'Unknown message'), 'Unknown message');
  assert.equal(translate('en', 'Staged {0} files.'), 'Staged {0} files.');
});

test('translation catalog keeps placeholders and every value', () => {
  for (const [key, value] of Object.entries(zhCN)) {
    assert.ok(value.trim(), `missing translation for ${JSON.stringify(key)}`);
    assert.deepEqual(
      placeholders(value),
      placeholders(key),
      `placeholder mismatch for ${JSON.stringify(key)}`,
    );
  }
});

test('manifest placeholders exist in both VS Code language files', () => {
  const manifest = readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
  const english = JSON.parse(readFileSync(path.join(process.cwd(), 'package.nls.json'), 'utf8'));
  const chinese = JSON.parse(readFileSync(path.join(process.cwd(), 'package.nls.zh-cn.json'), 'utf8'));
  const keys = new Set([...manifest.matchAll(/%([^%]+)%/g)].map((match) => match[1]));
  assert.ok(keys.size > 0);
  for (const key of keys) {
    assert.ok(english[key], `missing package.nls.json entry for ${key}`);
    assert.ok(chinese[key], `missing package.nls.zh-cn.json entry for ${key}`);
  }
});
