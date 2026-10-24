import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDiffRows } from '../webview/src/diff';
import { graphColors, graphColumnWidth, makeGraph } from '../webview/src/graph';
import { offsetRange, uniformRange } from '../webview/src/virtual';
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
const commit = (hash: string, parents: string[] = []): Commit => ({
  hash,
  parents,
  author: '',
  email: '',
  date: '',
  subject: '',
  refs: [],
});

test('history graph keeps diverging parents in compact lanes and merges duplicate lanes', () => {
  const commits = [
    commit('merge', ['left', 'right']),
    commit('left', ['base']),
    commit('right', ['base']),
    commit('base'),
  ];
  const graph = makeGraph(commits);
  assert.deepEqual(
    graph.nodes.map((node) => node.lane),
    [0, 0, 1, 0],
  );
  assert.equal(graph.nodes[2].color, graphColors[1]);
  assert.equal(graph.nodes[3].color, graphColors[0]);
  assert.ok(graph.edges.every((edge) => !edge.d.includes('NaN')));

  const mergeToRight = graph.edges.find((edge) => edge.key === 'merge-merge-1')!;
  assert.equal(mergeToRight.color, graphColors[1]);
  assert.equal(mergeToRight.d, 'M 12 12 A 12 12 0 0 1 24 24 M 12 12 H 12');

  const duplicateMerge = graph.edges.find((edge) => edge.key === 'base-base-1')!;
  assert.equal(duplicateMerge.color, graphColors[1]);
  assert.equal(duplicateMerge.d, 'M 24 72 A 12 12 0 0 1 12 84 H 12');
});

test('history graph compacts lanes when a branch ends and shifts remaining lanes', () => {
  const commits = [commit('merge', ['end', 'side']), commit('end'), commit('side')];
  const graph = makeGraph(commits);
  assert.deepEqual(
    graph.nodes.map((node) => node.lane),
    [0, 0, 0],
  );
  assert.equal(graph.nodes[1].color, graphColors[0]);
  assert.equal(graph.nodes[2].color, graphColors[1]);

  const shift = graph.edges.find((edge) => edge.key === 'end-shift-1')!;
  assert.equal(shift.color, graphColors[1]);
  assert.equal(shift.d, 'M 24 24 V 30 A 5 5 0 0 1 19 36 H 17 A 5 5 0 0 0 12 41 V 48');
});

test('history graph indexes edges by row so a visible window draws only its own edges', () => {
  const commits = [
    commit('merge', ['left', 'right']),
    commit('left', ['base']),
    commit('right', ['base']),
    commit('base'),
  ];
  const graph = makeGraph(commits);
  assert.equal(graph.rowEdges.length, commits.length + 1);
  assert.equal(graph.rowEdges[0], 0);
  assert.equal(graph.rowEdges[commits.length], graph.edges.length);
  for (let row = 0; row < commits.length; row++) {
    const edges = graph.edges.slice(graph.rowEdges[row], graph.rowEdges[row + 1]);
    assert.ok(edges.every((edge) => edge.key.startsWith(`${commits[row].hash}-`)));
  }
});

test('history graph reports per-row lane counts so the column can follow the visible rows', () => {
  const commits = [
    commit('merge', ['a', 'b', 'c', 'd', 'e']),
    commit('a'),
    commit('b'),
    commit('c'),
    commit('d'),
    commit('e'),
  ];
  const graph = makeGraph(commits);
  // The fan-out row needs five lanes, the last row needs one, so a window near the
  // bottom stays narrow instead of reserving the width of the whole history.
  assert.deepEqual(graph.rowLanes, [5, 5, 4, 3, 2, 1]);
  assert.equal(graph.rowLanes.length, commits.length);
  assert.equal(graph.width, 76);
  assert.equal(graphColumnWidth(1), 64);
  assert.equal(graphColumnWidth(44), 544);
});

test('virtual ranges cover the viewport with overscan and stay inside the list', () => {
  assert.deepEqual(uniformRange(5000, 24, { top: 24 * 1000, height: 240 }), [988, 1022]);
  assert.deepEqual(uniformRange(10, 24, { top: 24 * 1000, height: 240 }), [10, 10]);
  assert.deepEqual(uniformRange(0, 24, { top: 0, height: 0 }), [0, 0]);
  const offsets = [0, 24, 46, 68, 92, 114];
  assert.deepEqual(offsetRange(offsets, { top: 50, height: 20 }), [0, 5]);
  assert.deepEqual(offsetRange([0], { top: 0, height: 100 }), [0, 0]);
  const many = Array.from({ length: 2001 }, (_, index) => index * 22);
  assert.deepEqual(offsetRange(many, { top: 22 * 900, height: 220 }), [888, 923]);
});
