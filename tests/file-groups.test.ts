import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Change } from '../src/shared/types';
import { groupFiles, type FileListEntry } from '../webview/src/file-groups';

const change = (path: string): Change => ({
  path,
  index: '',
  worktree: '',
  status: 'modified',
  additions: 0,
  deletions: 0,
});
const describe = (entries: FileListEntry[], depth = 0): string[] =>
  entries.flatMap((entry) =>
    entry.kind === 'folder'
      ? [
          `${'  '.repeat(depth)}${entry.name}(${entry.count})`,
          ...describe(entry.folders, depth + 1),
          ...entry.files.map((item) => `${'  '.repeat(depth + 1)}${item.label}`),
        ]
      : [`${'  '.repeat(depth)}${entry.label}`],
  );

test('file grouping builds folders and keeps root files at the top level', () => {
  assert.deepEqual(
    describe(
      groupFiles([
        change('feature/project-search/index.ts'),
        change('main.ts'),
        change('feature/command-menu.ts'),
        change('hotfix/login.ts'),
        change('README.md'),
      ]),
    ),
    [
      'feature(2)',
      '  project-search(1)',
      '    index.ts',
      '  command-menu.ts',
      'hotfix(1)',
      '  login.ts',
      'main.ts',
      'README.md',
    ],
  );
});

test('single-child folder chains are compacted and counted', () => {
  assert.deepEqual(describe(groupFiles([change('src/git/service.ts'), change('src/git/parsers.ts')])), [
    'src/git(2)',
    '  parsers.ts',
    '  service.ts',
  ]);
});

test('nested folders keep their own files and sort folders before files', () => {
  assert.deepEqual(
    describe(
      groupFiles([
        change('webview/src/main.tsx'),
        change('webview/src/styles.css'),
        change('webview/src/components/button.tsx'),
        change('webview/vite.config.ts'),
        change('tests/git.test.ts'),
      ]),
    ),
    [
      'tests(1)',
      '  git.test.ts',
      'webview(4)',
      '  src(3)',
      '    components(1)',
      '      button.tsx',
      '    main.tsx',
      '    styles.css',
      '  vite.config.ts',
    ],
  );
});

test('paths with spaces, unicode and Git-special characters stay literal', () => {
  const entries = groupFiles([
    change('docs/My Notes/read me.md'),
    change('docs/-strange.ts'),
    change('中文/目录/文件.ts'),
    change('a//empty.ts'),
  ]);
  assert.deepEqual(describe(entries), [
    'a(1)',
    '  empty.ts',
    'docs(2)',
    '  My Notes(1)',
    '    read me.md',
    '  -strange.ts',
    '中文/目录(1)',
    '  文件.ts',
  ]);
});

test('duplicate file names in different folders remain distinct', () => {
  const [left, right] = groupFiles([change('left/index.ts'), change('right/index.ts')]);
  assert.deepEqual(describe([left, right]), ['left(1)', '  index.ts', 'right(1)', '  index.ts']);
  assert.equal(left.kind === 'folder' && left.files[0].change.path, 'left/index.ts');
  assert.equal(right.kind === 'folder' && right.files[0].change.path, 'right/index.ts');
});
