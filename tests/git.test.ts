import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rename, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitService } from '../src/git/service';
import { parseStatus, parseNumstat, parseBranches } from '../src/git/parsers';

async function repository(t: { after: (callback: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'git-workbench-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = new GitService(root, 'git', undefined, 'zh-cn');
  await git.run(['init', '-b', 'main']);
  await git.run(['config', 'user.name', 'Workbench Test']);
  await git.run(['config', 'user.email', 'workbench@example.com']);
  await git.run(['config', 'commit.gpgsign', 'false']);
  const write = async (file: string, content: string | Buffer) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  };
  const initial = async () => {
    await write('base.txt', 'base\n');
    await git.commit(['base.txt'], 'initial');
  };
  return { root, git, write, initial };
}

test('Git service errors follow the configured locale', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'git-workbench-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(new GitService(root).diff('../outside'), /Invalid repository file path/);
  await assert.rejects(
    new GitService(root, 'git', undefined, 'zh-cn').diff('../outside'),
    /无效的仓库文件路径/,
  );
});

test('parses NUL-delimited status, rename and unusual filenames', () => {
  const changes = parseStatus(
    ' M src/中文 file.ts\0R  new\nname.ts\0old name.ts\0?? -new.txt\0UU conflict\0',
  );
  assert.equal(changes.length, 4);
  assert.equal(changes[1].originalPath, 'old name.ts');
  assert.equal(changes[1].path, 'new\nname.ts');
  assert.equal(changes[3].status, 'conflict');
  assert.deepEqual(parseNumstat('12\t3\tsrc/中文 file.ts\0-\t-\timage.png\0').get('src/中文 file.ts'), {
    additions: 12,
    deletions: 3,
  });
  assert.deepEqual(parseNumstat('2\t1\t\0old name\0new name\0').get('new name'), {
    additions: 2,
    deletions: 1,
  });
});

test('parses upstream tracking counters reported by for-each-ref', () => {
  const branches = parseBranches(
    'refs/heads/main\0*\0origin/main\0[ahead 2, behind 1]\0local work\n' +
      'refs/heads/topic\0 \0\0\0no upstream\n' +
      'refs/heads/stale\0 \0origin/stale\0[gone]\0pruned upstream\n' +
      'refs/remotes/origin/main\0 \0\0\0remote tip',
  );
  assert.deepEqual(
    branches.map((branch) => [branch.name, branch.ahead, branch.behind]),
    [
      ['main', 2, 1],
      ['topic', 0, 0],
      ['stale', 0, 0],
      ['origin/main', 0, 0],
    ],
  );
  assert.equal(branches[0].current, true);
  assert.equal(branches[0].upstream, 'origin/main');
  assert.equal(branches[3].remote, true);
});

test('empty repository → first selected-file commit → real history and diff', async (t) => {
  const { git, write } = await repository(t);
  const empty = await git.snapshot();
  assert.equal(empty.commits.length, 0);
  assert.equal(empty.branch, 'main');
  await write('src/中文 file.ts', 'export const ready = true;\n');
  await write('unselected.txt', 'keep local\n');
  const before = await git.diff('src/中文 file.ts');
  assert.equal(before.before, '');
  assert.match(before.after, /ready/);
  await git.commit(['src/中文 file.ts'], 'feat: 第一次提交\n\n正文说明');
  const state = await git.snapshot();
  assert.equal(state.commits[0].subject, 'feat: 第一次提交');
  assert.equal(state.changes.length, 1);
  assert.equal(state.changes[0].path, 'unselected.txt');
  const detail = await git.commitDetail(state.commits[0].hash);
  assert.equal(detail.files[0].path, 'src/中文 file.ts');
  assert.match(detail.message, /正文说明/);
  const diff = await git.diff('src/中文 file.ts', { commit: state.commits[0].hash });
  assert.equal(diff.before, '');
  assert.match(diff.after, /ready/);
});

test('selected commits preserve unrelated staged content and include selected working-tree content', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await write('base.txt', 'base staged\n');
  await git.run(['add', '--', 'base.txt']);
  await write('base.txt', 'base working\n');
  await write('selected.txt', 'selected staged\n');
  await git.run(['add', '--', 'selected.txt']);
  await write('selected.txt', 'selected working\n');
  await git.commit(['selected.txt'], 'only selected');
  assert.equal(await git.run(['show', 'HEAD:base.txt']), 'base\n');
  assert.equal(await git.run(['show', ':base.txt']), 'base staged\n');
  assert.equal(await git.run(['show', 'HEAD:selected.txt']), 'selected working\n');
  assert.equal((await git.snapshot()).changes[0].index, 'M');
  assert.equal((await git.snapshot()).changes[0].worktree, 'M');
});

test('filenames are literal pathspecs and arguments never execute through a shell', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  const files = ['-option.txt', ':(glob)*.txt', 'a\nb.txt', '`echo injected`.txt'];
  for (const file of files) await write(file, 'safe\n');
  await git.commit(files, 'literal filenames');
  assert.equal((await git.snapshot()).changes.length, 0);
  for (const file of files) assert.equal((await git.diff(file)).after, 'safe\n');
});

test('renames and deletions compare with correct HEAD paths and commit together', async (t) => {
  const { root, git, write, initial } = await repository(t);
  await initial();
  await write('base.txt', 'base\n'.repeat(8));
  await git.commit(['base.txt'], 'prepare rename');
  await git.run(['mv', 'base.txt', 'renamed.txt']);
  await write('renamed.txt', 'base\n'.repeat(8) + 'new line\n');
  let state = await git.snapshot();
  assert.equal(state.changes[0].status, 'renamed');
  assert.equal(state.changes[0].originalPath, 'base.txt');
  let diff = await git.diff('renamed.txt');
  assert.equal(diff.before, 'base\n'.repeat(8));
  assert.match(diff.after, /new line/);
  await git.commit(['renamed.txt'], 'rename');
  const detail = await git.commitDetail((await git.snapshot()).commits[0].hash);
  assert.equal(detail.files[0].originalPath, 'base.txt');
  diff = await git.diff('renamed.txt', { commit: detail.commit.hash });
  assert.equal(diff.before, 'base\n'.repeat(8));
  await rm(path.join(root, 'renamed.txt'));
  state = await git.snapshot();
  assert.equal(state.changes[0].status, 'deleted');
  assert.equal((await git.diff('renamed.txt')).after, '');
  await git.commit(['renamed.txt'], 'delete');
  assert.equal((await git.snapshot()).changes.length, 0);
});

test('branch create, switch, merge graph, merge details and safe deletion', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await git.createBranch('feature/test');
  await write('feature.txt', 'feature\n');
  await git.commit(['feature.txt'], 'feature');
  await git.checkout('main');
  await write('main.txt', 'main\n');
  await git.commit(['main.txt'], 'main change');
  await git.merge('feature/test');
  const state = await git.snapshot();
  assert.equal(state.commits[0].parents.length, 2);
  assert.equal(state.branch, 'main');
  const detail = await git.commitDetail(state.commits[0].hash);
  assert.ok(detail.files.some((file) => file.path === 'feature.txt'));
  await git.deleteBranch('feature/test');
  assert.ok(!(await git.snapshot()).branches.some((branch) => branch.name === 'feature/test'));
  await assert.rejects(git.createBranch('--help'));
  await assert.rejects(git.deleteBranch('main'));
  await assert.rejects(git.checkout('missing'));
});

test('merge conflicts can be resolved and continued or aborted without losing history', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await git.createBranch('other');
  await write('base.txt', 'other\n');
  await git.commit(['base.txt'], 'other change');
  await git.checkout('main');
  await write('base.txt', 'main\n');
  await git.commit(['base.txt'], 'main change');
  await assert.rejects(git.merge('other'));
  let state = await git.snapshot();
  assert.equal(state.merging, true);
  assert.equal(state.changes[0].status, 'conflict');
  await assert.rejects(git.commit(['base.txt'], 'invalid partial merge'));
  await git.abortOperation();
  assert.equal((await git.snapshot()).merging, false);
  await assert.rejects(git.merge('other'));
  await write('base.txt', 'resolved\n');
  await git.markResolved('base.txt');
  await git.continueOperation();
  state = await git.snapshot();
  assert.equal(state.merging, false);
  assert.equal(state.changes.length, 0);
  assert.equal(state.commits[0].parents.length, 2);
});

test('stash retains untracked files and supports preview, apply, drop and pop', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await write('base.txt', 'work in progress\n');
  await write('new.txt', 'untracked content\n');
  await git.stash('中文 WIP');
  let state = await git.snapshot();
  assert.equal(state.stashes.length, 1);
  assert.equal(state.changes.length, 0);
  assert.match(state.stashes[0].subject, /中文 WIP/);
  const files = await git.stashFiles('stash@{0}');
  assert.equal(files.length, 2);
  assert.equal((await git.diff('new.txt', { stash: 'stash@{0}' })).after, 'untracked content\n');
  assert.equal((await git.diff('base.txt', { stash: 'stash@{0}' })).before, 'base\n');
  await git.stashApply('stash@{0}');
  state = await git.snapshot();
  assert.equal(state.changes.length, 2);
  assert.equal(state.stashes.length, 1);
  await git.stashDrop('stash@{0}');
  await git.stash('again');
  await git.stashApply('stash@{0}', true);
  assert.equal((await git.snapshot()).stashes.length, 0);
  assert.equal((await git.snapshot()).changes.length, 2);
});

test('fetch, first push, ahead/behind and fast-forward pull against a real bare remote', async (t) => {
  const { root, git, write, initial } = await repository(t);
  await initial();
  const bare = await mkdtemp(path.join(tmpdir(), 'git-workbench-remote-'));
  t.after(() => rm(bare, { recursive: true, force: true }));
  const remote = new GitService(bare);
  await remote.run(['init', '--bare', '--initial-branch=main']);
  await git.run(['remote', 'add', 'origin', bare]);
  await git.push();
  assert.equal((await git.snapshot()).upstream, 'origin/main');
  await write('local.txt', 'local\n');
  await git.commit(['local.txt'], 'local ahead');
  assert.equal((await git.snapshot()).ahead, 1);
  // Branch rows carry the same counters as the header, so every local branch can show
  // its unpushed and unpulled commits after the last fetch.
  const localBranches = (await git.snapshot()).branches.filter((branch) => !branch.remote);
  assert.deepEqual(
    localBranches.map((branch) => [branch.name, branch.ahead, branch.behind]),
    [['main', 1, 0]],
  );
  const outgoing = await git.outgoing();
  assert.equal(outgoing.total, 1);
  assert.equal(outgoing.commits[0].subject, 'local ahead');
  assert.equal(outgoing.remote, 'origin');
  assert.equal(outgoing.target, 'main');
  await git.push();
  const clone = await mkdtemp(path.join(tmpdir(), 'git-workbench-clone-'));
  t.after(() => rm(clone, { recursive: true, force: true }));
  const peer = new GitService(clone);
  await peer.run(['clone', bare, '.']);
  await peer.run(['config', 'user.name', 'Peer']);
  await peer.run(['config', 'user.email', 'peer@example.com']);
  await peer.run(['config', 'commit.gpgsign', 'false']);
  await writeFile(path.join(clone, 'peer.txt'), 'remote content\n');
  await peer.commit(['peer.txt'], 'peer change');
  await peer.push();
  await git.fetch();
  assert.equal((await git.snapshot()).behind, 1);
  const fetched = (await git.snapshot()).branches.find((branch) => branch.name === 'main');
  assert.deepEqual([fetched?.ahead, fetched?.behind], [0, 1]);
  // Selecting a local branch must never show commits that only exist on the remote:
  // the branch log starts at the local head instead of the shared decorated window.
  assert.deepEqual(
    (await git.branchLog('main', false)).map((commit) => commit.subject),
    ['local ahead', 'initial'],
  );
  assert.deepEqual(
    (await git.branchLog('origin/main', true)).map((commit) => commit.subject),
    ['peer change', 'local ahead', 'initial'],
  );
  await assert.rejects(git.branchLog('missing-branch', false), /分支不存在/);
  await git.pull();
  assert.equal(await readFile(path.join(root, 'peer.txt'), 'utf8'), 'remote content\n');
  await write('base.txt', 'dirty\n');
  await assert.rejects(git.pull(), /提交或 Stash/);
});

test('existing files excludes working-tree deletions and invalid paths', async (t) => {
  const { root, git, write, initial } = await repository(t);
  await initial();
  await write('keep.txt', 'keep\n');
  await git.commit(['keep.txt'], 'keep');
  await write('gone.txt', 'gone\n');
  await git.commit(['gone.txt'], 'gone');
  await rm(path.join(root, 'gone.txt'));
  assert.deepEqual(await git.existingFiles(['keep.txt', 'gone.txt', '../outside']), ['keep.txt']);
});

test('failed hooks report errors and never commit unrelated files', async (t) => {
  const { root, git, write, initial } = await repository(t);
  await initial();
  await write('selected.txt', 'selected\n');
  await write('other.txt', 'other\n');
  await git.run(['add', 'other.txt']);
  const hook = path.join(root, '.git/hooks/pre-commit');
  await writeFile(hook, '#!/bin/sh\necho blocked-by-test >&2\nexit 1\n');
  await chmod(hook, 0o755);
  await assert.rejects(git.commit(['selected.txt'], 'blocked'), /blocked-by-test/);
  assert.equal((await git.snapshot()).commits.length, 1);
  assert.equal(await git.run(['show', ':other.txt']), 'other\n');
});

test('rollback restores tracked paths, removes chosen untracked files and preserves others', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await write('base.txt', 'changed\n');
  await write('new.txt', 'delete me\n');
  await write('keep.txt', 'keep\n');
  await git.discard(['base.txt', 'new.txt']);
  assert.equal((await git.diff('base.txt')).after, 'base\n');
  assert.deepEqual(
    (await git.snapshot()).changes.map((change) => change.path),
    ['keep.txt'],
  );
});

test('staging selected files updates the index and leaves other changes untouched', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await write('base.txt', 'changed\n');
  await write('new file.txt', 'new\n');
  await write('other.txt', 'other\n');
  await git.stage(['base.txt', 'new file.txt']);
  assert.equal(
    (await git.run(['diff', '--cached', '--name-status'])).trim().split('\n').sort().join('\n'),
    'A\tnew file.txt\nM\tbase.txt',
  );
  const changes = (await git.snapshot()).changes;
  const base = changes.find((change) => change.path === 'base.txt')!;
  assert.deepEqual([base.index, base.worktree], ['M', ' ']);
  const added = changes.find((change) => change.path === 'new file.txt')!;
  assert.deepEqual([added.status, added.index, added.worktree], ['added', 'A', ' ']);
  const other = changes.find((change) => change.path === 'other.txt')!;
  assert.deepEqual([other.status, other.index, other.worktree], ['untracked', '?', '?']);
});

test('deleting files removes them from disk and leaves tracked paths as deletions', async (t) => {
  const { root, git, write, initial } = await repository(t);
  await initial();
  await write('base.txt', 'changed\n');
  await write('new.txt', 'untracked\n');
  await git.deleteFiles(['base.txt', 'new.txt']);
  assert.deepEqual(
    (await git.snapshot()).changes.map((change) => [change.path, change.status]),
    [['base.txt', 'deleted']],
  );
  await assert.rejects(readFile(path.join(root, 'new.txt'), 'utf8'), /ENOENT/);
  await assert.rejects(git.deleteFiles(['../outside.txt']), /无效的仓库文件路径/);
});

test('ignore rules are appended once and only apply to untracked files', async (t) => {
  const { root, git, write, initial } = await repository(t);
  await initial();
  await write('new file.txt', 'new\n');
  await write('base.txt', 'changed\n');
  assert.match(await git.ignorePaths(['new file.txt']), /\.gitignore/);
  assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), '/new file.txt\n');
  assert.match(await git.ignorePaths(['new file.txt']), /已被忽略/);
  assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), '/new file.txt\n');
  assert.deepEqual((await git.snapshot()).changes.map((change) => change.path).sort(), [
    '.gitignore',
    'base.txt',
  ]);
  await assert.rejects(git.ignorePaths(['base.txt']), /未跟踪文件/);
  await write('exclude me.txt', 'local\n');
  await git.ignorePaths(['exclude me.txt'], 'exclude');
  assert.match(await readFile(path.join(root, '.git/info/exclude'), 'utf8'), /\/exclude me\.txt/);
});

test('path validation and symlink boundaries prevent out-of-repository access', async (t) => {
  const { root, git, initial } = await repository(t);
  await initial();
  await assert.rejects(git.diff('../outside'));
  await assert.rejects(git.diff('.git/config'));
  await assert.rejects(git.diff('/etc/passwd'));
  const outside = await mkdtemp(path.join(tmpdir(), 'git-workbench-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'secret'), 'outside\n');
  await symlink(outside, path.join(root, 'linked-dir'));
  await assert.rejects(git.diff('linked-dir/secret'), /符号链接/);
  await assert.rejects(git.discard(['linked-dir/secret']));
  await symlink(path.join(outside, 'secret'), path.join(root, 'link-file'));
  assert.equal((await git.diff('link-file')).after, path.join(outside, 'secret'));
});

test('binary files and large local files produce explicit preview states', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await write('binary.bin', Buffer.from([0, 1, 2, 3]));
  assert.equal((await git.diff('binary.bin')).binary, true);
  await write('large.txt', 'x'.repeat(1024 * 1024 + 1));
  assert.equal((await git.diff('large.txt')).truncated, true);
  assert.equal((await git.diff('large.txt', { full: true })).after.length, 1024 * 1024 + 1);
  await git.commit(['large.txt'], 'large file');
  assert.equal(
    (await git.diff('large.txt', { commit: (await git.snapshot()).commits[0].hash })).truncated,
    true,
  );
});

test('Cherry-pick and Revert conflict states remain actionable after marking files resolved', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await git.createBranch('feature');
  await write('base.txt', 'feature\n');
  await git.commit(['base.txt'], 'feature');
  const feature = (await git.snapshot()).commits.find((commit) =>
    commit.refs.some((ref) => ref.startsWith('HEAD ->')),
  )!;
  await git.checkout('main');
  await write('base.txt', 'main\n');
  await git.commit(['base.txt'], 'main');
  const main = (await git.snapshot()).commits.find((commit) =>
    commit.refs.some((ref) => ref.startsWith('HEAD ->')),
  )!;
  await assert.rejects(git.cherryPick(feature.hash));
  assert.equal((await git.snapshot()).operation, 'cherry-pick');
  await write('base.txt', 'resolved\n');
  await git.markResolved('base.txt');
  assert.equal((await git.snapshot()).operation, 'cherry-pick');
  await git.continueOperation();
  assert.equal((await git.snapshot()).operation, null);
  await assert.rejects(git.revert(main.hash));
  assert.equal((await git.snapshot()).operation, 'revert');
  await git.abortOperation();
  assert.equal((await git.snapshot()).operation, null);
});

test('revert and cherry-pick create correct changes and preserve history', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await git.createBranch('feature');
  await write('feature.txt', 'feature\n');
  await git.commit(['feature.txt'], 'feature commit');
  const hash = (await git.snapshot()).commits[0].hash;
  await git.checkout('main');
  await git.cherryPick(hash);
  assert.equal((await git.diff('feature.txt')).after, 'feature\n');
  const picked = (await git.snapshot()).commits.find((commit) =>
    commit.refs.some((ref) => ref.includes('HEAD ->')),
  )!;
  await git.revert(picked.hash);
  assert.equal((await git.snapshot()).changes.length, 0);
  assert.match((await git.snapshot()).commits[0].subject, /Revert/);
});

test('hard reset moves the branch, discards tracked changes and keeps untracked files', async (t) => {
  const { root, git, write, initial } = await repository(t);
  await initial();
  const base = (await git.snapshot()).commits[0].hash;
  await write('second.txt', 'second\n');
  await git.commit(['second.txt'], 'second');
  await write('base.txt', 'dirty tracked\n');
  await git.run(['add', '--', 'base.txt']);
  await write('untracked.txt', 'keep me\n');
  await git.reset(base);
  const state = await git.snapshot();
  assert.equal(state.commits[0].hash, base);
  assert.deepEqual(
    state.changes.map((change) => change.path),
    ['untracked.txt'],
  );
  assert.equal(await readFile(path.join(root, 'base.txt'), 'utf8'), 'base\n');
  assert.equal(await readFile(path.join(root, 'untracked.txt'), 'utf8'), 'keep me\n');
  await assert.rejects(git.reset('not-a-commit'));
});

test('branch creation from selected ref, rename, comparison and clean rebase', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await git.createBranch('feature/source');
  await write('feature.txt', 'feature\n');
  await git.commit(['feature.txt'], 'feature commit');
  const sourceTip = (await git.run(['rev-parse', 'HEAD'])).trim();
  await git.checkout('main');
  await write('main.txt', 'main\n');
  await git.commit(['main.txt'], 'main commit');
  const comparison = await git.compareBranch('feature/source', false);
  assert.equal(comparison.ahead, 1);
  assert.equal(comparison.behind, 1);
  assert.deepEqual(
    comparison.files.map((file) => [file.path, file.status]),
    [
      ['feature.txt', 'deleted'],
      ['main.txt', 'added'],
    ],
  );
  const swapped = await git.compareBranch('feature/source', false, true);
  assert.equal(swapped.base, comparison.head);
  assert.equal(swapped.head, comparison.base);
  assert.deepEqual([swapped.ahead, swapped.behind], [1, 1]);
  assert.deepEqual(
    swapped.files.map((file) => [file.path, file.status]),
    [
      ['feature.txt', 'added'],
      ['main.txt', 'deleted'],
    ],
  );
  const diff = await git.branchDiff('feature.txt', comparison.base, comparison.head);
  assert.equal(diff.before, 'feature\n');
  assert.equal(diff.after, '');
  await assert.rejects(git.branchDiff('../outside', comparison.base, comparison.head), /无效/);
  await assert.rejects(git.branchDiff('base.txt', comparison.base, comparison.head), /不在/);
  await git.createBranch('feature/from-selected', 'feature/source', false);
  assert.equal((await git.run(['rev-parse', 'HEAD'])).trim(), sourceTip);
  await git.renameBranch('feature/from-selected', 'feature/renamed');
  assert.equal((await git.snapshot()).branch, 'feature/renamed');
  await assert.rejects(git.renameBranch('main', '--bad'), /有效/);
  await write('dirty.txt', 'local');
  await assert.rejects(git.rebase('main', false), /Stash/);
  assert.equal((await git.run(['rev-parse', 'HEAD'])).trim(), sourceTip);
  await rm(path.join(git.root, 'dirty.txt'));
  await git.rebase('main', false);
  assert.equal((await git.snapshot()).operation, null);
  assert.equal(await git.run(['show', 'HEAD:feature.txt']), 'feature\n');
  assert.equal(await git.run(['show', 'HEAD:main.txt']), 'main\n');
});

test('updates and pushes another local branch without checking it out', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  const bare = await mkdtemp(path.join(tmpdir(), 'git-workbench-branch-remote-'));
  t.after(() => rm(bare, { recursive: true, force: true }));
  await new GitService(bare).run(['init', '--bare', '--initial-branch=main']);
  await git.run(['remote', 'add', 'origin', bare]);
  await git.push();
  await git.createBranch('topic');
  await write('topic.txt', 'topic one\n');
  await git.commit(['topic.txt'], 'topic one');
  await git.push();
  await git.checkout('main');

  const clone = await mkdtemp(path.join(tmpdir(), 'git-workbench-branch-clone-'));
  t.after(() => rm(clone, { recursive: true, force: true }));
  const peer = new GitService(clone);
  await peer.run(['clone', bare, '.']);
  await peer.run(['config', 'user.name', 'Peer']);
  await peer.run(['config', 'user.email', 'peer@example.com']);
  await peer.run(['config', 'commit.gpgsign', 'false']);
  await peer.run(['checkout', 'topic']);
  await writeFile(path.join(clone, 'peer.txt'), 'peer one\n');
  await peer.commit(['peer.txt'], 'peer one');
  await peer.push();
  const headBefore = (await git.run(['rev-parse', 'HEAD'])).trim();

  await git.updateBranch('topic');
  assert.equal(
    (await git.run(['rev-parse', 'topic'])).trim(),
    (await peer.run(['rev-parse', 'HEAD'])).trim(),
  );
  assert.equal((await git.run(['rev-parse', 'HEAD'])).trim(), headBefore);
  const state = await git.snapshot();
  assert.equal(state.branch, 'main');
  assert.equal(state.changes.length, 0);

  // A local commit that is not on the upstream blocks the update instead of merging.
  await git.checkout('topic');
  await write('local.txt', 'local only\n');
  await git.commit(['local.txt'], 'local only');
  await git.checkout('main');
  await peer.run(['checkout', 'topic']);
  await writeFile(path.join(clone, 'peer.txt'), 'peer two\n');
  await peer.commit(['peer.txt'], 'peer two');
  await peer.push();
  const localTopic = (await git.run(['rev-parse', 'topic'])).trim();
  await assert.rejects(git.updateBranch('topic'), /无法更新/);
  assert.equal((await git.run(['rev-parse', 'topic'])).trim(), localTopic);
  await assert.rejects(git.pushBranch('topic'), /rejected|failed/i);

  // A branch without an upstream cannot be updated and is pushed under its own name.
  await git.createBranch('push-me');
  await write('push-me.txt', 'push me\n');
  await git.commit(['push-me.txt'], 'push me');
  const pushTip = (await git.run(['rev-parse', 'HEAD'])).trim();
  await git.checkout('main');
  await assert.rejects(git.updateBranch('push-me'), /上游/);
  await git.pushBranch('push-me');
  assert.match(await git.run(['ls-remote', '--heads', 'origin', 'push-me']), new RegExp(pushTip));

  // The current branch only fast-forwards and never runs over local changes.
  await write('base.txt', 'dirty\n');
  await assert.rejects(git.updateBranch('main'), /提交或 Stash/);
  await git.run(['restore', 'base.txt']);
  await peer.run(['checkout', 'main']);
  await writeFile(path.join(clone, 'peer-main.txt'), 'peer main\n');
  await peer.commit(['peer-main.txt'], 'peer main');
  await peer.push();
  await git.updateBranch('main');
  assert.equal((await git.run(['rev-parse', 'HEAD'])).trim(), (await peer.run(['rev-parse', 'HEAD'])).trim());
});

test('branch rows keep a stable order after updating a branch from its upstream', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  const bare = await mkdtemp(path.join(tmpdir(), 'git-workbench-order-remote-'));
  t.after(() => rm(bare, { recursive: true, force: true }));
  await new GitService(bare).run(['init', '--bare', '--initial-branch=main']);
  await git.run(['remote', 'add', 'origin', bare]);
  await git.push();

  // Dated commits keep the test deterministic: `topic` is older than `main` before the
  // update and newer afterwards, so a commit-date sort would move it to the top.
  const commitAt = async (file: string, message: string, date: string) => {
    await write(file, `${message}\n`);
    await git.run(['add', file]);
    await git.run(['commit', '-m', message], {
      env: { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
    });
  };
  await git.createBranch('topic');
  await commitAt('topic.txt', 'topic one', '2021-01-01T00:00:00');
  await git.push();
  await git.checkout('main');
  await commitAt('main.txt', 'main two', '2022-01-01T00:00:00');

  const clone = await mkdtemp(path.join(tmpdir(), 'git-workbench-order-clone-'));
  t.after(() => rm(clone, { recursive: true, force: true }));
  const peer = new GitService(clone);
  await peer.run(['clone', bare, '.']);
  await peer.run(['config', 'user.name', 'Peer']);
  await peer.run(['config', 'user.email', 'peer@example.com']);
  await peer.run(['config', 'commit.gpgsign', 'false']);
  await peer.run(['checkout', 'topic']);
  await writeFile(path.join(clone, 'peer.txt'), 'peer one\n');
  await peer.commit(['peer.txt'], 'peer one');
  await peer.push();

  const branchOrder = async () =>
    (await git.snapshot()).branches.filter((branch) => !branch.remote).map((branch) => branch.name);
  const before = await branchOrder();
  assert.deepEqual(before, ['main', 'topic']);
  await git.updateBranch('topic');
  assert.deepEqual(await branchOrder(), before);
});

test('remote checkout reuses tracking local branch, upstream configuration and leased remote deletion', async (t) => {
  const { git, initial } = await repository(t);
  await initial();
  const remote = await mkdtemp(path.join(tmpdir(), 'gwb-branches-'));
  t.after(() => rm(remote, { recursive: true, force: true }));
  await new GitService(remote).run(['init', '--bare']);
  await git.run(['remote', 'add', 'origin', remote]);
  await git.run(['push', '-u', 'origin', 'main']);
  await git.checkout('origin/main', true);
  assert.equal((await git.snapshot()).branch, 'main');
  await git.createBranch('topic');
  await git.run(['push', '-u', 'origin', 'topic']);
  await git.checkout('main');
  await git.checkout('origin/topic', true);
  assert.equal((await git.snapshot()).branch, 'topic');
  await git.setUpstream('topic', 'origin/main');
  assert.equal((await git.snapshot()).upstream, 'origin/main');
  await assert.rejects(git.checkout('origin/topic', true), /跟踪目标不同/);
  await git.setUpstream('topic');
  assert.equal((await git.snapshot()).upstream, '');
  await git.setUpstream('topic', 'origin/topic');
  await git.checkout('main');
  await git.run(['commit', '--allow-empty', '-m', 'advance server tip']);
  await git.run(['push', 'origin', 'main']);
  const updatedTip = (await git.run(['rev-parse', 'HEAD'])).trim();
  await new GitService(remote).run(['update-ref', 'refs/heads/topic', updatedTip]);
  await assert.rejects(git.deleteBranch('origin/topic', true), /stale info|rejected/);
  assert.match(await git.run(['ls-remote', '--heads', 'origin', 'topic']), new RegExp(updatedTip));
  await git.fetch();
  await git.deleteBranch('origin/topic', true);
  assert.equal((await git.run(['ls-remote', '--heads', 'origin', 'topic'])).trim(), '');
  await assert.rejects(git.setUpstream('main', '-injected'), /不存在/);
});

test('rebase conflicts can be aborted and then resolved through the operation controls', async (t) => {
  const { git, write, initial } = await repository(t);
  await initial();
  await git.createBranch('topic');
  await write('base.txt', 'topic change\n');
  await git.commit(['base.txt'], 'topic change');
  const topicTip = (await git.run(['rev-parse', 'HEAD'])).trim();
  await git.checkout('main');
  await write('base.txt', 'main change\n');
  await git.commit(['base.txt'], 'main change');
  await git.checkout('topic');
  await assert.rejects(git.rebase('main'), /conflict|CONFLICT/);
  assert.equal((await git.snapshot()).operation, 'rebase');
  await git.abortOperation();
  assert.equal((await git.run(['rev-parse', 'HEAD'])).trim(), topicTip);
  await assert.rejects(git.rebase('main'), /conflict|CONFLICT/);
  await write('base.txt', 'both changes\n');
  await git.markResolved('base.txt');
  await git.continueOperation();
  const state = await git.snapshot();
  assert.equal(state.operation, null);
  assert.equal(state.branch, 'topic');
  assert.equal(await git.run(['show', 'HEAD:base.txt']), 'both changes\n');
});
