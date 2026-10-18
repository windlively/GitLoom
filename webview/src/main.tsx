import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpFromLine,
  BookOpen,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  Clock3,
  Code2,
  Command,
  Ellipsis,
  ExternalLink,
  File,
  FileCode2,
  FileJson,
  FolderClosed,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitFork,
  GitMerge,
  History,
  Info,
  Layers,
  ListChecks,
  ListTree,
  LoaderCircle,
  Maximize2,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Undo2,
  X,
} from './icons';
import type {
  Activity,
  Branch,
  BranchComparison,
  Change,
  Commit,
  CommitDetail,
  FileDiff,
  Method,
  PushPreview,
  Requests,
  Snapshot,
  View,
} from '../../src/shared/types';
import { isPreview, loadState, request, saveState, setRepository, subscribe } from './bridge';
import { makeDiffRows } from './diff';
import { COMMIT_ROW_HEIGHT, makeGraph } from './graph';
import { defaultSizes, restoreSizes, ResizeHandle, type PaneSizes } from './resize';
import { DialogWindow, restoreDialogFrames, type DialogFrame } from './dialog-window';
import { BranchDropdown } from './branch-dropdown';
import { groupBranches, type BranchFolder } from './branch-groups';
import { ContextMenu, type MenuAction } from './context-menu';
import { SelectMenu, type SelectOption } from './select-menu';
import { offsetRange, uniformRange, useViewport } from './virtual';
import './styles.css';

if (isPreview && new URLSearchParams(window.location.search).get('layout') === 'panel') {
  document.body.dataset.host = 'panel';
}
const panelLayout = true;
const FILE_ROW_HEIGHT = 22,
  GROUP_ROW_HEIGHT = 24;
const NO_CHANGES: Change[] = [];

type Dialog = {
  type:
    'newBranch' | 'renameBranch' | 'upstream' | 'compare' | 'changelist' | 'stash' | 'push' | 'move' | 'help';
  branch?: Branch;
};
type Stored = {
  view: View;
  drafts: Record<string, string>;
  sizes?: Partial<PaneSizes>;
  dialogs?: Record<string, DialogFrame>;
  branchGrouped?: boolean;
};
const stored = loadState<Stored>({
  view: (document.body.dataset.initialView as View) || 'changes',
  drafts: {},
});
const statusLabels = {
  modified: '已修改',
  added: '新增',
  deleted: '已删除',
  renamed: '已重命名',
  untracked: '未跟踪',
  conflict: '冲突',
};
const statusLetters = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflict: '!',
};
const stageState = (change: Change): 'staged' | 'partial' | '' =>
  change.status === 'conflict' ||
  change.status === 'untracked' ||
  change.index === ' ' ||
  change.index === '?'
    ? ''
    : change.worktree === ' '
      ? 'staged'
      : 'partial';
const basename = (file: string) => file.split('/').at(-1) || file;
const dirname = (file: string) => file.split('/').slice(0, -1).join('/');
const shortDate = (date: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(date));

function IconButton({
  title,
  children,
  onClick,
  disabled,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${className}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Empty({
  icon = <GitCompareArrows size={36} strokeWidth={1.3} />,
  title,
  detail,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {children}
    </div>
  );
}
function FileIcon({ file }: { file: string }) {
  if (file.endsWith('.json')) return <FileJson size={16} className="file-type json" />;
  return (
    <FileCode2
      size={16}
      className={`file-type ${/\.tsx?$/.test(file) ? 'ts' : file.endsWith('.css') ? 'css' : ''}`}
    />
  );
}

function Code({ text }: { text: string }) {
  const parts = text.split(
    /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`|\/\/.*$|\b(?:import|from|export|function|const|let|return|if|else|async|await|new|true|false|interface|type|null)\b|\b\d+\b)/g,
  );
  return (
    <>
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            /^['"`]/.test(part)
              ? 'token-string'
              : /^(import|from|export|function|const|let|return|if|else|async|await|new|true|false|interface|type|null)$/.test(
                    part,
                  )
                ? 'token-keyword'
                : part.startsWith('//')
                  ? 'token-comment'
                  : /^\d+$/.test(part)
                    ? 'token-number'
                    : ''
          }
        >
          {part}
        </span>
      ))}
    </>
  );
}

function DiffViewer({
  diff,
  loading,
  openNative,
  close,
  previous,
  next,
  split,
  setSplit,
}: {
  diff: FileDiff | null;
  loading: boolean;
  openNative: () => void;
  close?: () => void;
  previous?: () => void;
  next?: () => void;
  split: number;
  setSplit: (value: number) => void;
}) {
  const [unified, setUnified] = useState(false),
    [context, setContext] = useState(false);
  const leftPane = useRef<HTMLDivElement>(null),
    rightPane = useRef<HTMLDivElement>(null);
  const comparison = useMemo(() => {
    try {
      return {
        rows: diff && !diff.binary && !diff.truncated ? makeDiffRows(diff.before, diff.after, context) : [],
        error: '',
      };
    } catch (error) {
      return { rows: [], error: (error as Error).message };
    }
  }, [diff, context]);
  const rows = comparison.rows;
  const additions = rows.filter((row) => row.type === 'change' && row.rightNumber).length;
  const deletions = rows.filter((row) => row.type === 'change' && row.leftNumber).length;
  if (!diff)
    return (
      <div className="diff-view">
        <Empty
          title={loading ? '正在读取差异…' : '选择文件，查看更改'}
          detail="在左侧选择一个文件，即可并排审查改动。"
        />
      </div>
    );
  return (
    <section
      className={`diff-view ${loading ? 'is-loading' : ''}`}
      aria-label="文件差异"
      style={{ '--diff-split': `${split}%` } as React.CSSProperties}
    >
      <div className="diff-toolbar">
        <FileIcon file={diff.path} />
        <span className="diff-path">
          <span>
            {dirname(diff.path)}
            {dirname(diff.path) && ' / '}
          </span>
          <strong>{basename(diff.path)}</strong>
        </span>
        <span className="diff-stat">
          <b>+{additions}</b>
          <i>−{deletions}</i>
        </span>
        <div className="spacer" />
        <IconButton
          title={context ? '显示完整文件' : '只显示改动及上下文'}
          onClick={() => setContext(!context)}
          className={context ? 'active' : ''}
        >
          <SlidersHorizontal size={15} />
        </IconButton>
        <IconButton
          title={unified ? '切换为并排 Diff' : '切换为统一 Diff'}
          onClick={() => setUnified(!unified)}
        >
          <ArrowLeftRight size={15} />
        </IconButton>
        {previous && (
          <IconButton title="上一个文件" onClick={previous}>
            <ChevronLeft size={16} />
          </IconButton>
        )}
        {next && (
          <IconButton title="下一个文件" onClick={next}>
            <ChevronRight size={16} />
          </IconButton>
        )}
        <IconButton title="在 VS Code 中打开 Diff" onClick={openNative}>
          <ExternalLink size={15} />
        </IconButton>
        {close && (
          <IconButton title="关闭差异" onClick={close}>
            <X size={15} />
          </IconButton>
        )}
      </div>
      <div className="diff-labels">
        <div>
          <span className="revision-dot" />
          {diff.beforeLabel}
          <span className="muted">原始版本</span>
        </div>
        <div>
          <span className="revision-dot local" />
          {diff.afterLabel}
          <span className="muted">{diff.afterLabel === '工作区' ? '本地更改' : '提交版本'}</span>
        </div>
      </div>
      {diff.binary || diff.truncated || comparison.error ? (
        <Empty
          icon={<File size={32} />}
          title={comparison.error || (diff.binary ? '二进制文件或子模块' : '文件超过预览大小限制')}
          detail="可使用 VS Code 原生差异编辑器继续查看。"
        >
          <button className="button" onClick={openNative}>
            <ExternalLink size={14} />
            打开 Diff
          </button>
        </Empty>
      ) : !rows.length ? (
        <Empty title="没有文本差异" detail="文件可能仅修改了权限，或内容已经相同。" />
      ) : (
        <div className={`diff-code ${unified ? 'unified' : ''}`} tabIndex={0}>
          {unified
            ? rows.flatMap((row, i) =>
                row.type === 'change' ? (
                  [
                    row.leftNumber ? (
                      <div className="unified-row removed" key={`${i}-l`}>
                        <span className="line-number">{row.leftNumber}</span>
                        <span className="line-number" />
                        <span className="line-sign">−</span>
                        <code>
                          <Code text={row.left} />
                        </code>
                      </div>
                    ) : null,
                    row.rightNumber ? (
                      <div className="unified-row added" key={`${i}-r`}>
                        <span className="line-number" />
                        <span className="line-number">{row.rightNumber}</span>
                        <span className="line-sign">+</span>
                        <code>
                          <Code text={row.right} />
                        </code>
                      </div>
                    ) : null,
                  ]
                ) : (
                  <div className="unified-row" key={i}>
                    <span className="line-number">{row.leftNumber}</span>
                    <span className="line-number">{row.rightNumber}</span>
                    <span className="line-sign"> </span>
                    <code>
                      <Code text={row.left} />
                    </code>
                  </div>
                ),
              )
            : (['left', 'right'] as const).map((side) => (
                <div
                  className="diff-side"
                  key={side}
                  ref={side === 'left' ? leftPane : rightPane}
                  onScroll={(event) => {
                    const other = side === 'left' ? rightPane.current : leftPane.current;
                    if (other && Math.abs(other.scrollTop - event.currentTarget.scrollTop) > 1)
                      other.scrollTop = event.currentTarget.scrollTop;
                  }}
                >
                  <div className="diff-lines">
                    {rows.map((row, i) => (
                      <div
                        className={`code-cell code-line ${row.type === 'change' ? (row[side === 'left' ? 'leftNumber' : 'rightNumber'] ? (side === 'left' ? 'removed' : 'added') : 'missing') : ''}`}
                        key={i}
                      >
                        <span className="line-number">
                          {row[side === 'left' ? 'leftNumber' : 'rightNumber']}
                        </span>
                        <code>
                          <Code text={row[side]} />
                        </code>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          {!unified && (
            <ResizeHandle
              label="调整左右 Diff 宽度"
              target=".diff-side"
              percent
              value={split}
              reset={50}
              min={20}
              onChange={setSplit}
              style={{ left: 'var(--diff-split)' }}
            />
          )}
        </div>
      )}
      <div className="diff-footer">
        <span>UTF-8</span>
        <span>{diff.after.includes('\r\n') ? 'CRLF' : 'LF'}</span>
        <div className="spacer" />
        <span>{rows.filter((row) => row.type === 'change').length} 行差异</span>
        <span className="legend-dot removed-dot" />
        删除
        <span className="legend-dot added-dot" />
        新增
      </div>
    </section>
  );
}

function App() {
  const [sizes, setSizes] = useState(() => restoreSizes(stored.sizes));
  const resize = (key: keyof PaneSizes) => (value: number) =>
    setSizes((previous) => ({ ...previous, [key]: value }));
  const [dialogFrames, setDialogFrames] = useState<Record<string, DialogFrame>>(() =>
    restoreDialogFrames(stored.dialogs),
  );
  const rememberDialogFrame = useCallback((type: Dialog['type'], frame?: DialogFrame) => {
    setDialogFrames((previous) => {
      if (!frame) {
        if (!(type in previous)) return previous;
        const next = { ...previous };
        delete next[type];
        return next;
      }
      return { ...previous, [type]: frame };
    });
  }, []);
  const [branchMenu, setBranchMenu] = useState<{
    branch: Branch;
    x: number;
    y: number;
    fromDropdown?: boolean;
  } | null>(null);
  const closeBranchMenu = useCallback(() => setBranchMenu(null), []);
  const [commitMenu, setCommitMenu] = useState<{ commit: Commit; x: number; y: number } | null>(null);
  const closeCommitMenu = useCallback(() => setCommitMenu(null), []);
  const [branchDropdown, setBranchDropdown] = useState<HTMLButtonElement | null>(null);
  const [comparison, setComparison] = useState<BranchComparison | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>(stored.view);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fileSelection, setFileSelection] = useState<Set<string>>(new Set());
  const fileSelectionAnchor = useRef('');
  const [fileMenu, setFileMenu] = useState<{ paths: string[]; x: number; y: number } | null>(null);
  const closeFileMenu = useCallback(() => setFileMenu(null), []);
  const [activeFile, setActiveFile] = useState('');
  const [diff, setDiff] = useState<FileDiff | null>(null),
    [diffLoading, setDiffLoading] = useState(false);
  const [drafts, setDrafts] = useState(stored.drafts),
    [busy, setBusy] = useState(''),
    [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [dialogValue, setDialogValue] = useState('');
  const [activities, setActivities] = useState<Activity[]>([]),
    [consoleOpen, setConsoleOpen] = useState(false);
  const [fileQuery, setFileQuery] = useState(''),
    [branchQuery, setBranchQuery] = useState(''),
    [logQuery, setLogQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState(''),
    [activeCommit, setActiveCommit] = useState(''),
    [detail, setDetail] = useState<CommitDetail | null>(null);
  const [branchGrouped, setBranchGrouped] = useState(stored.branchGrouped === true);
  const [collapsedBranchFolders, setCollapsedBranchFolders] = useState<Set<string>>(new Set());
  const [historyFile, setHistoryFile] = useState(''),
    [activeStash, setActiveStash] = useState(''),
    [stashFiles, setStashFiles] = useState<Change[]>([]);
  const [stashFile, setStashFile] = useState(''),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pushPreview, setPushPreview] = useState<PushPreview | null>(null);
  const root = useRef<string | undefined>(undefined),
    diffSequence = useRef(0),
    commitInput = useRef<HTMLTextAreaElement>(null);
  const fileViewport = useViewport(),
    logViewport = useViewport();
  const currentDraft = drafts[snapshot?.repository?.path || ''] || '';
  const changes = snapshot?.changes ?? NO_CHANGES;
  const isBusy = !!busy;
  const applySnapshot = useCallback((state: Snapshot) => {
    const changedRepository = root.current !== state.repository?.path;
    if (changedRepository) {
      root.current = state.repository?.path;
      setRepository(root.current);
      setSelected(
        new Set(
          state.changes
            .filter((change) => change.status !== 'untracked' && change.status !== 'conflict')
            .map((change) => change.path),
        ),
      );
      setActiveFile(state.changes[0]?.path || '');
      setFileSelection(new Set());
      fileSelectionAnchor.current = '';
      setFileMenu(null);
      setActiveCommit(state.commits[0]?.hash || '');
      setBranchFilter('');
      setActiveStash(state.stashes[0]?.ref || '');
      setHistoryFile('');
      setStashFile('');
      setActivities([]);
      setDiff(null);
    } else {
      const paths = new Set(state.changes.map((change) => change.path));
      setSelected((previous) => new Set([...previous].filter((file) => paths.has(file))));
      setActiveFile((previous) => (paths.has(previous) ? previous : state.changes[0]?.path || ''));
      setFileSelection((previous) => new Set([...previous].filter((file) => paths.has(file))));
      setActiveCommit((previous) =>
        state.commits.some((commit) => commit.hash === previous) ? previous : state.commits[0]?.hash || '',
      );
      setActiveStash((previous) =>
        state.stashes.some((stash) => stash.ref === previous) ? previous : state.stashes[0]?.ref || '',
      );
    }
    // Reusing an identical history keeps the memoized commit graph when only working files changed.
    setSnapshot((previous) =>
      previous &&
      !changedRepository &&
      previous.commits.length === state.commits.length &&
      JSON.stringify(previous.commits) === JSON.stringify(state.commits)
        ? { ...state, commits: previous.commits }
        : state,
    );
  }, []);
  const refresh = useCallback(
    async (repository?: string) => {
      setRefreshing(true);
      try {
        applySnapshot(await request('snapshot', repository ? { repository } : {}));
      } catch (error) {
        setNotice({ message: (error as Error).message, error: true });
      } finally {
        setRefreshing(false);
      }
    },
    [applySnapshot],
  );
  useEffect(() => {
    void refresh();
    return subscribe((message) => {
      if (message.type === 'snapshot') applySnapshot(message.snapshot);
      if (message.type === 'view') {
        setView(message.view);
        if (message.view === 'changes') setTimeout(() => commitInput.current?.focus(), 100);
      }
      if (message.type === 'pushDialog') setDialog({ type: 'push' });
      if (message.type === 'error') setNotice({ message: message.message, error: true });
      if (message.type === 'activity')
        setActivities((previous) => [message.entry, ...previous].slice(0, 100));
    });
  }, [refresh, applySnapshot]);
  useEffect(() => {
    saveState({ view, drafts, sizes, dialogs: dialogFrames, branchGrouped });
  }, [view, drafts, sizes, dialogFrames, branchGrouped]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (dialog?.type !== 'push') {
      setPushPreview(null);
      return;
    }
    let cancelled = false;
    void request('outgoing', {})
      .then((value) => {
        if (!cancelled) setPushPreview(value);
      })
      .catch((error) => {
        if (!cancelled) setNotice({ message: error.message, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [dialog?.type, snapshot?.branch, snapshot?.upstream, snapshot?.ahead]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('.modal');
    const focusable = () => [
      ...(modal?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]',
      ) || []),
    ];
    (modal?.querySelector<HTMLElement>('input') || focusable()[0])?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = focusable(),
        first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', trap);
    return () => {
      window.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [dialog]);
  useEffect(() => {
    setComparison(null);
    if (dialog?.type !== 'compare' || !dialog.branch) return;
    let cancelled = false;
    void request('compareBranch', { branch: dialog.branch.name, remote: dialog.branch.remote })
      .then((value) => {
        if (!cancelled) setComparison(value);
      })
      .catch((error) => {
        if (!cancelled) setNotice({ message: error.message, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [dialog, snapshot?.repository?.path]);
  const perform = async <M extends Method>(
    method: M,
    params: Requests[M]['params'],
    label: string,
    after?: () => void,
  ) => {
    if (isBusy) return;
    setBusy(label);
    setNotice(null);
    try {
      const result = await request(method, params);
      if (isPreview)
        setActivities((previous) => [
          {
            id: String(Date.now()),
            time: Date.now(),
            command: `preview: ${method}`,
            output: label + '完成（示例数据）',
            error: false,
          },
          ...previous,
        ]);
      after?.();
      if (!['openFile', 'openDiff', 'resolve', 'copyBranch', 'openBranchDiff'].includes(method))
        await refresh();
      const pushError = method === 'commit' ? (result as Requests['commit']['result']).pushError : undefined;
      setNotice(
        pushError
          ? { message: `本地提交已完成，推送失败：${pushError}`, error: true }
          : { message: label + '完成', error: false },
      );
    } catch (error) {
      setNotice({ message: (error as Error).message, error: true });
      await refresh();
    } finally {
      setBusy('');
    }
  };
  useEffect(() => {
    if (view !== 'log' || !activeCommit) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    void request('commitDetail', { hash: activeCommit })
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((error) => {
        if (!cancelled) setNotice({ message: error.message, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [activeCommit, view, snapshot?.repository?.path]);
  useEffect(() => {
    if (view !== 'stash' || !activeStash) {
      setStashFiles([]);
      return;
    }
    let cancelled = false;
    setStashFiles([]);
    void request('stashFiles', { ref: activeStash })
      .then((value) => {
        if (!cancelled) {
          setStashFiles(value);
          setStashFile(value[0]?.path || '');
        }
      })
      .catch((error) => {
        if (!cancelled) setNotice({ message: error.message, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [activeStash, view, snapshot?.repository?.path]);
  const diffFile = view === 'changes' ? activeFile : view === 'log' ? historyFile : stashFile;
  useEffect(() => {
    const sequence = ++diffSequence.current;
    if (!diffFile || !snapshot?.repository) {
      setDiff(null);
      setDiffLoading(false);
      return;
    }
    setDiffLoading(true);
    setDiff((previous) => (previous?.path === diffFile ? previous : null));
    void request('diff', {
      path: diffFile,
      ...(view === 'log' ? { commit: activeCommit } : view === 'stash' ? { stash: activeStash } : {}),
    })
      .then((value) => {
        if (sequence === diffSequence.current) setDiff(value);
      })
      .catch((error) => {
        if (sequence === diffSequence.current) setNotice({ message: error.message, error: true });
      })
      .finally(() => {
        if (sequence === diffSequence.current) setDiffLoading(false);
      });
  }, [diffFile, view, activeCommit, activeStash, snapshot?.updatedAt, snapshot?.repository?.path]);
  const commitPaths = (paths: string[], push = false) => {
    if (!paths.length || isBusy) return;
    setSelected(new Set(paths));
    if (!currentDraft.trim()) {
      commitInput.current?.focus();
      setNotice({ message: '请先填写提交说明。', error: true });
      return;
    }
    const chosen = new Set(paths);
    if (changes.some((change) => change.status === 'conflict' && chosen.has(change.path))) {
      setNotice({ message: '请先解决所有冲突。', error: true });
      return;
    }
    void perform('commit', { paths, message: currentDraft, push }, push ? '提交并推送' : '提交', () => {
      setDrafts((previous) => ({ ...previous, [snapshot!.repository!.path]: '' }));
    });
  };
  const commit = (push = false) => commitPaths([...selected], push);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) setDialog(null);
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !dialog && view === 'changes') {
        event.preventDefault();
        commit(event.shiftKey);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'r') {
        event.preventDefault();
        void refresh();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });
  const showDialog = (value: Dialog) => {
    setBranchMenu(null);
    setDialogValue(
      value.type === 'renameBranch'
        ? value.branch?.name || ''
        : value.type === 'upstream'
          ? value.branch?.upstream || ''
          : '',
    );
    setDialog(value);
  };
  const toggle = (file: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      next.has(file) ? next.delete(file) : next.add(file);
      return next;
    });
  const toggleGroup = (files: Change[]) =>
    setSelected((previous) => {
      const next = new Set(previous);
      const checked = files.every((file) => previous.has(file.path));
      files.forEach((file) => {
        if (checked) next.delete(file.path);
        else next.add(file.path);
      });
      return next;
    });
  const filteredChanges = useMemo(() => {
    const query = fileQuery.toLowerCase();
    return query ? changes.filter((change) => change.path.toLowerCase().includes(query)) : changes;
  }, [changes, fileQuery]);
  const changelists = snapshot?.changelists;
  const groups = useMemo(() => {
    const lists = (changelists || []).map((list) => ({ ...list, members: new Set(list.paths) }));
    const listed = new Set(lists.flatMap((list) => list.paths));
    return [
      {
        id: 'conflicts',
        name: '合并冲突',
        files: filteredChanges.filter((change) => change.status === 'conflict'),
      },
      {
        id: 'default',
        name: '默认更改列表',
        files: filteredChanges.filter(
          (change) =>
            change.status !== 'untracked' && change.status !== 'conflict' && !listed.has(change.path),
        ),
      },
      ...lists.map((list) => ({
        id: list.id,
        name: list.name,
        files: filteredChanges.filter(
          (change) => list.members.has(change.path) && change.status !== 'conflict',
        ),
      })),
      {
        id: 'untracked',
        name: '未版本化的文件',
        files: filteredChanges.filter((change) => change.status === 'untracked' && !listed.has(change.path)),
      },
    ].filter((group) => group.files.length || (!['conflicts', 'untracked'].includes(group.id) && !fileQuery));
  }, [filteredChanges, changelists, fileQuery]);
  const visibleFilePaths = useMemo(
    () =>
      groups.flatMap((group) => (collapsed.has(group.id) ? [] : group.files.map((change) => change.path))),
    [groups, collapsed],
  );
  const fileItems = useMemo(() => {
    const items: ({ kind: 'group'; group: (typeof groups)[number] } | { kind: 'file'; change: Change })[] =
      [];
    const offsets = [0];
    for (const group of groups) {
      items.push({ kind: 'group', group });
      offsets.push(offsets.at(-1)! + GROUP_ROW_HEIGHT);
      if (collapsed.has(group.id)) continue;
      for (const change of group.files) {
        items.push({ kind: 'file', change });
        offsets.push(offsets.at(-1)! + FILE_ROW_HEIGHT);
      }
    }
    return { items, offsets };
  }, [groups, collapsed]);
  const [fileStart, fileEnd] = offsetRange(fileItems.offsets, fileViewport);
  const selectFileRow = (
    path: string,
    modifiers?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => {
    setActiveFile(path);
    if (modifiers?.shiftKey && fileSelectionAnchor.current) {
      const from = visibleFilePaths.indexOf(fileSelectionAnchor.current);
      const to = visibleFilePaths.indexOf(path);
      if (from >= 0 && to >= 0) {
        const range = visibleFilePaths.slice(Math.min(from, to), Math.max(from, to) + 1);
        const additive = modifiers.metaKey || modifiers.ctrlKey;
        setFileSelection((previous) => new Set(additive ? [...previous, ...range] : range));
        return;
      }
    }
    if (modifiers?.metaKey || modifiers?.ctrlKey) {
      fileSelectionAnchor.current = path;
      setFileSelection((previous) => {
        const next = new Set(previous);
        next.has(path) ? next.delete(path) : next.add(path);
        return next;
      });
      return;
    }
    fileSelectionAnchor.current = path;
    setFileSelection(new Set([path]));
  };
  const openFileMenu = (change: Change, x: number, y: number) => {
    const paths = fileSelection.has(change.path) ? [...fileSelection] : [change.path];
    if (!fileSelection.has(change.path)) {
      fileSelectionAnchor.current = change.path;
      setFileSelection(new Set([change.path]));
    }
    setActiveFile(change.path);
    setFileMenu({ paths, x, y });
  };
  const fileActions = (paths: string[]): MenuAction[] => {
    const chosen = new Set(paths);
    const targets = changes.filter((change) => chosen.has(change.path));
    const conflict = targets.some((change) => change.status === 'conflict');
    const alreadyStaged = targets.length > 0 && targets.every((change) => stageState(change) === 'staged');
    return [
      {
        label: paths.length > 1 ? `添加到 Git（${paths.length} 个文件）` : '添加到 Git',
        icon: <Plus size={14} />,
        disabled: isBusy || !targets.length || conflict || alreadyStaged,
        run: () => void perform('stage', { paths }, '添加到 Git'),
      },
      {
        label: '提交所选文件…',
        icon: <GitCommitHorizontal size={14} />,
        separator: true,
        disabled: isBusy || !targets.length || conflict || !!snapshot?.operation,
        run: () => commitPaths(paths),
      },
    ];
  };
  const totalAdded = changes
    .filter((change) => selected.has(change.path))
    .reduce((sum, change) => sum + change.additions, 0);
  const totalDeleted = changes
    .filter((change) => selected.has(change.path))
    .reduce((sum, change) => sum + change.deletions, 0);
  const localBranches = (snapshot?.branches || []).filter(
    (branch) => !branch.remote && branch.name.toLowerCase().includes(branchQuery.toLowerCase()),
  );
  const remoteBranches = (snapshot?.branches || []).filter(
    (branch) => branch.remote && branch.name.toLowerCase().includes(branchQuery.toLowerCase()),
  );
  const visibleCommits = useMemo(() => {
    let commits = snapshot?.commits || [];
    if (branchFilter) {
      const tip = commits.find((commit) =>
        commit.refs.some((ref) => ref === branchFilter || ref === `HEAD -> ${branchFilter}`),
      );
      const reachable = new Set<string>();
      const queue = tip ? [tip.hash] : [];
      const map = new Map(commits.map((commit) => [commit.hash, commit]));
      while (queue.length) {
        const hash = queue.pop()!;
        if (!reachable.has(hash)) {
          reachable.add(hash);
          queue.push(...(map.get(hash)?.parents || []));
        }
      }
      commits = commits.filter((commit) => reachable.has(commit.hash));
    }
    const query = logQuery.toLowerCase();
    return commits.filter((commit) =>
      `${commit.subject} ${commit.author} ${commit.hash}`.toLowerCase().includes(query),
    );
  }, [snapshot?.commits, branchFilter, logQuery]);
  const graph = useMemo(() => makeGraph(visibleCommits), [visibleCommits]);
  const [logStart, logEnd] = uniformRange(visibleCommits.length, COMMIT_ROW_HEIGHT, logViewport);
  const repositoryOptions = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [];
    if (!snapshot?.repository) list.push({ value: '', label: '选择仓库' });
    for (const repo of snapshot?.repositories ?? [])
      list.push({ value: repo.path, label: repo.name, title: repo.path });
    list.push({ value: '__pick', label: '打开其他仓库…', separator: true });
    return list;
  }, [snapshot?.repository, snapshot?.repositories]);
  const branchFilterOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: '所有分支' },
      ...(snapshot?.branches ?? []).map((branch) => ({
        value: branch.name,
        label: branch.name,
        title: branch.remote ? `远程分支 ${branch.name}` : branch.name,
      })),
    ],
    [snapshot?.branches],
  );
  const selectedFiles = [...selected];
  const openNative = () => {
    if (diffFile)
      void perform(
        'openDiff',
        { path: diffFile, ...(view === 'log' ? { commit: activeCommit } : {}) },
        '打开 Diff',
      );
  };
  const closeBranchDropdown = () => {
    setBranchDropdown(null);
    setBranchMenu((current) => (current?.fromDropdown ? null : current));
  };
  const openBranchMenu = (branch: Branch, x: number, y: number) => {
    setBranchDropdown(null);
    setCommitMenu(null);
    setBranchMenu({ branch, x, y });
  };
  const openBranchSubmenu = (branch: Branch, x: number, y: number) => {
    setCommitMenu(null);
    setBranchMenu((current) =>
      current?.fromDropdown && current.branch.name === branch.name && current.branch.remote === branch.remote
        ? current
        : { branch, x, y, fromDropdown: true },
    );
  };
  const dismissBranchSubmenu = () => {
    setBranchMenu((current) => (current?.fromDropdown ? null : current));
  };
  const openCommitMenu = (commit: Commit, x: number, y: number) => {
    setBranchDropdown(null);
    setBranchMenu(null);
    setCommitMenu({ commit, x, y });
  };
  const branchActions = (branch: Branch): MenuAction[] => {
    const params = { branch: branch.name, remote: branch.remote };
    const locked = isBusy || !!snapshot?.operation;
    const actions: MenuAction[] = [
      {
        label: branch.current ? '当前分支' : branch.remote ? '检出并跟踪远程分支' : '检出分支',
        icon: <Check size={14} />,
        disabled: locked || branch.current,
        run: () => void perform('checkout', params, '切换分支', () => setDialog(null)),
      },
      {
        label: '从此分支新建并切换…',
        icon: <Plus size={14} />,
        disabled: locked,
        run: () => showDialog({ type: 'newBranch', branch }),
      },
      {
        label: '与当前分支比较…',
        icon: <GitCompareArrows size={14} />,
        disabled: isBusy || branch.current,
        separator: true,
        run: () => showDialog({ type: 'compare', branch }),
      },
      {
        label: '显示此分支历史',
        icon: <History size={14} />,
        run: () => {
          setBranchFilter(branch.name);
          setView('log');
          setDialog(null);
        },
      },
      {
        label: `从 ${branch.name} 分支合并到当前分支`,
        icon: <GitMerge size={14} />,
        disabled: locked || branch.current,
        separator: true,
        run: () => void perform('merge', params, '合并分支', () => setDialog(null)),
      },
      {
        label: `将当前分支 Rebase 到 ${branch.name} 分支`,
        icon: <GitFork size={14} />,
        disabled: locked || branch.current || snapshot?.detached,
        run: () => void perform('rebase', params, 'Rebase', () => setDialog(null)),
      },
    ];
    if (!branch.remote)
      actions.push(
        {
          label: '重命名分支…',
          icon: <Settings2 size={14} />,
          disabled: locked,
          separator: true,
          run: () => showDialog({ type: 'renameBranch', branch }),
        },
        {
          label: '设置上游分支…',
          icon: <Box size={14} />,
          disabled: locked,
          run: () => showDialog({ type: 'upstream', branch }),
        },
      );
    if (branch.current)
      actions.push(
        {
          label: '拉取并更新当前分支',
          icon: <ArrowDownToLine size={14} />,
          disabled: locked || !snapshot?.upstream,
          separator: true,
          run: () => void perform('pull', {}, '更新项目', () => setDialog(null)),
        },
        {
          label: '推送当前分支…',
          icon: <ArrowUpFromLine size={14} />,
          disabled: locked,
          run: () => showDialog({ type: 'push' }),
        },
      );
    actions.push(
      {
        label: '复制分支名称',
        icon: <Code2 size={14} />,
        separator: true,
        run: () => void perform('copyBranch', params, '复制分支名称'),
      },
      {
        label: branch.remote ? '删除远程分支…' : '删除分支…',
        icon: <Trash2 size={14} />,
        disabled: locked || branch.current,
        danger: true,
        run: () =>
          void perform('deleteBranch', { name: branch.name, remote: branch.remote }, '删除分支', () =>
            setDialog(null),
          ),
      },
    );
    return actions;
  };
  const commitActions = (target: Commit): MenuAction[] => {
    const locked = isBusy || !!snapshot?.operation;
    return [
      {
        label: '优选提交（Cherry-pick）',
        icon: <GitCommitHorizontal size={14} />,
        disabled: locked,
        run: () => void perform('cherryPick', { hash: target.hash }, 'Cherry-pick'),
      },
      {
        label: '还原提交（Revert）',
        icon: <Undo2 size={14} />,
        disabled: locked,
        run: () => void perform('revert', { hash: target.hash }, '还原提交'),
      },
      {
        label: '强制重置当前分支到此提交…',
        icon: <RefreshCw size={14} />,
        disabled: locked || snapshot?.detached,
        separator: true,
        danger: true,
        run: () => void perform('reset', { hash: target.hash }, '强制重置'),
      },
    ];
  };
  const branchRow = (branch: Branch, label = branch.name, depth = 0) => (
    <div
      className={`branch-row ${branch.current ? 'current' : ''} ${branchFilter === branch.name && view === 'log' ? 'selected' : ''}`}
      style={depth ? { paddingLeft: 8 + depth * 12 } : undefined}
      key={`${branch.remote}-${branch.name}`}
      onContextMenu={(event) => {
        event.preventDefault();
        openBranchMenu(branch, event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          openBranchMenu(branch, rect.left + 15, rect.bottom);
        }
      }}
    >
      <button
        className="branch-name"
        title={`${branch.name}\n${branch.subject}\n单击查看历史，右键进行分支操作，双击检出`}
        onClick={() => {
          setBranchFilter(branch.name);
          setView('log');
        }}
        onDoubleClick={() => {
          if (!branch.current && !isBusy)
            void perform('checkout', { branch: branch.name, remote: branch.remote }, '切换分支');
        }}
      >
        <GitBranch size={14} />
        <span>{label}</span>
        {branch.current && <span className="current-dot" />}
      </button>
      <button
        className="icon-button"
        title={`操作分支 ${branch.name}`}
        aria-label={`操作分支 ${branch.name}`}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          openBranchMenu(branch, rect.right, rect.bottom);
        }}
      >
        <Ellipsis size={15} />
      </button>
    </div>
  );
  const toggleBranchFolder = (key: string) =>
    setCollapsedBranchFolders((previous) => {
      const next = new Set(previous);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const branchFolder = (folder: BranchFolder, scope: 'local' | 'remote', depth: number) => {
    const key = `${scope}:${folder.path}`;
    const open = !collapsedBranchFolders.has(key);
    return (
      <div className="branch-folder" key={key}>
        <button
          className="branch-section branch-folder-heading"
          style={{ paddingLeft: 8 + depth * 12 }}
          aria-expanded={open}
          title={`${open ? '折叠' : '展开'}分支分组 ${folder.path}`}
          onClick={() => toggleBranchFolder(key)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FolderClosed size={13} />
          <span>{folder.name}</span>
          <small>{folder.count}</small>
        </button>
        {open && (
          <>
            {folder.folders.map((child) => branchFolder(child, scope, depth + 1))}
            {folder.branches.map((item) => branchRow(item.branch, item.label, depth + 1))}
          </>
        )}
      </div>
    );
  };
  const branchList = (branches: Branch[], scope: 'local' | 'remote') => {
    if (!branchGrouped) return branches.map((branch) => branchRow(branch));
    return groupBranches(branches, scope === 'remote' ? snapshot?.remotes || [] : []).map((entry) =>
      entry.kind === 'branch' ? branchRow(entry.branch, entry.label) : branchFolder(entry, scope, 0),
    );
  };
  // Section keys have no ':' so they cannot collide with folder keys like `local:feature`.
  const branchSection = (scope: 'local' | 'remote', title: string, branches: Branch[]) => {
    const open = !collapsedBranchFolders.has(scope);
    return (
      <>
        <button
          className={`branch-section branch-folder-heading${scope === 'remote' ? ' remote-heading' : ''}`}
          aria-expanded={open}
          title={`${open ? '折叠' : '展开'}${title}分支`}
          onClick={() => toggleBranchFolder(scope)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{title}</span>
          <small>{branches.length}</small>
        </button>
        {open && branchList(branches, scope)}
      </>
    );
  };

  return (
    <div
      className="app-shell"
      style={
        Object.fromEntries(
          Object.entries(sizes).map(([key, value]) => [`--${key}-size`, `${value}px`]),
        ) as React.CSSProperties
      }
    >
      <header className="app-header">
        <div className="repo-selector">
          <FolderGit2 size={16} />
          <SelectMenu
            ariaLabel="选择仓库"
            placeholder="选择仓库"
            value={snapshot?.repository?.path || ''}
            options={repositoryOptions}
            menuMinWidth={240}
            onChange={(value) => {
              if (value === '__pick') void perform('pickRepository', {}, '选择仓库');
              else if (value) void refresh(value);
            }}
            disabled={isBusy || refreshing}
          />
        </div>
        {panelLayout && (
          <>
            <button
              className="current-branch panel-current-branch"
              onClick={(event) => {
                const trigger = event.currentTarget;
                if (branchDropdown === trigger) {
                  closeBranchDropdown();
                  return;
                }
                setBranchMenu(null);
                setCommitMenu(null);
                setBranchDropdown(trigger);
              }}
              disabled={!snapshot?.repository}
              title="切换、合并或新建分支"
              aria-haspopup="dialog"
              aria-expanded={!!branchDropdown}
              onContextMenu={(event) => {
                event.preventDefault();
                const branch = snapshot?.branches.find((branch) => branch.current);
                if (branch) openBranchMenu(branch, event.clientX, event.clientY);
              }}
            >
              <GitBranch size={13} />
              <span>{snapshot?.branch || '未打开仓库'}</span>
              <ChevronDown size={11} />
            </button>
            <nav className="panel-tabs" aria-label="Git 视图">
              <button className={view === 'changes' ? 'selected' : ''} onClick={() => setView('changes')}>
                <ListChecks size={14} />
                更改<span>{changes.length}</span>
              </button>
              <button
                className={view === 'log' ? 'selected' : ''}
                onClick={() => {
                  setView('log');
                  setBranchFilter('');
                }}
              >
                <History size={14} />
                历史
              </button>
              <button className={view === 'stash' ? 'selected' : ''} onClick={() => setView('stash')}>
                <Layers size={14} />
                Stash<span>{snapshot?.stashes.length || 0}</span>
              </button>
            </nav>
          </>
        )}
        {isPreview && <span className="preview-badge">交互预览 · 示例仓库</span>}
        <div className="spacer" />
        <button
          className="toolbar-button"
          disabled={isBusy || !snapshot?.remotes.length}
          title="获取所有远程仓库的最新信息"
          onClick={() => void perform('fetch', {}, '获取远程更新')}
        >
          <RefreshCw size={14} />
          获取
        </button>
        <button
          className="toolbar-button"
          disabled={isBusy || !snapshot?.upstream}
          title="更新项目"
          onClick={() => void perform('pull', {}, '更新项目')}
        >
          <ArrowDownToLine size={15} />
          拉取{snapshot?.behind ? <span className="count">{snapshot.behind}</span> : null}
        </button>
        <button
          className="button push-button"
          disabled={isBusy || !snapshot?.repository || snapshot.detached}
          onClick={() => showDialog({ type: 'push' })}
        >
          <ArrowUpFromLine size={14} />
          推送{snapshot?.ahead ? <span>{snapshot.ahead}</span> : null}
        </button>
        <IconButton title="刷新工作台" disabled={isBusy || refreshing} onClick={() => void refresh()}>
          <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
        </IconButton>
        <IconButton title="使用指南与快捷键" onClick={() => showDialog({ type: 'help' })}>
          <BookOpen size={16} />
        </IconButton>
      </header>
      <div className="workspace-body">
        <aside className="sidebar">
          <div className="workspace-caption">
            工作区
            <span className="caption-dot" />
          </div>
          <nav className="main-nav" aria-label="Git 导航">
            <button className={view === 'changes' ? 'selected' : ''} onClick={() => setView('changes')}>
              <ListChecks size={17} />
              <span>本地更改</span>
              <b>{changes.length}</b>
            </button>
            <button
              className={view === 'log' && !branchFilter ? 'selected' : ''}
              onClick={() => {
                setBranchFilter('');
                setView('log');
              }}
            >
              <History size={17} />
              <span>提交历史</span>
            </button>
            <button className={view === 'stash' ? 'selected' : ''} onClick={() => setView('stash')}>
              <Layers size={17} />
              <span>Stash</span>
              <b>{snapshot?.stashes.length || 0}</b>
            </button>
          </nav>
          <div className="sidebar-rule" />
          <div className="branch-heading">
            <span>分支</span>
            <IconButton
              title={branchGrouped ? '切换为平铺分支列表' : '按前缀分组分支'}
              className={branchGrouped ? 'active' : ''}
              disabled={!snapshot?.repository}
              onClick={() => setBranchGrouped((value) => !value)}
            >
              <ListTree size={15} />
            </IconButton>
            <IconButton
              title="新建分支"
              disabled={isBusy || !snapshot?.repository || !snapshot.commits.length}
              onClick={() => showDialog({ type: 'newBranch' })}
            >
              <Plus size={15} />
            </IconButton>
          </div>
          <label className="search-box branch-search">
            <Search size={13} />
            <input
              aria-label="搜索分支"
              placeholder="搜索分支…"
              value={branchQuery}
              onChange={(event) => {
                setBranchQuery(event.target.value);
                setCollapsedBranchFolders(new Set());
              }}
            />
            <kbd>⌕</kbd>
          </label>
          <div className="branches-scroll">
            {branchSection('local', '本地', localBranches)}
            {branchSection('remote', '远程', remoteBranches)}
            {!localBranches.length && !remoteBranches.length && (
              <p className="sidebar-empty">{branchQuery ? '没有匹配的分支' : '首次提交后会显示分支'}</p>
            )}
          </div>
        </aside>
        <ResizeHandle
          label="调整分支栏宽度"
          className="sidebar-resize"
          target=".sidebar"
          value={sizes.sidebar}
          reset={defaultSizes.sidebar}
          onChange={resize('sidebar')}
          reserve={650}
          style={{ left: 'var(--sidebar-width)' }}
        />
        <main className="main-content">
          {(snapshot?.operation || changes.some((change) => change.status === 'conflict')) && (
            <div className="operation-banner">
              <GitMerge size={16} />
              <span>
                {snapshot?.rebasing
                  ? 'Rebase 进行中'
                  : snapshot?.merging
                    ? '合并进行中'
                    : snapshot?.operation === 'cherry-pick'
                      ? 'Cherry-pick 进行中'
                      : snapshot?.operation === 'revert'
                        ? 'Revert 进行中'
                        : 'Git 操作存在冲突'}{' '}
                · 解决冲突后标记为已解决，再继续操作。
              </span>
              <button disabled={isBusy} onClick={() => void perform('continueOperation', {}, '继续操作')}>
                继续
              </button>
              <button disabled={isBusy} onClick={() => void perform('abortOperation', {}, '中止操作')}>
                中止
              </button>
            </div>
          )}
          {!snapshot ? (
            <Empty icon={<LoaderCircle size={32} className="spin" />} title="正在连接 Git 仓库…" />
          ) : !snapshot.repository ? (
            <Empty
              icon={<FolderGit2 size={42} />}
              title="从一个 Git 仓库开始"
              detail="打开已有仓库，即可按熟悉的方式管理更改、分支和提交。"
            >
              <button
                className="button primary"
                disabled={isBusy}
                onClick={() => void perform('pickRepository', {}, '打开仓库')}
              >
                <FolderClosed size={15} />
                打开仓库
              </button>
            </Empty>
          ) : view === 'changes' ? (
            <div className="changes-workspace">
              <ResizeHandle
                label="调整文件列表宽度"
                min={150}
                target=".file-list"
                value={sizes.files}
                reset={defaultSizes.files}
                onChange={resize('files')}
                reserve=".commit-panel"
                style={{ left: 'var(--file-width)' }}
              />
              <ResizeHandle
                label="调整提交栏宽度"
                min={180}
                target=".commit-panel"
                side="right"
                value={sizes.commit}
                reset={defaultSizes.commit}
                onChange={resize('commit')}
                reserve=".file-list"
                style={{ right: 'var(--commit-width)' }}
              />
              <section className="changes-panel" aria-label="本地更改列表">
                <div className="panel-toolbar">
                  <span className="panel-title">
                    更改<span className="count">{changes.length}</span>
                  </span>
                  <div className="spacer" />
                  <IconButton
                    title="新建更改列表"
                    disabled={isBusy}
                    onClick={() => showDialog({ type: 'changelist' })}
                  >
                    <Plus size={15} />
                  </IconButton>
                  <IconButton
                    title="移动勾选文件到更改列表"
                    disabled={!selected.size || isBusy}
                    onClick={() => showDialog({ type: 'move' })}
                  >
                    <FolderClosed size={14} />
                  </IconButton>
                  <IconButton
                    title="回滚勾选的更改"
                    disabled={!selected.size || isBusy}
                    onClick={() => void perform('discard', { paths: selectedFiles }, '回滚更改')}
                  >
                    <Undo2 size={14} />
                  </IconButton>
                </div>
                <label className="search-box file-search">
                  <Search size={14} />
                  <input
                    aria-label="搜索更改文件"
                    placeholder="按文件名筛选…"
                    value={fileQuery}
                    onChange={(event) => setFileQuery(event.target.value)}
                  />
                  {fileQuery && (
                    <button aria-label="清除文件筛选" onClick={() => setFileQuery('')}>
                      <X size={13} />
                    </button>
                  )}
                </label>
                <div className="file-list" ref={fileViewport.ref}>
                  {!changes.length ? (
                    <Empty
                      icon={<CircleCheck size={32} />}
                      title="工作区很干净"
                      detail="新的改动会出现在这里。"
                    />
                  ) : !filteredChanges.length ? (
                    <Empty icon={<Search size={26} />} title="没有匹配的文件" />
                  ) : (
                    <div
                      style={{
                        paddingTop: fileItems.offsets[fileStart],
                        paddingBottom: fileItems.offsets.at(-1)! - fileItems.offsets[fileEnd],
                      }}
                    >
                      {fileItems.items.slice(fileStart, fileEnd).map((item) => {
                        if (item.kind === 'group') {
                          const group = item.group;
                          return (
                            <div className="group-heading" key={`group:${group.id}`}>
                              <button
                                className="collapse-button"
                                aria-label={`${collapsed.has(group.id) ? '展开' : '折叠'} ${group.name}`}
                                onClick={() =>
                                  setCollapsed((previous) => {
                                    const next = new Set(previous);
                                    next.has(group.id) ? next.delete(group.id) : next.add(group.id);
                                    return next;
                                  })
                                }
                              >
                                {collapsed.has(group.id) ? (
                                  <ChevronRight size={13} />
                                ) : (
                                  <ChevronDown size={13} />
                                )}
                              </button>
                              <input
                                type="checkbox"
                                aria-label={`选择 ${group.name}`}
                                ref={(element) => {
                                  if (element)
                                    element.indeterminate =
                                      group.files.some((file) => selected.has(file.path)) &&
                                      !group.files.every((file) => selected.has(file.path));
                                }}
                                checked={
                                  !!group.files.length && group.files.every((file) => selected.has(file.path))
                                }
                                onChange={() =>
                                  toggleGroup(group.files.filter((file) => file.status !== 'conflict'))
                                }
                                disabled={isBusy || group.id === 'conflicts'}
                              />
                              <span className={group.id === 'conflicts' ? 'red' : ''}>{group.name}</span>
                              <small>{group.files.length}</small>
                              {group.id === 'default' && <span className="default-tag">默认</span>}
                              {!['default', 'conflicts', 'untracked'].includes(group.id) && (
                                <IconButton
                                  title={`删除更改列表 ${group.name}`}
                                  disabled={isBusy}
                                  onClick={() =>
                                    void perform(
                                      'changelist',
                                      { action: 'delete', id: group.id },
                                      '删除更改列表',
                                    )
                                  }
                                >
                                  <X size={12} />
                                </IconButton>
                              )}
                            </div>
                          );
                        }
                        const change = item.change;
                        const stage = stageState(change);
                        return (
                          <div
                            className={`file-row ${activeFile === change.path ? 'selected' : ''} ${fileSelection.has(change.path) ? 'marked' : ''}`}
                            key={`file:${change.path}`}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              openFileMenu(change, event.clientX, event.clientY);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                                event.preventDefault();
                                const rect = event.currentTarget.getBoundingClientRect();
                                openFileMenu(change, rect.left + 15, rect.bottom);
                              }
                            }}
                          >
                            <input
                              type="checkbox"
                              aria-label={`选择文件 ${change.path}`}
                              checked={selected.has(change.path)}
                              disabled={isBusy || change.status === 'conflict'}
                              onChange={() => toggle(change.path)}
                            />
                            <button
                              className="file-select"
                              data-path={change.path}
                              title={`${change.path}\n${statusLabels[change.status]}${stage ? `\n${stage === 'staged' ? '修改已全部暂存' : '已暂存部分修改，工作区还有未暂存修改'}` : ''}\nShift / ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} 点击可多选`}
                              onClick={(event) => selectFileRow(change.path, event)}
                              onKeyDown={(event) => {
                                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
                                  if (event.key === ' ' && !isBusy && change.status !== 'conflict') {
                                    event.preventDefault();
                                    toggle(change.path);
                                  }
                                  return;
                                }
                                event.preventDefault();
                                const buttons = [
                                  ...event.currentTarget
                                    .closest('.file-list')!
                                    .querySelectorAll<HTMLButtonElement>('.file-select'),
                                ];
                                const index =
                                  buttons.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1);
                                const next = buttons[Math.max(0, Math.min(buttons.length - 1, index))];
                                if (!next) return;
                                next.focus();
                                const path = next.dataset.path || '';
                                if (event.shiftKey)
                                  selectFileRow(path, {
                                    shiftKey: true,
                                    metaKey: false,
                                    ctrlKey: false,
                                  });
                                else if (event.metaKey || event.ctrlKey) setActiveFile(path);
                                else selectFileRow(path);
                              }}
                              onDoubleClick={() =>
                                void perform('openDiff', { path: change.path }, '打开 Diff')
                              }
                            >
                              <FileIcon file={change.path} />
                              <span className="file-label">
                                <strong>{basename(change.path)}</strong>
                                <small>{dirname(change.path) || '项目根目录'}</small>
                              </span>
                              {stage && (
                                <span
                                  className={`stage-badge ${stage}`}
                                  title={
                                    stage === 'staged'
                                      ? '该文件的修改已全部暂存'
                                      : '已暂存部分修改，工作区还有未暂存修改'
                                  }
                                >
                                  {stage === 'staged' ? '已暂存' : '部分暂存'}
                                </span>
                              )}
                              <span
                                className={`file-status ${change.status}`}
                                title={`状态：${statusLabels[change.status]}`}
                              >
                                {statusLetters[change.status]}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="selection-summary">
                  <span>
                    已勾选 <b>{selected.size}</b> / {changes.length} 个文件
                    {fileSelection.size > 1 && <em> · 已选 {fileSelection.size}</em>}
                  </span>
                  <span className="diff-stat">
                    <b>+{totalAdded}</b>
                    <i>−{totalDeleted}</i>
                  </span>
                </div>
                <div className="commit-panel">
                  <div className="commit-heading">
                    <GitCommitHorizontal size={16} />
                    <strong>提交更改</strong>
                    <span>COMMIT</span>
                  </div>
                  <textarea
                    ref={commitInput}
                    aria-label="提交说明"
                    placeholder={'写下这次更改的目的…\n\n例如：feat: 添加全局命令面板'}
                    value={currentDraft}
                    onChange={(event) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [snapshot.repository!.path]: event.target.value,
                      }))
                    }
                    disabled={isBusy}
                  />
                  <div className="commit-caption">
                    <span>
                      <CheckCheck size={13} />
                      仅提交勾选文件的全部改动
                    </span>
                    <span>{currentDraft.split('\n')[0].length}/72</span>
                  </div>
                  <div className="commit-actions">
                    <button
                      className="button primary"
                      disabled={isBusy || !selected.size || !currentDraft.trim() || !!snapshot.operation}
                      onClick={() => commit()}
                    >
                      {busy.startsWith('提交') ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Check size={14} />
                      )}
                      提交{selected.size ? <span>{selected.size}</span> : null}
                    </button>
                    <button
                      className="button"
                      disabled={
                        isBusy ||
                        !selected.size ||
                        !currentDraft.trim() ||
                        !snapshot.remotes.length ||
                        snapshot.detached ||
                        !!snapshot.operation
                      }
                      onClick={() => commit(true)}
                    >
                      提交并推送
                      <ArrowUpRightIcon />
                    </button>
                  </div>
                  <div className="keyboard-hint">
                    <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd>
                    <kbd>↵</kbd>
                    <span>提交更改</span>
                    <button
                      disabled={isBusy || !changes.length}
                      title="暂存所有本地更改（包含未跟踪文件）"
                      onClick={() => showDialog({ type: 'stash' })}
                    >
                      <Layers size={12} />
                      Stash
                    </button>
                  </div>
                </div>
              </section>
              {changes.find((change) => change.path === activeFile)?.status === 'conflict' ? (
                <div className="conflict-view">
                  <Empty icon={<GitMerge size={42} />} title="此文件存在合并冲突" detail={activeFile}>
                    <button
                      className="button primary"
                      onClick={() => void perform('resolve', { path: activeFile }, '打开合并编辑器')}
                    >
                      打开三方合并编辑器
                    </button>
                    <button
                      className="button"
                      disabled={isBusy}
                      onClick={() => void perform('markResolved', { path: activeFile }, '标记已解决')}
                    >
                      标记为已解决
                    </button>
                  </Empty>
                </div>
              ) : (
                <DiffViewer
                  split={sizes.diff}
                  setSplit={resize('diff')}
                  diff={diff}
                  loading={diffLoading}
                  openNative={openNative}
                  previous={
                    activeFile && changes.findIndex((change) => change.path === activeFile) > 0
                      ? () =>
                          setActiveFile(
                            changes[changes.findIndex((change) => change.path === activeFile) - 1].path,
                          )
                      : undefined
                  }
                  next={
                    activeFile &&
                    changes.findIndex((change) => change.path === activeFile) < changes.length - 1
                      ? () =>
                          setActiveFile(
                            changes[changes.findIndex((change) => change.path === activeFile) + 1].path,
                          )
                      : undefined
                  }
                />
              )}
            </div>
          ) : view === 'log' ? (
            <div className="history-workspace">
              <div className="history-upper">
                <ResizeHandle
                  label="调整提交详情宽度"
                  min={180}
                  target=".commit-detail"
                  side="right"
                  value={sizes.detail}
                  reset={defaultSizes.detail}
                  onChange={resize('detail')}
                  reserve={300}
                  style={{ right: 'var(--detail-width)' }}
                />
                <section className="history-list">
                  <div className="panel-toolbar">
                    <label className="search-box log-search">
                      <Search size={14} />
                      <input
                        aria-label="搜索提交"
                        placeholder="搜索提交、作者或 Hash…"
                        value={logQuery}
                        onChange={(event) => setLogQuery(event.target.value)}
                      />
                    </label>
                    <SelectMenu
                      ariaLabel="筛选分支历史"
                      className="filter-select"
                      value={branchFilter}
                      options={branchFilterOptions}
                      menuMinWidth={220}
                      onChange={setBranchFilter}
                    />
                    <span className="history-count">{visibleCommits.length} 次提交</span>
                  </div>
                  <div className="log-table-header">
                    <span style={{ width: graph.width }}>提交图</span>
                    <span className="log-subject">提交说明</span>
                    <span className="log-author">作者</span>
                    <span className="log-hash">Hash</span>
                    <span className="log-date">时间</span>
                  </div>
                  <div className="log-scroll" ref={logViewport.ref}>
                    {!visibleCommits.length ? (
                      <Empty
                        icon={<History size={32} />}
                        title={logQuery || branchFilter ? '没有匹配的提交' : '还没有提交'}
                        detail="完成第一次提交后，历史会显示在这里。"
                      />
                    ) : (
                      <div className="log-table">
                        <svg
                          className="commit-graph"
                          width={graph.width}
                          height={visibleCommits.length * COMMIT_ROW_HEIGHT}
                          aria-hidden="true"
                        >
                          {graph.edges.slice(graph.rowEdges[logStart], graph.rowEdges[logEnd]).map((edge) => (
                            <path
                              key={edge.key}
                              d={edge.d}
                              fill="none"
                              stroke={edge.color}
                              strokeLinecap="round"
                              strokeWidth="1.5"
                            />
                          ))}
                          {graph.nodes.slice(logStart, logEnd).map((node, offset) => {
                            const cy = (logStart + offset) * COMMIT_ROW_HEIGHT + COMMIT_ROW_HEIGHT / 2;
                            if (node.kind === 'head')
                              return (
                                <circle
                                  key={node.commit.hash}
                                  cx={node.x}
                                  cy={cy}
                                  r={6}
                                  fill="var(--surface)"
                                  stroke={node.color}
                                  strokeWidth={2}
                                />
                              );
                            if (node.kind === 'merge')
                              return (
                                <g key={node.commit.hash}>
                                  <circle
                                    cx={node.x}
                                    cy={cy}
                                    r={6}
                                    fill="var(--surface)"
                                    stroke={node.color}
                                    strokeWidth={2}
                                  />
                                  <circle cx={node.x} cy={cy} r={2} fill={node.color} />
                                </g>
                              );
                            return (
                              <circle key={node.commit.hash} cx={node.x} cy={cy} r={4.5} fill={node.color} />
                            );
                          })}
                        </svg>
                        <div style={{ height: logStart * COMMIT_ROW_HEIGHT }} />
                        {visibleCommits.slice(logStart, logEnd).map((commit) => (
                          <button
                            key={commit.hash}
                            className={`log-row ${activeCommit === commit.hash ? 'selected' : ''}`}
                            onClick={() => {
                              setActiveCommit(commit.hash);
                              setHistoryFile('');
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setActiveCommit(commit.hash);
                              setHistoryFile('');
                              openCommitMenu(commit, event.clientX, event.clientY);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
                                return;
                              event.preventDefault();
                              setActiveCommit(commit.hash);
                              setHistoryFile('');
                              const rect = event.currentTarget.getBoundingClientRect();
                              openCommitMenu(commit, rect.left + 24, rect.bottom);
                            }}
                            title={`${commit.subject}\n右键或 Shift+F10 打开提交操作`}
                          >
                            <span style={{ width: graph.width }} />
                            <span className="log-subject">
                              {commit.refs
                                .filter((ref) => !ref.startsWith('tag:'))
                                .map((ref) => (
                                  <span
                                    className={`ref-badge ${ref.startsWith('HEAD') ? 'head' : ''}`}
                                    key={ref}
                                    onContextMenu={(event) => {
                                      const name = ref.replace('HEAD -> ', '');
                                      const branch = snapshot.branches.find((branch) => branch.name === name);
                                      if (branch) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        openBranchMenu(branch, event.clientX, event.clientY);
                                      }
                                    }}
                                  >
                                    <GitBranch size={10} />
                                    {ref.replace('HEAD -> ', '')}
                                  </span>
                                ))}
                              <span>{commit.subject}</span>
                            </span>
                            <span className="log-author">{commit.author}</span>
                            <code className="log-hash">{commit.hash.slice(0, 7)}</code>
                            <span className="log-date">{shortDate(commit.date)}</span>
                          </button>
                        ))}
                        <div style={{ height: (visibleCommits.length - logEnd) * COMMIT_ROW_HEIGHT }} />
                      </div>
                    )}
                  </div>
                  <div className="history-footnote">
                    <Circle size={10} />
                    <span>最近 {snapshot.commits.length} 次提交 · 按拓扑顺序排列</span>
                    <div className="spacer" />
                    <button
                      onClick={() => {
                        setLogQuery('');
                        setBranchFilter('');
                      }}
                    >
                      重置筛选
                    </button>
                  </div>
                </section>
                <aside className="commit-detail">
                  {detail ? (
                    <>
                      <div className="detail-title">
                        <GitCommitHorizontal size={16} />
                        <strong>提交详情</strong>
                        <code>{detail.commit.hash.slice(0, 8)}</code>
                      </div>
                      <h3>{detail.commit.subject}</h3>
                      <div className="detail-author">
                        <span className="avatar large">{detail.commit.author[0]}</span>
                        <div>
                          <strong>{detail.commit.author}</strong>
                          <span>{shortDate(detail.commit.date)}</span>
                        </div>
                      </div>
                      {detail.message !== detail.commit.subject && (
                        <pre className="commit-message">
                          {detail.message.slice(detail.commit.subject.length).trim()}
                        </pre>
                      )}
                      <div className="detail-actions">
                        <button
                          className="button"
                          disabled={isBusy}
                          title="把此提交应用到当前分支"
                          onClick={() => void perform('cherryPick', { hash: activeCommit }, 'Cherry-pick')}
                        >
                          <GitCommitHorizontal size={13} />
                          Cherry-pick
                        </button>
                        <IconButton
                          title="还原此提交（生成反向提交）"
                          disabled={isBusy}
                          onClick={() => void perform('revert', { hash: activeCommit }, '还原提交')}
                        >
                          <Undo2 size={14} />
                        </IconButton>
                      </div>
                      <div className="detail-files-heading">
                        更改的文件<span>{detail.files.length}</span>
                      </div>
                      <div className="detail-files">
                        {detail.files.map((file) => (
                          <button
                            className={historyFile === file.path ? 'selected' : ''}
                            key={file.path}
                            title={file.path}
                            onClick={() => setHistoryFile(file.path)}
                          >
                            <FileIcon file={file.path} />
                            <span>
                              {basename(file.path)}
                              <small>{dirname(file.path)}</small>
                            </span>
                            <b className={`file-status ${file.status}`}>{statusLetters[file.status]}</b>
                          </button>
                        ))}
                      </div>
                      <p className="detail-tip">选择文件，在下方查看本次提交的差异。</p>
                    </>
                  ) : (
                    <Empty
                      icon={<GitCommitHorizontal size={28} />}
                      title={activeCommit ? '加载提交详情…' : '选择一个提交'}
                    />
                  )}
                </aside>
              </div>
              {historyFile && (
                <div className="history-diff">
                  <DiffViewer
                    split={sizes.diff}
                    setSplit={resize('diff')}
                    diff={diff}
                    loading={diffLoading}
                    openNative={openNative}
                    close={() => setHistoryFile('')}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="stash-workspace">
              <ResizeHandle
                label="调整 Stash 列表宽度"
                min={160}
                target=".stash-list"
                value={sizes.stash}
                reset={defaultSizes.stash}
                onChange={resize('stash')}
                style={{ left: 'var(--stash-width)' }}
              />
              <section className="stash-list">
                <div className="panel-toolbar">
                  <strong>已暂存的更改</strong>
                  <span className="count">{snapshot.stashes.length}</span>
                  <div className="spacer" />
                  <IconButton
                    title="暂存当前全部更改"
                    disabled={isBusy || !changes.length}
                    onClick={() => showDialog({ type: 'stash' })}
                  >
                    <Plus size={16} />
                  </IconButton>
                </div>
                {!snapshot.stashes.length ? (
                  <Empty
                    icon={<Layers size={32} />}
                    title="没有暂存的更改"
                    detail="需要切换任务时，用 Stash 保存当前进度。"
                  />
                ) : (
                  snapshot.stashes.map((stash) => (
                    <button
                      key={stash.hash}
                      className={`stash-card ${activeStash === stash.ref ? 'selected' : ''}`}
                      onClick={() => {
                        setActiveStash(stash.ref);
                        setStashFile('');
                      }}
                    >
                      <span className="stash-card-icon">
                        <Layers size={18} />
                      </span>
                      <span>
                        <code>{stash.ref}</code>
                        <strong>{stash.subject}</strong>
                        <small>{shortDate(stash.date)}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))
                )}
                {activeStash && (
                  <div className="stash-actions">
                    <button
                      className="button primary"
                      disabled={isBusy}
                      onClick={() => void perform('stashApply', { ref: activeStash }, '应用 Stash')}
                    >
                      <ArrowDown size={14} />
                      应用
                    </button>
                    <button
                      className="button"
                      disabled={isBusy}
                      onClick={() =>
                        void perform('stashApply', { ref: activeStash, pop: true }, '应用并移除 Stash')
                      }
                    >
                      应用并移除
                    </button>
                    <IconButton
                      title="删除选中的 Stash"
                      disabled={isBusy}
                      onClick={() => void perform('stashDrop', { ref: activeStash }, '删除 Stash')}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                )}
                <div className="detail-files">
                  {stashFiles.map((file) => (
                    <button
                      key={file.path}
                      className={stashFile === file.path ? 'selected' : ''}
                      onClick={() => setStashFile(file.path)}
                    >
                      <FileIcon file={file.path} />
                      <span>
                        {basename(file.path)}
                        <small>{dirname(file.path)}</small>
                      </span>
                      <b className={`file-status ${file.status}`}>{statusLetters[file.status]}</b>
                    </button>
                  ))}
                </div>
              </section>
              <DiffViewer
                split={sizes.diff}
                setSplit={resize('diff')}
                diff={diff}
                loading={diffLoading}
                openNative={openNative}
              />
            </div>
          )}
          {consoleOpen && (
            <section className="console-panel">
              <div className="panel-toolbar">
                <Terminal size={14} />
                <strong>Git 控制台</strong>
                <span className="count">{activities.length}</span>
                <div className="spacer" />
                <IconButton title="清空控制台" onClick={() => setActivities([])}>
                  <Trash2 size={13} />
                </IconButton>
                <IconButton title="关闭控制台" onClick={() => setConsoleOpen(false)}>
                  <X size={14} />
                </IconButton>
              </div>
              <div className="console-scroll">
                {!activities.length ? (
                  <p className="muted">执行 Git 操作后，命令和结果会显示在这里。</p>
                ) : (
                  activities.map((activity) => (
                    <div className={`console-entry ${activity.error ? 'error' : ''}`} key={activity.id}>
                      <time>{new Date(activity.time).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                      <div>
                        <code>$ {activity.command}</code>
                        {activity.output && <pre>{activity.output.trim()}</pre>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </main>
      </div>
      <footer className="statusbar">
        {busy ? (
          <>
            <LoaderCircle size={12} className="spin" />
            <span>{busy}…</span>
          </>
        ) : (
          <>
            <span className="online-dot" />
            <span>
              {isPreview ? '示例仓库 · 交互预览' : snapshot?.repository ? '已连接本地仓库' : '等待打开仓库'}
            </span>
          </>
        )}
        <div className="spacer" />
        <span className="status-hint">
          {selected.size ? `${selected.size} 个文件待提交` : '所有更改，尽在掌握'}
        </span>
        <button className={consoleOpen ? 'active' : ''} onClick={() => setConsoleOpen(!consoleOpen)}>
          <Terminal size={12} />
          控制台{activities.some((activity) => activity.error) && <span className="error-dot" />}
        </button>
      </footer>
      {notice && (
        <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>
          {notice.error ? <Info size={18} /> : <CircleCheck size={18} />}
          <span>{notice.message}</span>
          {notice.error && <button onClick={() => setConsoleOpen(true)}>查看控制台</button>}
          <IconButton title="关闭提示" onClick={() => setNotice(null)}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {branchMenu && (
        <ContextMenu
          x={branchMenu.x}
          y={branchMenu.y}
          title={branchMenu.branch.name}
          actions={branchActions(branchMenu.branch)}
          close={closeBranchMenu}
          onSelect={branchMenu.fromDropdown ? closeBranchDropdown : undefined}
          onCancel={branchMenu.fromDropdown ? closeBranchDropdown : undefined}
        />
      )}
      {commitMenu && (
        <ContextMenu
          x={commitMenu.x}
          y={commitMenu.y}
          title={`${commitMenu.commit.hash.slice(0, 8)} · ${commitMenu.commit.subject}`}
          label={`提交 ${commitMenu.commit.hash.slice(0, 8)} 操作`}
          actions={commitActions(commitMenu.commit)}
          close={closeCommitMenu}
        />
      )}
      {fileMenu && (
        <ContextMenu
          x={fileMenu.x}
          y={fileMenu.y}
          title={fileMenu.paths.length > 1 ? `已选择 ${fileMenu.paths.length} 个文件` : fileMenu.paths[0]}
          label={`文件操作：${fileMenu.paths.join('、')}`}
          actions={fileActions(fileMenu.paths)}
          close={closeFileMenu}
        />
      )}
      {branchDropdown && snapshot?.repository && (
        <BranchDropdown
          anchor={branchDropdown}
          branches={snapshot.branches}
          activeBranch={branchMenu?.fromDropdown ? branchMenu.branch : null}
          onBranch={openBranchSubmenu}
          onBranchHover={openBranchSubmenu}
          onDismissSubmenu={dismissBranchSubmenu}
          onNewBranch={() => {
            closeBranchDropdown();
            showDialog({ type: 'newBranch' });
          }}
          newBranchDisabled={isBusy || !!snapshot.operation}
          close={closeBranchDropdown}
        />
      )}
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isBusy) setDialog(null);
          }}
        >
          <DialogWindow
            key={dialog.type}
            savedFrame={dialogFrames[dialog.type]}
            onFrameChange={(frame) => rememberDialogFrame(dialog.type, frame)}
            titleId="dialog-title"
          >
            <div className="modal-header">
              <span className="modal-icon">
                {dialog.type === 'push' ? (
                  <ArrowUpFromLine size={19} />
                ) : dialog.type === 'stash' ? (
                  <Layers size={19} />
                ) : dialog.type === 'help' ? (
                  <BookOpen size={19} />
                ) : dialog.type === 'changelist' || dialog.type === 'move' ? (
                  <FolderClosed size={19} />
                ) : (
                  <GitBranch size={19} />
                )}
              </span>
              <h2
                id="dialog-title"
                title="拖动标题栏移动窗口，拖动边缘调整大小，双击标题栏恢复默认位置和大小"
              >
                {
                  {
                    newBranch: '新建分支',
                    renameBranch: '重命名分支',
                    upstream: '设置上游分支',
                    compare: '与当前分支比较',
                    changelist: '新建更改列表',
                    stash: '暂存本地更改',
                    push: '推送提交',
                    move: '移动到更改列表',
                    help: '熟悉的 Git 工作方式',
                  }[dialog.type]
                }
              </h2>
              <IconButton title="关闭对话框" disabled={isBusy} onClick={() => setDialog(null)}>
                <X size={18} />
              </IconButton>
            </div>
            {dialog.type === 'compare' ? (
              <>
                <p className="modal-description comparison-route">
                  <code>{dialog.branch?.name}</code>
                  <ArrowLeftRight size={14} />
                  <code>{snapshot?.branch}</code>
                </p>
                <p className="modal-description">
                  {comparison
                    ? `当前分支独有 ${comparison.ahead} 个提交，对方独有 ${comparison.behind} 个提交；${comparison.files.length} 个文件不同。`
                    : '正在比较分支…'}
                </p>
                <div className="comparison-files">
                  {comparison?.files.map((file) => (
                    <button
                      key={file.path}
                      disabled={isBusy}
                      onClick={() =>
                        void perform(
                          'openBranchDiff',
                          { path: file.path, base: comparison.base, head: comparison.head },
                          '打开分支比较',
                        )
                      }
                    >
                      <FileIcon file={file.path} />
                      <span>{file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}</span>
                      <b className={`file-status ${file.status}`}>{statusLetters[file.status]}</b>
                    </button>
                  ))}
                  {comparison && !comparison.files.length && (
                    <p className="sidebar-empty">两个分支的文件内容一致</p>
                  )}
                </div>
                <div className="modal-footer">
                  <span className="muted">选择文件，在 VS Code 差异编辑器中比较</span>
                  <div className="spacer" />
                  <button className="button" onClick={() => setDialog(null)}>
                    关闭
                  </button>
                </div>
              </>
            ) : dialog.type === 'upstream' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(
                    'setUpstream',
                    { branch: dialog.branch!.name, upstream: dialogValue },
                    '设置上游分支',
                    () => setDialog(null),
                  );
                }}
              >
                <p className="modal-description">
                  设置 <code>{dialog.branch?.name}</code> 的拉取和推送目标。
                </p>
                <div className="form-label">
                  <span>上游分支</span>
                  <SelectMenu
                    ariaLabel="上游分支"
                    value={dialogValue}
                    menuMinWidth={240}
                    onChange={setDialogValue}
                    options={[
                      { value: '', label: '不跟踪上游' },
                      ...(snapshot?.branches ?? [])
                        .filter((branch) => branch.remote)
                        .map((branch) => ({ value: branch.name, label: branch.name })),
                    ]}
                  />
                </div>
                <div className="modal-footer">
                  <button className="button" type="button" onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={isBusy || (!dialogValue && !dialog.branch?.upstream)}
                  >
                    保存
                  </button>
                </div>
              </form>
            ) : dialog.type === 'help' ? (
              <div className="help-content">
                <p>
                  围绕 IDEA 的日常工作流，把 Git
                  操作放在一个工作台里。拖动分栏边界调整宽度，双击边界恢复默认；也可聚焦边界后使用左右方向键。
                  对话框可拖动标题栏移动、拖动边缘调整大小，双击标题栏恢复默认。
                </p>
                <ol>
                  <li>
                    <b>选择更改</b>
                    <span>勾选文件或整个更改列表；选择文件查看并排 Diff。</span>
                  </li>
                  <li>
                    <b>审查并提交</b>
                    <span>填写提交说明，点击「提交」或「提交并推送」。提交包含勾选文件的全部改动。</span>
                  </li>
                  <li>
                    <b>管理分支与历史</b>
                    <span>单击分支筛选历史；右键打开检出、比较、合并、Rebase 等操作；双击检出分支。</span>
                  </li>
                  <li>
                    <b>暂存与处理冲突</b>
                    <span>用 Stash 保存全部本地进度；冲突文件使用 VS Code 三方合并编辑器。</span>
                  </li>
                </ol>
                <div className="shortcut-row">
                  <span>提交 / 提交并推送</span>
                  <kbd>⌘ / Ctrl + Enter</kbd>
                  <kbd>+ Shift</kbd>
                </div>
                <div className="shortcut-row">
                  <span>打开提交窗口</span>
                  <kbd>⌘ / Ctrl + Alt + K</kbd>
                </div>
                <div className="shortcut-row">
                  <span>刷新 / 关闭对话框</span>
                  <kbd>⌘ / Ctrl + R</kbd>
                  <kbd>Esc</kbd>
                </div>
                {isPreview && (
                  <p className="preview-note">
                    当前为示例数据预览。安装 VSIX 后，插件连接你在 VS Code 中打开的真实 Git 仓库。
                  </p>
                )}
                <button className="button primary full-width" onClick={() => setDialog(null)}>
                  开始使用
                </button>
              </div>
            ) : dialog.type === 'push' ? (
              <>
                <p className="modal-description">将当前分支的本地提交推送到远程仓库。</p>
                <div className="push-route">
                  <div>
                    <GitBranch size={16} />
                    <span>
                      <small>本地分支</small>
                      <strong>{snapshot?.branch}</strong>
                    </span>
                  </div>
                  <ArrowUp size={20} />
                  <div>
                    <Box size={16} />
                    <span>
                      <small>远程分支</small>
                      <strong>
                        {pushPreview
                          ? pushPreview.remote
                            ? `${pushPreview.remote}/${pushPreview.target}`
                            : '请先配置远程仓库或上游'
                          : snapshot?.upstream || '正在检查推送目标…'}
                      </strong>
                    </span>
                  </div>
                </div>
                <div className="push-summary">
                  <ShieldCheck size={16} />
                  <span>
                    {pushPreview
                      ? `${pushPreview.total} 个提交将推送到远程。${snapshot?.upstream ? '' : '首次推送将设置上游。'}`
                      : '正在读取待推送的提交…'}
                  </span>
                </div>
                {pushPreview && (
                  <div className="outgoing-list">
                    {pushPreview.commits.map((commit) => (
                      <div key={commit.hash}>
                        <GitCommitHorizontal size={13} />
                        <span>{commit.subject}</span>
                        <code>{commit.hash.slice(0, 7)}</code>
                      </div>
                    ))}
                    {pushPreview.total > 100 && (
                      <small>仅预览最近 100 个提交，共 {pushPreview.total} 个。</small>
                    )}
                    {!pushPreview.total && <small>本地分支已是最新状态。</small>}
                  </div>
                )}
                {!!snapshot?.behind && (
                  <p className="modal-warning">落后上游 {snapshot.behind} 个提交，请先 Pull 更新后再推送。</p>
                )}
                <div className="modal-footer">
                  <span className="muted">使用标准推送，保留远程历史。</span>
                  <div className="spacer" />
                  <button className="button" disabled={isBusy} onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button
                    className="button primary"
                    disabled={isBusy || !pushPreview?.remote || !!snapshot?.behind}
                    onClick={() => void perform('push', {}, '推送', () => setDialog(null))}
                  >
                    {isBusy ? <LoaderCircle size={14} className="spin" /> : <ArrowUpFromLine size={14} />}推送
                  </button>
                </div>
              </>
            ) : dialog.type === 'move' ? (
              <>
                <p className="modal-description">将选中的 {selected.size} 个文件归入一个更改列表。</p>
                <div className="move-options">
                  {[{ id: '', name: '默认更改列表' }, ...(snapshot?.changelists || [])].map((list) => (
                    <button
                      className="button"
                      disabled={isBusy}
                      key={list.id}
                      onClick={() =>
                        void perform(
                          'changelist',
                          { action: 'move', id: list.id, paths: selectedFiles },
                          '移动文件',
                          () => setDialog(null),
                        )
                      }
                    >
                      <FolderClosed size={15} />
                      {list.name}
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!dialogValue.trim() && dialog.type !== 'stash') return;
                  if (dialog.type === 'newBranch')
                    void perform(
                      'createBranch',
                      {
                        name: dialogValue.trim(),
                        source: dialog.branch?.name,
                        remote: dialog.branch?.remote,
                      },
                      '创建分支',
                      () => setDialog(null),
                    );
                  if (dialog.type === 'renameBranch')
                    void perform(
                      'renameBranch',
                      { branch: dialog.branch!.name, name: dialogValue.trim() },
                      '重命名分支',
                      () => setDialog(null),
                    );
                  if (dialog.type === 'changelist')
                    void perform(
                      'changelist',
                      { action: 'create', name: dialogValue.trim() },
                      '创建更改列表',
                      () => setDialog(null),
                    );
                  if (dialog.type === 'stash')
                    void perform('stash', { message: dialogValue.trim() }, '暂存更改', () => setDialog(null));
                }}
              >
                <p className="modal-description">
                  {dialog.type === 'newBranch'
                    ? `从 ${dialog.branch?.name || '当前 HEAD'} 创建分支，并自动切换。`
                    : dialog.type === 'renameBranch'
                      ? `重命名本地分支 ${dialog.branch?.name}，远程分支名称保持原样。`
                      : dialog.type === 'changelist'
                        ? '按任务组织改动，分别审查与提交。'
                        : `保存全部 ${changes.length} 个本地更改（含未跟踪文件），然后清理工作区。`}
                </p>
                <label className="form-label">
                  {dialog.type === 'newBranch' || dialog.type === 'renameBranch'
                    ? '分支名称'
                    : dialog.type === 'changelist'
                      ? '更改列表名称'
                      : 'Stash 说明（可选）'}
                  <input
                    autoFocus
                    aria-label={
                      dialog.type === 'newBranch' || dialog.type === 'renameBranch'
                        ? '分支名称'
                        : dialog.type === 'changelist'
                          ? '更改列表名称'
                          : 'Stash 说明'
                    }
                    placeholder={
                      dialog.type === 'newBranch' || dialog.type === 'renameBranch'
                        ? 'feature/my-next-idea'
                        : dialog.type === 'changelist'
                          ? '例如：登录功能'
                          : 'WIP: 记录当前进度…'
                    }
                    value={dialogValue}
                    onChange={(event) => setDialogValue(event.target.value)}
                    maxLength={dialog.type === 'changelist' ? 80 : 240}
                    disabled={isBusy}
                  />
                </label>
                <div className="modal-footer">
                  <button className="button" type="button" disabled={isBusy} onClick={() => setDialog(null)}>
                    取消
                  </button>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={isBusy || (dialog.type !== 'stash' && !dialogValue.trim())}
                  >
                    {isBusy && <LoaderCircle size={14} className="spin" />}
                    {dialog.type === 'stash'
                      ? '暂存更改'
                      : dialog.type === 'renameBranch'
                        ? '重命名'
                        : '创建'}
                  </button>
                </div>
              </form>
            )}
          </DialogWindow>
        </div>
      )}
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ExternalLink size={14} />;
}

createRoot(document.getElementById('root')!).render(<App />);
