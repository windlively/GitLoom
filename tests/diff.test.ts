import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDiffRows } from '../webview/src/diff';
import { makeGraph } from '../webview/src/graph';
import type { Commit } from '../src/shared/types';
test('side-by-side diff aligns additions, removals and changed line numbers', () => {
  const rows = makeDiffRows('one\ntwo\nthree\n', 'one\nchanged\nadded\nthree\n');
  assert.deepEqual(
    rows.map((row) => [row.leftNumber, row.rightNumber, row.type]),
    [
      [1, 1, 'same'],
      [2, 2, 'change'],
      [undefined, 3, 'change'],
      [3, 4, 'same'],
    ],
  );
  assert.equal(makeDiffRows('', 'new\n')[0].leftNumber, undefined);
  assert.equal(makeDiffRows('old\n', '')[0].rightNumber, undefined);
});
test('history graph keeps diverging parents in separate lanes and reconnects shared ancestors', () => {
  const commits = [
    { hash: 'merge', parents: ['left', 'right'] },
    { hash: 'left', parents: ['base'] },
    { hash: 'right', parents: ['base'] },
    { hash: 'base', parents: [] },
  ] as Commit[];
  const graph = makeGraph(commits);
  assert.notEqual(graph.nodes[1].lane, graph.nodes[2].lane);
  assert.equal(graph.edges.length, 4);
  assert.ok(graph.edges.every((edge) => !edge.d.includes('NaN')));
});
