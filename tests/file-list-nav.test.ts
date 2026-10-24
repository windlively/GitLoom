import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFileListKey, nextRowIndex, rowIndex } from '../webview/src/file-list-nav';

test('recognizes only the file list navigation keys', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.equal(isFileListKey(key), true, key);
  for (const key of ['Enter', 'ArrowLeft', ' ', 'a', 'PageDown'])
    assert.equal(isFileListKey(key), false, key);
});

test('moves one logical row per arrow key and clamps at both ends', () => {
  assert.equal(nextRowIndex('ArrowDown', 0, 5), 1);
  assert.equal(nextRowIndex('ArrowUp', 4, 5), 3);
  assert.equal(nextRowIndex('ArrowDown', 4, 5), 4);
  assert.equal(nextRowIndex('ArrowUp', 0, 5), 0);
  assert.equal(nextRowIndex('ArrowDown', 2, 1), 0);
});

test('starts from the first row downwards and the last row upwards', () => {
  assert.equal(nextRowIndex('ArrowDown', -1, 7), 0);
  assert.equal(nextRowIndex('ArrowUp', -1, 7), 6);
  assert.equal(nextRowIndex('Home', -1, 7), 0);
  assert.equal(nextRowIndex('End', 3, 7), 6);
});

test('reaches the logical ends instead of the rendered window', () => {
  // The change list renders only a window around the viewport, so End/Home must use
  // the full file count; a rendered-window bound stopped several rows short.
  assert.equal(nextRowIndex('End', 0, 1200), 1199);
  assert.equal(nextRowIndex('Home', 800, 1200), 0);
  assert.equal(nextRowIndex('ArrowDown', 1199, 1200), 1199);
});

test('reports an empty list as unhandled', () => {
  assert.equal(nextRowIndex('ArrowDown', 0, 0), -1);
  assert.equal(nextRowIndex('End', -1, 0), -1);
});

test('finds the row that owns the focused element', () => {
  const rows = ['a', 'b', 'c'].map((id) => ({ id, contains: () => false })) as unknown as Element[];
  assert.equal(rowIndex(rows, rows[1]), 1);
  assert.equal(rowIndex(rows, null), -1);
  assert.equal(rowIndex(rows, { id: 'missing' } as unknown as Element), -1);
  const nested = { id: 'nested' } as unknown as Element;
  (rows[2] as unknown as { contains: (node: Element) => boolean }).contains = (node) => node === nested;
  assert.equal(rowIndex(rows, nested), 2);
});
