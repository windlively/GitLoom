import type { Change, Commit, FileDiff, Method, Requests, Snapshot } from '../../src/shared/types';

const sourceBefore = `import { useCallback, useState } from 'react';
import { Command } from '@/components/ui/command';
import { useProjects } from '@/hooks/use-projects';

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const { projects } = useProjects();

  const handleSelect = useCallback((id: string) => {
    window.location.href = '/projects/' + id;
    setOpen(false);
  }, []);

  return (
    <Command open={open} onOpenChange={setOpen}>
      <Command.Input placeholder="Search projects..." />
      <Command.List>
        {projects.map((project) => (
          <Command.Item key={project.id}
            onSelect={() => handleSelect(project.id)}>
            {project.name}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}
`;
const sourceAfter = sourceBefore
  .replace(
    'import { useProjects }',
    "import { useRouter } from 'next/navigation';\nimport { Search, Folder } from 'lucide-react';\nimport { useProjects }",
  )
  .replace('  const { projects }', '  const router = useRouter();\n  const { projects }')
  .replace("window.location.href = '/projects/' + id;", 'router.push(`/projects/${id}`);')
  .replace('  }, []);', '  }, [router]);')
  .replace(
    '<Command.Input placeholder="Search projects..." />',
    '<Command.Input placeholder="搜索项目或输入命令…" />\n      <Command.Empty>没有找到相关项目</Command.Empty>',
  )
  .replace(
    '            {project.name}',
    '            <Folder className="size-4" />\n            {project.name}',
  );
const hash = (n: number) =>
  Array.from({ length: 5 }, (_, i) =>
    (Math.imul(n + i, 0x9e3779b1) >>> 0).toString(16).padStart(8, '0'),
  ).join('');
const changes: Change[] = [
  ['src/components/command-menu.tsx', 'modified', 12, 4],
  ['src/components/sidebar.tsx', 'modified', 8, 3],
  ['src/hooks/use-keyboard.ts', 'modified', 16, 2],
  ['src/styles/globals.css', 'modified', 7, 0],
  ['package.json', 'modified', 2, 1],
  ['src/components/command-shortcut.tsx', 'untracked', 28, 0],
  ['src/lib/commands.ts', 'untracked', 35, 0],
].map(([file, status, additions, deletions]) => ({
  path: file as string,
  status: status as Change['status'],
  index: status === 'untracked' ? '?' : ' ',
  worktree: status === 'untracked' ? '?' : 'M',
  additions: additions as number,
  deletions: deletions as number,
}));
const subjects = [
  'feat: 添加全局命令面板和快捷键支持',
  'feat: 项目侧边栏支持快速切换',
  "Merge branch 'main' into feature/command-menu",
  'fix: 修复深色模式下的边框颜色',
  'feat: 新增项目搜索和筛选',
  'feat: 添加键盘导航支持',
  'refactor: 提取通用布局组件',
  'chore: 更新依赖和项目配置',
  'feat: 实现项目概览页面',
  'feat: 初始化设计系统',
  'chore: initial commit',
];
const commits: Commit[] = subjects.map((subject, i) => ({
  hash: hash(30 - i),
  parents: i === 2 ? [hash(27), hash(26)] : i === 3 ? [hash(24)] : i === 10 ? [] : [hash(29 - i)],
  author: ['Lin', 'Alex Chen', 'Lin'][i % 3],
  email: 'dev@example.com',
  date: new Date(Date.now() - i * 3700_000).toISOString(),
  subject,
  refs:
    i === 0
      ? ['HEAD -> feature/command-menu']
      : i === 2
        ? ['origin/feature/command-menu']
        : i === 3
          ? ['main', 'origin/main']
          : i === 6
            ? ['feature/project-search']
            : [],
}));
const state: Snapshot = {
  repositories: [{ name: 'atlas-web', path: '/preview/atlas-web' }],
  repository: { name: 'atlas-web', path: '/preview/atlas-web' },
  branch: 'feature/command-menu',
  detached: false,
  upstream: 'origin/feature/command-menu',
  ahead: 2,
  behind: 0,
  changes,
  commits,
  branches: [
    {
      name: 'feature/command-menu',
      current: true,
      remote: false,
      upstream: 'origin/feature/command-menu',
      subject: subjects[0],
    },
    { name: 'main', current: false, remote: false, upstream: 'origin/main', subject: subjects[3] },
    { name: 'feature/project-search', current: false, remote: false, upstream: '', subject: subjects[6] },
    { name: 'origin/main', current: false, remote: true, upstream: '', subject: subjects[3] },
    { name: 'origin/feature/command-menu', current: false, remote: true, upstream: '', subject: subjects[2] },
  ],
  stashes: [
    {
      ref: 'stash@{0}',
      hash: hash(2),
      subject: 'On main: WIP: 项目设置页',
      date: new Date(Date.now() - 86400_000).toISOString(),
    },
  ],
  remotes: ['origin'],
  changelists: [],
  merging: false,
  rebasing: false,
  operation: null,
  updatedAt: Date.now(),
};

export async function previewRequest<M extends Method>(
  method: M,
  params: Requests[M]['params'],
): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const p = params as Record<string, any>;
  if (method === 'snapshot') return structuredClone({ ...state, updatedAt: Date.now() });
  if (method === 'diff')
    return {
      path: p.path,
      before: sourceBefore,
      after: sourceAfter,
      beforeLabel: p.commit ? p.commit.slice(0, 8) + '^' : 'HEAD',
      afterLabel: p.commit ? p.commit.slice(0, 8) : '工作区',
      binary: false,
      truncated: false,
    } satisfies FileDiff;
  if (method === 'commitDetail')
    return {
      commit: state.commits.find((commit) => commit.hash === p.hash)!,
      message: state.commits.find((commit) => commit.hash === p.hash)?.subject,
      files: changes.slice(0, 3),
    };
  if (method === 'outgoing')
    return {
      branch: state.branch,
      remote: 'origin',
      target: state.branch,
      total: state.ahead,
      commits: state.commits.slice(0, state.ahead),
    };
  if (method === 'commit') {
    const commit: Commit = {
      hash: hash(Date.now()),
      parents: [state.commits[0].hash],
      author: 'You',
      email: 'you@example.com',
      date: new Date().toISOString(),
      subject: p.message.split('\n')[0],
      refs: [`HEAD -> ${state.branch}`],
    };
    state.commits[0].refs = [];
    state.commits.unshift(commit);
    state.changes = state.changes.filter((change) => !p.paths.includes(change.path));
    state.ahead += 1;
    if (p.push) state.ahead = 0;
    return { output: '预览：提交已完成' };
  }
  if (method === 'checkout' || method === 'createBranch') {
    const name = p.branch || p.name;
    if (!state.branches.some((branch) => branch.name === name))
      state.branches.unshift({
        name,
        current: false,
        remote: false,
        upstream: '',
        subject: state.commits[0].subject,
      });
    state.branch = name;
    state.branches.forEach((branch) => {
      branch.current = branch.name === name;
    });
    return '预览：已切换分支';
  }
  if (method === 'compareBranch')
    return {
      branch: p.branch,
      base: state.commits[4].hash,
      head: state.commits[0].hash,
      ahead: 3,
      behind: 1,
      files: changes.slice(0, 4),
    };
  if (method === 'renameBranch') {
    const branch = state.branches.find((branch) => branch.name === p.branch && !branch.remote);
    if (branch) branch.name = p.name;
    if (state.branch === p.branch) state.branch = p.name;
    return '预览：分支已重命名';
  }
  if (method === 'setUpstream') {
    const branch = state.branches.find((branch) => branch.name === p.branch && !branch.remote);
    if (branch) branch.upstream = p.upstream || '';
    return '预览：已设置上游';
  }
  if (method === 'deleteBranch') {
    state.branches = state.branches.filter((branch) => branch.name !== p.name);
    return '预览：分支已删除';
  }
  if (method === 'push') {
    state.ahead = 0;
    return '预览：推送已完成';
  }
  if (method === 'stash') {
    state.stashes.unshift({
      ref: 'stash@{0}',
      hash: hash(4),
      subject: `On ${state.branch}: ${p.message || 'WIP'}`,
      date: new Date().toISOString(),
    });
    state.changes = [];
    return '预览：更改已暂存';
  }
  if (method === 'stashDrop' || (method === 'stashApply' && p.pop)) {
    state.stashes = state.stashes.filter((stash) => stash.ref !== p.ref);
    return '预览：操作已完成';
  }
  if (method === 'stashFiles') return structuredClone(changes.slice(0, 2));
  if (method === 'discard') {
    state.changes = state.changes.filter((change) => !p.paths.includes(change.path));
    return '预览：更改已回滚';
  }
  if (method === 'changelist') {
    if (p.action === 'create') state.changelists.push({ id: `list-${Date.now()}`, name: p.name, paths: [] });
    if (p.action === 'delete') state.changelists = state.changelists.filter((list) => list.id !== p.id);
    if (p.action === 'move')
      state.changelists.forEach((list) => {
        list.paths = [
          ...list.paths.filter((file) => !p.paths.includes(file)),
          ...(list.id === p.id ? p.paths : []),
        ];
      });
  }
  return '预览：操作已完成';
}
