import { spawn } from 'node:child_process';
import { lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Activity,
  BranchComparison,
  Change,
  Commit,
  CommitDetail,
  FileDiff,
  PushPreview,
  Snapshot,
} from '../shared/types';
import { translate, type Locale } from '../shared/i18n';
import { parseBranches, parseLog, parseNumstat, parseStashes, parseStatus } from './parsers';

const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D';
const MAX_FILE = 1024 * 1024;
export class GitError extends Error {
  constructor(
    public readonly args: string[],
    public readonly output: string,
    locale: Locale = 'en',
  ) {
    super(output.trim() || translate(locale, 'Git command failed: {0}', args[0]));
  }
}

export class GitService {
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(
    public readonly root: string,
    private readonly executable = 'git',
    private readonly onActivity?: (entry: Activity) => void,
    private readonly locale: Locale = 'en',
  ) {
    this.root = path.resolve(root);
  }

  private t(message: string, ...values: (string | number)[]) {
    return translate(this.locale, message, ...values);
  }

  async run(
    args: string[],
    options: { silent?: boolean; network?: boolean; env?: NodeJS.ProcessEnv } = {},
  ): Promise<string> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      // Stash constructs its own pathspecs internally; applying --literal-pathspecs
      // to stash prevents Git from cleaning the saved untracked files correctly.
      const literal = ['add', 'commit', 'diff', 'diff-tree', 'ls-tree', 'restore', 'status'].includes(
        args[0],
      );
      const child = spawn(
        this.executable,
        [...(literal ? ['--literal-pathspecs'] : []), '-c', 'color.ui=false', ...args],
        {
          cwd: this.root,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'en_US.UTF-8', ...options.env },
          windowsHide: true,
        },
      );
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      let length = 0,
        stopped = false;
      const timer = setTimeout(
        () => {
          stopped = true;
          child.kill();
        },
        options.network ? 120_000 : 30_000,
      );
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        length += chunk.length;
        if (length > 24 * 1024 * 1024) {
          stopped = true;
          child.kill();
        } else target.push(chunk);
      };
      child.stdout.on('data', collect(stdout));
      child.stderr.on('data', collect(stderr));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(this.t('Unable to run Git: {0}', error.message)));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const output = Buffer.concat(stdout).toString('utf8');
        const error = stopped
          ? this.t(
              'The Git operation timed out or produced too much output. Check the repository in a terminal.',
            )
          : Buffer.concat(stderr).toString('utf8');
        if (!options.silent)
          this.onActivity?.({
            id: randomUUID(),
            time: started,
            command: `git ${args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(' ')}`,
            output: (output + error).slice(-12000),
            error: code !== 0,
          });
        if (code === 0 && !stopped) resolve(output);
        else reject(new GitError(args, error || output, this.locale));
      });
    });
  }

  private async optional(args: string[]): Promise<string> {
    try {
      return await this.run(args, { silent: true });
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      return '';
    }
  }

  serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(action);
    this.mutation = result.catch(() => undefined);
    return result;
  }

  static async discover(directory: string, executable = 'git'): Promise<string | undefined> {
    try {
      return path.resolve(
        (
          await new GitService(directory, executable).run(['rev-parse', '--show-toplevel'], { silent: true })
        ).trim(),
      );
    } catch {
      return undefined;
    }
  }

  async snapshot(
    limit = 300,
  ): Promise<Omit<Snapshot, 'repositories' | 'repository' | 'changelists' | 'diffTarget' | 'fileLayout'>> {
    const head = (await this.optional(['rev-parse', '--verify', 'HEAD'])).trim();
    const [
      status,
      branch,
      upstream,
      tracking,
      branches,
      log,
      stashes,
      remotes,
      numstat,
      [merging, rebaseMerge, rebaseApply, cherryPicking, reverting],
    ] = await Promise.all([
      this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { silent: true }),
      this.optional(['symbolic-ref', '--short', 'HEAD']),
      this.optional(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
      this.optional(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']),
      this.run(
        [
          'for-each-ref',
          // Sort by ref name: sorting by commit date moved a branch to another row
          // whenever it was fast-forwarded from its upstream.
          '--sort=refname',
          '--format=%(refname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(subject)',
          'refs/heads',
          'refs/remotes',
        ],
        { silent: true },
      ),
      head
        ? this.run(
            [
              'log',
              '--branches',
              '--remotes',
              '--tags',
              '--topo-order',
              '-z',
              `--max-count=${limit}`,
              `--format=${LOG_FORMAT}`,
              'HEAD',
            ],
            { silent: true },
          )
        : Promise.resolve(''),
      this.run(['stash', 'list', '-z', '--format=%gd%x00%H%x00%gs%x00%aI'], { silent: true }),
      this.run(['remote'], { silent: true }),
      head
        ? this.run(['diff', '--no-ext-diff', '--no-textconv', '-M', '--numstat', '-z', 'HEAD', '--'], {
            silent: true,
          })
        : this.optional(['diff', '--cached', '--numstat', '-z']),
      this.gitPathsExist(['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']),
    ]);
    const rebasing = rebaseMerge || rebaseApply;
    const changes = parseStatus(status),
      stats = parseNumstat(numstat);
    for (const change of changes) Object.assign(change, stats.get(change.path));
    await Promise.all(
      changes
        .filter((change) => change.status === 'untracked')
        .slice(0, 200)
        .map(async (change) => {
          try {
            const file = await this.safePath(change.path),
              stat = await lstat(file);
            if (!stat.isFile() || stat.size > MAX_FILE) return;
            const content = await readFile(file);
            if (!content.includes(0) && content.length)
              change.additions =
                content.toString('utf8').split('\n').length - (content.at(-1) === 10 ? 1 : 0);
          } catch {
            /* A disappearing or inaccessible untracked file still remains visible in status. */
          }
        }),
    );
    const [ahead = 0, behind = 0] = tracking.trim().split(/\s+/).map(Number);
    return {
      branch: branch.trim() || (head ? head.slice(0, 8) : 'main'),
      detached: !!head && !branch.trim(),
      upstream: upstream.trim(),
      ahead,
      behind,
      changes,
      branches: parseBranches(branches),
      commits: parseLog(log),
      stashes: parseStashes(stashes),
      remotes: remotes.trim().split('\n').filter(Boolean),
      merging,
      rebasing,
      operation: rebasing
        ? 'rebase'
        : merging
          ? 'merge'
          : cherryPicking
            ? 'cherry-pick'
            : reverting
              ? 'revert'
              : null,
      updatedAt: Date.now(),
    };
  }

  private async existsGitPath(name: string): Promise<boolean> {
    const file = (await this.run(['rev-parse', '--git-path', name], { silent: true })).trim();
    try {
      await lstat(path.resolve(this.root, file));
      return true;
    } catch {
      return false;
    }
  }
  private async gitPathsExist(names: string[]): Promise<boolean[]> {
    const files = (
      await this.run(['rev-parse', ...names.flatMap((name) => ['--git-path', name])], { silent: true })
    )
      .split('\n')
      .slice(0, names.length);
    return Promise.all(
      names.map(async (_, index) => {
        try {
          await lstat(path.resolve(this.root, files[index]));
          return true;
        } catch {
          return false;
        }
      }),
    );
  }
  private async isRebasing(): Promise<boolean> {
    return (await this.existsGitPath('rebase-merge')) || (await this.existsGitPath('rebase-apply'));
  }

  validatePath(file: string): string {
    if (
      !file ||
      file.includes('\0') ||
      file.includes('\\') ||
      path.isAbsolute(file) ||
      file.split('/').some((part) => part === '..' || part.toLowerCase() === '.git')
    ) {
      throw new Error(this.t('Invalid repository file path.'));
    }
    const absolute = path.resolve(this.root, file);
    if (!absolute.startsWith(this.root + path.sep))
      throw new Error(this.t('The file must be inside the current repository.'));
    return absolute;
  }

  async safePath(file: string, followLeaf = false): Promise<string> {
    const absolute = this.validatePath(file);
    // Check the parent too: deleted files still need protection from directory symlinks.
    let parent = path.dirname(absolute);
    while (parent !== this.root) {
      try {
        const resolved = await realpath(parent),
          root = await realpath(this.root);
        if (resolved !== root && !resolved.startsWith(root + path.sep))
          throw new Error(
            this.t('Accessing files outside the repository through symbolic links is not allowed.'),
          );
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        parent = path.dirname(parent);
      }
    }
    if (followLeaf) {
      const resolved = await realpath(absolute),
        root = await realpath(this.root);
      if (!resolved.startsWith(root + path.sep))
        throw new Error(this.t('Opening link targets outside the repository is not allowed.'));
      return resolved;
    }
    return absolute;
  }

  private hash(hash: string): string {
    if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error(this.t('Invalid commit ID.'));
    return hash;
  }
  private stashRef(ref: string): string {
    if (!/^stash@\{\d+\}$/.test(ref)) throw new Error(this.t('Invalid stash reference.'));
    return ref;
  }

  private async content(revision: string, file: string, limit = MAX_FILE): Promise<Buffer> {
    this.validatePath(file);
    // ls-tree distinguishes an absent file from a genuine Git error.
    const exists = await this.run(['ls-tree', '-z', revision, '--', file], { silent: true });
    if (!exists) return Buffer.alloc(0);
    const size = Number((await this.run(['cat-file', '-s', `${revision}:${file}`], { silent: true })).trim());
    if (size > limit) return Buffer.alloc(limit + 1, 32);
    return Buffer.from(await this.run(['show', `${revision}:${file}`], { silent: true }));
  }

  async diff(
    file: string,
    options: { commit?: string; stash?: string; full?: boolean } = {},
  ): Promise<FileDiff> {
    const absolute = await this.safePath(file);
    const limit = options.full ? 20 * MAX_FILE : MAX_FILE;
    let before: Buffer, after: Buffer;
    let beforeLabel = 'HEAD',
      afterLabel = this.t('Working tree');
    if (options.commit || options.stash) {
      const revision = options.commit ? this.hash(options.commit) : this.stashRef(options.stash!);
      const parents = (await this.run(['rev-list', '--parents', '-n', '1', revision], { silent: true }))
        .trim()
        .split(' ');
      beforeLabel = parents[1]?.slice(0, 8) || this.t('Empty file');
      afterLabel = revision.slice(0, 12);
      const change = (await this.changedFiles(revision)).find((item) => item.path === file);
      before = parents[1]
        ? await this.content(parents[1], change?.originalPath || file, limit)
        : Buffer.alloc(0);
      after = await this.content(revision, file, limit);
      if (options.stash && after.length === 0) {
        const untrackedParent = await this.optional(['rev-parse', '--verify', `${revision}^3`]);
        if (untrackedParent.trim()) after = await this.content(untrackedParent.trim(), file, limit);
      }
    } else {
      const status = parseStatus(await this.run(['status', '--porcelain=v1', '-z'], { silent: true }));
      const change = status.find((item) => item.path === file);
      const head = (await this.optional(['rev-parse', '--verify', 'HEAD'])).trim();
      before = head ? await this.content(head, change?.originalPath || file, limit) : Buffer.alloc(0);
      try {
        const stat = await lstat(absolute);
        if (stat.isSymbolicLink()) {
          const { readlink } = await import('node:fs/promises');
          after = Buffer.from(await readlink(absolute));
        } else if (stat.isFile()) {
          if (stat.size > limit)
            return {
              path: file,
              before: '',
              after: '',
              beforeLabel,
              afterLabel,
              binary: false,
              truncated: true,
            };
          after = await readFile(absolute);
        } else
          return {
            path: file,
            before: '',
            after: '',
            beforeLabel,
            afterLabel,
            binary: true,
            truncated: false,
          };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') after = Buffer.alloc(0);
        else throw error;
      }
    }
    const binary = before.includes(0) || after.includes(0);
    const truncated = before.length > limit || after.length > limit;
    return {
      path: file,
      before: binary || truncated ? '' : before.toString('utf8'),
      after: binary || truncated ? '' : after.toString('utf8'),
      beforeLabel,
      afterLabel,
      binary,
      truncated,
    };
  }

  private async changedFiles(revision: string): Promise<Change[]> {
    const parents = (await this.run(['rev-list', '--parents', '-n', '1', revision], { silent: true }))
      .trim()
      .split(' ');
    const raw = await this.run(
      parents[1]
        ? ['diff', '--no-ext-diff', '--no-textconv', '-M', '--name-status', '-z', parents[1], revision, '--']
        : ['diff-tree', '--root', '--no-commit-id', '-r', '-M', '--name-status', '-z', revision],
      { silent: true },
    );
    const fields = raw.split('\0'),
      files: Change[] = [];
    for (let i = 0; i + 1 < fields.length;) {
      const status = fields[i++];
      const originalPath = status.startsWith('R') ? fields[i++] : undefined;
      const file = fields[i++];
      if (!file) continue;
      files.push({
        path: file,
        originalPath,
        index: status[0],
        worktree: ' ',
        status: status.startsWith('R')
          ? 'renamed'
          : status === 'A'
            ? 'added'
            : status === 'D'
              ? 'deleted'
              : 'modified',
        additions: 0,
        deletions: 0,
      });
    }
    return files;
  }

  async commitDetail(hash: string): Promise<CommitDetail> {
    this.hash(hash);
    const [log, message, files] = await Promise.all([
      this.run(['log', '-1', '-z', `--format=${LOG_FORMAT}`, hash], { silent: true }),
      this.run(['show', '-s', '--format=%B', hash], { silent: true }),
      this.changedFiles(hash),
    ]);
    return { commit: parseLog(log)[0], message: message.trim(), files };
  }

  // History of one branch head: the webview used to derive it from a decorated log
  // window, which truncated long histories and could mix in remote-tracking commits.
  async branchLog(name: string, remote: boolean | undefined, limit = 300): Promise<Commit[]> {
    const branch = await this.existingBranch(name, remote);
    const raw = await this.run(
      [
        'log',
        '--topo-order',
        '-z',
        `--max-count=${Math.min(2000, Math.max(1, limit))}`,
        `--format=${LOG_FORMAT}`,
        this.branchRef(branch),
        '--',
      ],
      { silent: true },
    );
    return parseLog(raw);
  }

  async existingFiles(files: string[]): Promise<string[]> {
    const found = await Promise.all(
      files.map(async (file) => {
        try {
          await lstat(await this.safePath(file));
          return file;
        } catch {
          // Missing, invalid and out-of-repository paths all count as deleted.
          return '';
        }
      }),
    );
    return found.filter(Boolean);
  }

  stage(paths: string[]): Promise<string> {
    return this.serialize(async () => {
      const changes = parseStatus(
        await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { silent: true }),
      );
      const requested = new Set(paths);
      const selected = changes.filter((change) => requested.has(change.path));
      if (!selected.length || selected.length !== requested.size)
        throw new Error(this.t('The file list has changed. Refresh and try again.'));
      if (selected.some((change) => change.status === 'conflict'))
        throw new Error(this.t('Resolve and mark conflict files in the merge editor first.'));
      const pathspecs = [
        ...new Set(
          selected.flatMap((change) =>
            change.originalPath ? [change.path, change.originalPath] : [change.path],
          ),
        ),
      ];
      for (const file of pathspecs) await this.safePath(file);
      await this.run(['add', '-A', '--', ...pathspecs]);
      return this.t('Staged {0} files.', selected.length);
    });
  }

  async commit(paths: string[], message: string): Promise<string> {
    if (!message.trim()) throw new Error(this.t('Enter a commit message.'));
    if (message.length > 100000) throw new Error(this.t('The commit message is too long.'));
    return this.serialize(async () => {
      if (
        (await this.existsGitPath('MERGE_HEAD')) ||
        (await this.isRebasing()) ||
        (await this.existsGitPath('CHERRY_PICK_HEAD')) ||
        (await this.existsGitPath('REVERT_HEAD'))
      )
        throw new Error(this.t('Complete or abort the current Git operation in the conflict banner first.'));
      const changes = parseStatus(
        await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { silent: true }),
      );
      const known = new Set(changes.map((change) => change.path)),
        requested = new Set(paths);
      if (!paths.length || paths.some((file) => !known.has(file)))
        throw new Error(this.t('The file list has changed. Refresh and select the files again.'));
      if (changes.some((change) => change.status === 'conflict'))
        throw new Error(this.t('Resolve all conflicts first.'));
      const selected = changes.filter((change) => requested.has(change.path));
      const pathspecs = [
        ...new Set(
          selected.flatMap((change) =>
            change.originalPath ? [change.path, change.originalPath] : [change.path],
          ),
        ),
      ];
      for (const file of pathspecs) await this.safePath(file);
      // --only commits the selected working-tree files and preserves unrelated staged content.
      // Adding first also makes untracked files eligible for a path-limited commit.
      await this.run(['add', '-A', '--', ...selected.map((change) => change.path)]);
      return this.run(['commit', '--only', '-m', message.trim(), '--', ...pathspecs]);
    });
  }

  fetch(): Promise<string> {
    return this.serialize(() => this.run(['fetch', '--all', '--prune'], { network: true }));
  }
  pull(strategy: 'ff-only' | 'rebase' | 'merge' = 'ff-only'): Promise<string> {
    return this.serialize(async () => {
      if (!(await this.optional(['rev-parse', '--verify', '@{upstream}'])).trim())
        throw new Error(this.t('The current branch has no upstream. Push and set an upstream first.'));
      if ((await this.run(['status', '--porcelain'], { silent: true })).trim())
        throw new Error(this.t('Commit or stash local changes before updating the project.'));
      return this.run(
        ['pull', strategy === 'rebase' ? '--rebase' : strategy === 'merge' ? '--no-rebase' : '--ff-only'],
        { network: true },
      );
    });
  }
  push(): Promise<string> {
    return this.serialize(async () => {
      const branch = (await this.run(['symbolic-ref', '--short', 'HEAD'], { silent: true })).trim();
      const upstream = (await this.optional(['rev-parse', '--abbrev-ref', '@{upstream}'])).trim();
      if (upstream) {
        const remote = (
          await this.run(['config', '--get', `branch.${branch}.remote`], { silent: true })
        ).trim();
        const target = (
          await this.run(['config', '--get', `branch.${branch}.merge`], { silent: true })
        ).trim();
        return this.run(['push', '--', remote, `HEAD:${target}`], { network: true });
      }
      const remotes = (await this.run(['remote'], { silent: true })).trim().split('\n').filter(Boolean);
      const remote = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : undefined;
      if (!remote)
        throw new Error(
          remotes.length
            ? this.t(
                'Multiple remotes are configured. Set the upstream for the current branch in a terminal first.',
              )
            : this.t('No remote is configured. Run git remote add origin <URL> first.'),
        );
      return this.run(['push', '--set-upstream', '--', remote, branch], { network: true });
    });
  }

  async outgoing(): Promise<PushPreview> {
    const branch = (await this.run(['symbolic-ref', '--short', 'HEAD'], { silent: true })).trim();
    const upstream = (await this.optional(['rev-parse', '--abbrev-ref', '@{upstream}'])).trim();
    const remotes = (await this.run(['remote'], { silent: true })).trim().split('\n').filter(Boolean);
    const remote = upstream
      ? (await this.run(['config', '--get', `branch.${branch}.remote`], { silent: true })).trim()
      : remotes.includes('origin')
        ? 'origin'
        : remotes.length === 1
          ? remotes[0]
          : '';
    const target = upstream
      ? (await this.run(['config', '--get', `branch.${branch}.merge`], { silent: true }))
          .trim()
          .replace(/^refs\/heads\//, '')
      : branch;
    const reference = upstream || (remote ? `refs/remotes/${remote}/${branch}` : '');
    const base = reference ? (await this.optional(['rev-parse', '--verify', reference])).trim() : '';
    const head = (await this.optional(['rev-parse', '--verify', 'HEAD'])).trim();
    if (!head) return { branch, remote, target, total: 0, commits: [] };
    const range = base ? `${base}..HEAD` : 'HEAD';
    const [log, count] = await Promise.all([
      this.run(['log', '--topo-order', '-z', '--max-count=100', `--format=${LOG_FORMAT}`, range, '--'], {
        silent: true,
      }),
      this.run(['rev-list', '--count', range, '--'], { silent: true }),
    ]);
    return { branch, remote, target, total: Number(count.trim()), commits: parseLog(log) };
  }

  async existingBranch(name: string, remote?: boolean) {
    const branches = parseBranches(
      await this.run(
        [
          'for-each-ref',
          '--format=%(refname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(subject)',
          'refs/heads',
          'refs/remotes',
        ],
        { silent: true },
      ),
    );
    const branch = branches.find(
      (item) => item.name === name && (remote === undefined || item.remote === remote),
    );
    if (!branch) throw new Error(this.t('The branch does not exist. Refresh and try again.'));
    return branch;
  }
  private branchRef(branch: { name: string; remote: boolean }) {
    return `refs/${branch.remote ? 'remotes' : 'heads'}/${branch.name}`;
  }
  private async validBranchName(name: string) {
    if (!name || name.startsWith('-') || name !== name.trim())
      throw new Error(this.t('Enter a valid branch name.'));
    await this.run(['check-ref-format', '--branch', name], { silent: true });
  }
  checkout(name: string, remote?: boolean): Promise<string> {
    return this.serialize(async () => {
      const branch = await this.existingBranch(name, remote);
      if (!branch.remote) return this.run(['switch', '--', name]);
      const local = name.slice(name.indexOf('/') + 1);
      const exists = await this.optional(['show-ref', '--verify', `refs/heads/${local}`]);
      if (exists) {
        const upstream = (
          await this.optional(['for-each-ref', '--format=%(upstream)', `refs/heads/${local}`])
        ).trim();
        if (upstream !== this.branchRef(branch))
          throw new Error(
            this.t(
              'Local branch "{0}" already exists and tracks a different upstream. Use "Create and Switch from This Branch" instead.',
              local,
            ),
          );
        return this.run(['switch', '--', local]);
      }
      return this.run(['switch', '--track', '-c', local, this.branchRef(branch)]);
    });
  }
  createBranch(name: string, source?: string, remote?: boolean): Promise<string> {
    return this.serialize(async () => {
      await this.validBranchName(name);
      const ref = source ? this.branchRef(await this.existingBranch(source, remote)) : undefined;
      return this.run(['switch', '--no-track', '-c', name, ...(ref ? [ref] : [])]);
    });
  }
  deleteBranch(name: string, remote = false): Promise<string> {
    return this.serialize(async () => {
      const branch = await this.existingBranch(name, remote);
      if (branch.current) throw new Error(this.t('The current branch cannot be deleted.'));
      if (!remote) return this.run(['branch', '-d', '--', name]);
      const slash = name.indexOf('/');
      const remoteName = name.slice(0, slash),
        target = name.slice(slash + 1);
      const remotes = (await this.run(['remote'], { silent: true })).trim().split('\n');
      if (slash < 1 || !remotes.includes(remoteName)) throw new Error(this.t('The remote does not exist.'));
      // Pin the expected old tip so a newly updated remote branch cannot be deleted by accident.
      const tip = (
        await this.run(['rev-parse', '--verify', this.branchRef(branch)], { silent: true })
      ).trim();
      return this.run(
        ['push', `--force-with-lease=refs/heads/${target}:${tip}`, '--', remoteName, `:refs/heads/${target}`],
        { network: true },
      );
    });
  }
  merge(name: string, remote?: boolean): Promise<string> {
    return this.serialize(async () => {
      const branch = await this.existingBranch(name, remote);
      return this.run(['merge', '--no-edit', '--', this.branchRef(branch)]);
    });
  }
  rebase(name: string, remote?: boolean): Promise<string> {
    return this.serialize(async () => {
      const branch = await this.existingBranch(name, remote);
      if (branch.current) throw new Error(this.t('Choose another branch as the rebase target.'));
      const state = await this.snapshot();
      if (state.detached || state.operation)
        throw new Error(this.t('Finish the current Git operation and switch to a local branch first.'));
      if (state.changes.length) throw new Error(this.t('Commit or stash local changes before rebasing.'));
      return this.run(['rebase', this.branchRef(branch)]);
    });
  }
  renameBranch(name: string, next: string): Promise<string> {
    return this.serialize(async () => {
      await this.existingBranch(name, false);
      await this.validBranchName(next);
      return this.run(['branch', '-m', '--', name, next]);
    });
  }
  setUpstream(name: string, upstream?: string): Promise<string> {
    return this.serialize(async () => {
      await this.existingBranch(name, false);
      if (!upstream) return this.run(['branch', '--unset-upstream', '--', name]);
      const target = await this.existingBranch(upstream, true);
      return this.run(['branch', `--set-upstream-to=${this.branchRef(target)}`, '--', name]);
    });
  }
  private fastForwardError(name: string, error: unknown) {
    if (error instanceof GitError && /non-fast-forward|not possible to fast-forward/i.test(error.output))
      return new Error(
        this.t(
          'Cannot update "{0}" because the local branch has commits that are not on its upstream. Merge or rebase it manually.',
          name,
        ),
      );
    return error;
  }
  updateBranch(name: string): Promise<string> {
    return this.serialize(async () => {
      const branch = await this.existingBranch(name, false);
      const upstream = (
        await this.optional(['for-each-ref', '--format=%(upstream)', `refs/heads/${name}`])
      ).trim();
      if (!upstream)
        throw new Error(this.t('Branch "{0}" has no upstream. Set an upstream branch first.', name));
      // Only the checked-out branch can be fast-forwarded through the working tree.
      if (branch.current) {
        if ((await this.run(['status', '--porcelain'], { silent: true })).trim())
          throw new Error(this.t('Commit or stash local changes before updating the branch.'));
        try {
          return await this.run(['pull', '--ff-only'], { network: true });
        } catch (error) {
          throw this.fastForwardError(name, error);
        }
      }
      const remote = (await this.optional(['config', '--get', `branch.${name}.remote`])).trim();
      const source = (await this.optional(['config', '--get', `branch.${name}.merge`])).trim();
      if (!remote || !source)
        throw new Error(this.t('Branch "{0}" has no upstream. Set an upstream branch first.', name));
      try {
        // Fetching straight into the local ref moves it without checking it out and
        // fails instead of merging when the branch has diverged from its upstream.
        await this.run(['fetch', '--prune', remote, `${source}:refs/heads/${name}`], { network: true });
      } catch (error) {
        throw this.fastForwardError(name, error);
      }
      return this.t('Updated branch "{0}" from {1}.', name, upstream);
    });
  }
  pushBranch(name: string): Promise<string> {
    return this.serialize(async () => {
      await this.existingBranch(name, false);
      const remote = (await this.optional(['config', '--get', `branch.${name}.remote`])).trim();
      const target = (await this.optional(['config', '--get', `branch.${name}.merge`])).trim();
      if (remote && target)
        return this.run(['push', '--', remote, `refs/heads/${name}:${target}`], { network: true });
      const remotes = (await this.run(['remote'], { silent: true })).trim().split('\n').filter(Boolean);
      const fallback = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : undefined;
      if (!fallback)
        throw new Error(
          remotes.length
            ? this.t('Multiple remotes are configured. Set the upstream for the branch in a terminal first.')
            : this.t('No remote is configured. Run git remote add origin <URL> first.'),
        );
      return this.run(['push', '--set-upstream', '--', fallback, `refs/heads/${name}:refs/heads/${name}`], {
        network: true,
      });
    });
  }
  async compareBranch(name: string, remote?: boolean, swap = false): Promise<BranchComparison> {
    const branch = await this.existingBranch(name, remote);
    const target = (
      await this.run(['rev-parse', '--verify', this.branchRef(branch)], { silent: true })
    ).trim();
    const current = (await this.run(['rev-parse', '--verify', 'HEAD'], { silent: true })).trim();
    // Counts always describe the current branch first, so the dialog reads the same after swapping.
    const counts = (
      await this.run(['rev-list', '--left-right', '--count', `${current}...${target}`], { silent: true })
    )
      .trim()
      .split(/\s+/)
      .map(Number);
    const base = swap ? current : target;
    const head = swap ? target : current;
    return {
      branch: name,
      base,
      head,
      ahead: counts[0],
      behind: counts[1],
      files: await this.comparisonFiles(base, head),
    };
  }
  private async comparisonFiles(base: string, head: string): Promise<Change[]> {
    const raw = await this.run(
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '-M',
        '--name-status',
        '-z',
        this.hash(base),
        this.hash(head),
        '--',
      ],
      { silent: true },
    );
    const fields = raw.split('\0'),
      files: Change[] = [];
    for (let i = 0; i + 1 < fields.length;) {
      const status = fields[i++];
      const originalPath = status.startsWith('R') ? fields[i++] : undefined;
      const file = fields[i++];
      if (file)
        files.push({
          path: file,
          originalPath,
          index: status[0],
          worktree: ' ',
          status: status.startsWith('R')
            ? 'renamed'
            : status === 'A'
              ? 'added'
              : status === 'D'
                ? 'deleted'
                : 'modified',
          additions: 0,
          deletions: 0,
        });
    }
    return files;
  }
  async branchDiff(file: string, base: string, head: string): Promise<FileDiff> {
    this.validatePath(file);
    this.hash(base);
    this.hash(head);
    const change = (await this.comparisonFiles(base, head)).find((item) => item.path === file);
    if (!change) throw new Error(this.t('The file is not part of this branch comparison.'));
    const before = await this.content(base, change.originalPath || file, 20 * MAX_FILE);
    const after = await this.content(head, file, 20 * MAX_FILE);
    const binary = before.includes(0) || after.includes(0),
      truncated = before.length > 20 * MAX_FILE || after.length > 20 * MAX_FILE;
    return {
      path: file,
      before: binary || truncated ? '' : before.toString('utf8'),
      after: binary || truncated ? '' : after.toString('utf8'),
      beforeLabel: base.slice(0, 8),
      afterLabel: head.slice(0, 8),
      binary,
      truncated,
    };
  }
  stash(message: string): Promise<string> {
    return this.serialize(() =>
      this.run(['stash', 'push', '--include-untracked', '-m', message.trim() || this.t('GitLoom stash')]),
    );
  }
  stashApply(ref: string, pop = false): Promise<string> {
    return this.serialize(() => this.run(['stash', pop ? 'pop' : 'apply', this.stashRef(ref)]));
  }
  stashDrop(ref: string): Promise<string> {
    return this.serialize(() => this.run(['stash', 'drop', this.stashRef(ref)]));
  }
  async stashFiles(ref: string): Promise<Change[]> {
    this.stashRef(ref);
    const raw = await this.run(['stash', 'show', '--include-untracked', '--name-status', '-z', ref], {
      silent: true,
    });
    const fields = raw.split('\0'),
      files: Change[] = [];
    for (let i = 0; i + 1 < fields.length;) {
      const status = fields[i++];
      const originalPath = status.startsWith('R') ? fields[i++] : undefined;
      files.push({
        path: fields[i++],
        originalPath,
        index: status[0],
        worktree: ' ',
        status: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified',
        additions: 0,
        deletions: 0,
      });
    }
    return files;
  }
  deleteFiles(paths: string[]): Promise<string> {
    return this.serialize(async () => {
      let removed = 0;
      for (const file of paths) {
        const absolute = await this.safePath(file);
        try {
          await lstat(absolute);
        } catch (error) {
          // Rows already deleted from disk stay harmless in a multi-file delete.
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        await rm(absolute, { force: true });
        removed++;
      }
      return this.t('Deleted {0} files from disk.', removed);
    });
  }
  ignorePaths(paths: string[], target: 'gitignore' | 'exclude' = 'gitignore'): Promise<string> {
    return this.serialize(async () => {
      const changes = parseStatus(
        await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { silent: true }),
      );
      const untracked = new Set(
        changes.filter((change) => change.status === 'untracked').map((change) => change.path),
      );
      const known = new Set(changes.map((change) => change.path));
      const selected: string[] = [];
      for (const file of paths) {
        this.validatePath(file);
        // Files that already disappeared from status are either ignored or committed.
        if (!known.has(file)) continue;
        if (!untracked.has(file))
          throw new Error(this.t('Ignore rules only apply to untracked files. Unstage or untrack it first.'));
        selected.push(file);
      }
      if (!selected.length) return this.t('The selected files are already ignored.');
      const file = target === 'exclude' ? await this.excludeFile() : path.join(this.root, '.gitignore');
      const existing = await readFile(file, 'utf8').catch(() => '');
      const lines = new Set(existing.split('\n').map((line) => line.trim()));
      const additions: string[] = [];
      for (const relative of selected) {
        // Anchor at the repository root so a file name cannot match a sibling directory.
        const pattern = `/${relative.replace(/ $/, '\\ ')}`;
        if (lines.has(pattern)) continue;
        lines.add(pattern);
        additions.push(pattern);
      }
      if (!additions.length) return this.t('The selected files are already ignored.');
      const separator = existing && !existing.endsWith('\n') ? '\n' : '';
      await writeFile(file, `${existing}${separator}${additions.join('\n')}\n`, 'utf8');
      return this.t(
        'Added {0} paths to {1}.',
        additions.length,
        target === 'exclude' ? '.git/info/exclude' : '.gitignore',
      );
    });
  }
  private async excludeFile(): Promise<string> {
    const value = (await this.optional(['rev-parse', '--git-path', 'info/exclude'])).trim();
    return value ? path.resolve(this.root, value) : path.join(this.root, '.git', 'info', 'exclude');
  }
  discard(paths: string[]): Promise<string> {
    return this.serialize(async () => {
      const changes = parseStatus(
        await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { silent: true }),
      );
      const requested = new Set(paths);
      const selected = changes.filter((change) => requested.has(change.path));
      if (!selected.length || selected.length !== requested.size)
        throw new Error(this.t('The file list has changed. Refresh and try again.'));
      if (selected.some((change) => change.status === 'conflict'))
        throw new Error(this.t('Conflict files cannot be discarded. Open the merge editor instead.'));
      const hasHead = !!(await this.optional(['rev-parse', '--verify', 'HEAD'])).trim();
      const tracked: string[] = [];
      for (const change of selected) {
        const absolute = await this.safePath(change.path);
        if (change.status === 'untracked') await rm(absolute, { force: true });
        else if (!hasHead)
          throw new Error(this.t('Handle staged files in the editor before the first commit.'));
        else tracked.push(...(change.originalPath ? [change.path, change.originalPath] : [change.path]));
      }
      return tracked.length
        ? this.run(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked])
        : this.t('Deleted the selected untracked files.');
    });
  }
  markResolved(file: string): Promise<string> {
    return this.serialize(async () => {
      await this.safePath(file);
      return this.run(['add', '--', file]);
    });
  }
  cherryPick(hash: string): Promise<string> {
    return this.serialize(() => this.run(['cherry-pick', this.hash(hash)]));
  }
  revert(hash: string): Promise<string> {
    return this.serialize(() => this.run(['revert', '--no-edit', this.hash(hash)]));
  }
  reset(hash: string): Promise<string> {
    return this.serialize(async () => {
      const target = this.hash(hash);
      if (
        (await this.existsGitPath('MERGE_HEAD')) ||
        (await this.isRebasing()) ||
        (await this.existsGitPath('CHERRY_PICK_HEAD')) ||
        (await this.existsGitPath('REVERT_HEAD'))
      )
        throw new Error(this.t('Complete or abort the current Git operation in the conflict banner first.'));
      return this.run(['reset', '--hard', target]);
    });
  }
  continueOperation(): Promise<string> {
    return this.serialize(async () => {
      if (await this.isRebasing()) return this.run(['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } });
      if (await this.existsGitPath('MERGE_HEAD')) return this.run(['commit', '--no-edit']);
      if (await this.existsGitPath('CHERRY_PICK_HEAD'))
        return this.run(['cherry-pick', '--continue'], { env: { GIT_EDITOR: 'true' } });
      if (await this.existsGitPath('REVERT_HEAD'))
        return this.run(['revert', '--continue'], { env: { GIT_EDITOR: 'true' } });
      throw new Error(this.t('There is no Git operation to continue.'));
    });
  }
  abortOperation(): Promise<string> {
    return this.serialize(async () => {
      if (await this.isRebasing()) return this.run(['rebase', '--abort']);
      if (await this.existsGitPath('MERGE_HEAD')) return this.run(['merge', '--abort']);
      if (await this.existsGitPath('CHERRY_PICK_HEAD')) return this.run(['cherry-pick', '--abort']);
      if (await this.existsGitPath('REVERT_HEAD')) return this.run(['revert', '--abort']);
      throw new Error(this.t('There is no Git operation to abort.'));
    });
  }
}
