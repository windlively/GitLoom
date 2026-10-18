import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Branch } from '../src/shared/types';
import { groupBranches, type BranchListEntry } from '../webview/src/branch-groups';

const branch = (name: string, remote = false): Branch => ({
  name,
  remote,
  current: false,
  upstream: '',
  subject: '',
});
const describe = (entries: BranchListEntry[], depth = 0): string[] =>
  entries.flatMap((entry) =>
    entry.kind === 'branch'
      ? [`${'  '.repeat(depth)}${entry.label}`]
      : [
          `${'  '.repeat(depth)}${entry.name}(${entry.count})`,
          ...describe(entry.folders, depth + 1),
          ...entry.branches.map((item) => `${'  '.repeat(depth + 1)}${item.label}`),
        ],
  );

test('branch grouping builds nested namespace folders and strips remote names', () => {
  assert.deepEqual(
    describe(
      groupBranches([
        branch('feature/project-search'),
        branch('main'),
        branch('feature/command-menu'),
        branch('hotfix/login'),
      ]),
    ),
    ['feature(2)', '  command-menu', '  project-search', 'hotfix(1)', '  login', 'main'],
  );
  assert.deepEqual(
    describe(
      groupBranches(
        [
          branch('origin/feature/project-search', true),
          branch('origin/main', true),
          branch('origin/feature/command-menu', true),
          branch('origin/feature/ui/login', true),
        ],
        ['origin'],
      ),
    ),
    [
      'feature(3)',
      '  ui(1)',
      '    login',
      '  command-menu',
      '  project-search',
      'main',
    ],
  );
  assert.deepEqual(
    describe(
      groupBranches([branch('team/origin/feature/x', true), branch('upstream/hotfix/y', true)], [
        'team',
        'team/origin',
      ]),
    ),
    ['feature(1)', '  x', 'upstream(1)', '  hotfix(1)', '    y'],
  );
});
