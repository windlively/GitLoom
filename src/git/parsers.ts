import type { Branch, Change, Commit, Stash } from '../shared/types';

export function parseStatus(raw: string): Change[] {
  const records = raw.split('\0');
  const changes: Change[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.length < 4) continue;
    const index = record[0],
      worktree = record[1];
    const path = record.slice(3);
    const originalPath = /[RC]/.test(index + worktree) ? records[++i] : undefined;
    const conflict = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(index + worktree);
    const status = conflict
      ? 'conflict'
      : index === '?'
        ? 'untracked'
        : /R/.test(index + worktree)
          ? 'renamed'
          : /D/.test(index + worktree)
            ? 'deleted'
            : /A/.test(index + worktree)
              ? 'added'
              : 'modified';
    changes.push({ path, originalPath, index, worktree, status, additions: 0, deletions: 0 });
  }
  return changes;
}

export function parseNumstat(raw: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();
  const records = raw.split('\0');
  for (let i = 0; i < records.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(records[i]);
    if (!match) continue;
    let file = match[3];
    if (!file) {
      i += 2;
      file = records[i];
    }
    if (file) stats.set(file, { additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0 });
  }
  return stats;
}

export function parseLog(raw: string): Commit[] {
  const fields = raw.split('\0');
  const commits: Commit[] = [];
  for (let i = 0; i + 6 < fields.length; i += 7) {
    const hash = fields[i].trim();
    if (!/^[a-f0-9]{40,64}$/.test(hash)) continue;
    commits.push({
      hash,
      parents: fields[i + 1].split(' ').filter(Boolean),
      author: fields[i + 2],
      email: fields[i + 3],
      date: fields[i + 4],
      subject: fields[i + 5],
      refs: fields[i + 6].split(', ').filter(Boolean),
    });
  }
  return commits;
}

export function parseBranches(raw: string): Branch[] {
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, head, upstream, subject] = line.split('\0');
      return {
        name: ref.replace(/^refs\/(heads|remotes)\//, ''),
        current: head === '*',
        remote: ref.startsWith('refs/remotes/'),
        upstream: upstream || '',
        subject: subject || '',
      };
    })
    .filter((branch) => !branch.name.endsWith('/HEAD'));
}

export function parseStashes(raw: string): Stash[] {
  const fields = raw.split('\0');
  const stashes: Stash[] = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    stashes.push({ ref: fields[i].trim(), hash: fields[i + 1], subject: fields[i + 2], date: fields[i + 3] });
  }
  return stashes;
}
