import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  ArrowSwap,
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
  GoToFile,
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
import { COMMIT_ROW_HEIGHT, graphColumnWidth, makeGraph } from './graph';
import { defaultSizes, restoreSizes, ResizeHandle, type PaneSizes } from './resize';
import { DialogWindow, restoreDialogFrames, type DialogAnchor, type DialogFrame } from './dialog-window';
import { BranchDropdown } from './branch-dropdown';
import { BranchSync } from './branch-sync';
import { currentFirst, groupBranches, type BranchFolder } from './branch-groups';
import { groupFiles, type FileFolder } from './file-groups';
import { ContextMenu, type MenuAction } from './context-menu';
import { SelectMenu, type SelectOption } from './select-menu';
import { dateLocale, t } from './i18n';
import { offsetRange, uniformRange, useViewport } from './virtual';
import { isFileListKey, nextRowIndex, rowIndex, type FileListKey } from './file-list-nav';
import './styles.css';

if (isPreview && new URLSearchParams(window.location.search).get('layout') === 'panel') {
  document.body.dataset.host = 'panel';
}
const panelLayout = true;
const FILE_ROW_HEIGHT = 22,
  FOLDER_ROW_HEIGHT = 22,
  GROUP_ROW_HEIGHT = 24;
// One tree level in the changed-file and commit-detail lists.
const FILE_TREE_INDENT = 16;
// Caps the graph column so a history with dozens of parallel branches still leaves
// room for subjects; lanes past the cap are clipped at the column edge.
const MAX_GRAPH_WIDTH = 400;
const NO_CHANGES: Change[] = [];
const fileFolderKey = (groupId: string, path: string) => `${groupId}\0${path}`;

type Dialog = {
  type:
    'newBranch' | 'renameBranch' | 'upstream' | 'compare' | 'changelist' | 'stash' | 'push' | 'move' | 'help';
  branch?: Branch;
  anchor?: DialogAnchor;
  // Set when the move dialog is opened from the file context menu instead of the checkbox selection.
  paths?: string[];
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
  modified: t('Modified'),
  added: t('Added'),
  deleted: t('Deleted'),
  renamed: t('Renamed'),
  untracked: t('Untracked'),
  conflict: t('Conflict'),
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
  new Intl.DateTimeFormat(dateLocale, {
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
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
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
type FileListItem =
  { kind: 'folder'; folder: FileFolder; depth: number } | { kind: 'file'; change: Change; depth: number };
// Flattens a directory tree into visible rows for the commit detail and comparison lists.
function flattenFileItems(files: Change[], grouped: boolean, collapsed: Set<string>): FileListItem[] {
  if (!grouped) return files.map((change): FileListItem => ({ kind: 'file', change, depth: 0 }));
  const items: FileListItem[] = [];
  const pushFile = (change: Change, depth: number) => items.push({ kind: 'file', change, depth });
  const pushFolder = (folder: FileFolder, depth: number) => {
    items.push({ kind: 'folder', folder, depth });
    if (collapsed.has(folder.path)) return;
    for (const child of folder.folders) pushFolder(child, depth + 1);
    for (const file of folder.files) pushFile(file.change, depth + 1);
  };
  for (const entry of groupFiles(files)) {
    if (entry.kind === 'folder') pushFolder(entry, 0);
    else pushFile(entry.change, 0);
  }
  return items;
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
          title={loading ? t('Reading diff…') : t('Select a file to view changes')}
          detail={t('Select a file on the left to review changes side by side.')}
        />
      </div>
    );
  return (
    <section
      className={`diff-view ${loading ? 'is-loading' : ''}`}
      aria-label={t('File diff')}
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
          title={context ? t('Show full file') : t('Show changes and context only')}
          onClick={() => setContext(!context)}
          className={context ? 'active' : ''}
        >
          <SlidersHorizontal size={15} />
        </IconButton>
        <IconButton
          title={unified ? t('Switch to side-by-side diff') : t('Switch to unified diff')}
          onClick={() => setUnified(!unified)}
        >
          <ArrowLeftRight size={15} />
        </IconButton>
        {previous && (
          <IconButton title={t('Previous file')} onClick={previous}>
            <ChevronLeft size={16} />
          </IconButton>
        )}
        {next && (
          <IconButton title={t('Next file')} onClick={next}>
            <ChevronRight size={16} />
          </IconButton>
        )}
        <IconButton title={t('Open Diff in VS Code')} onClick={openNative}>
          <ExternalLink size={15} />
        </IconButton>
        {close && (
          <IconButton title={t('Close diff')} onClick={close}>
            <X size={15} />
          </IconButton>
        )}
      </div>
      <div className="diff-labels">
        <div>
          <span className="revision-dot" />
          {diff.beforeLabel}
          <span className="muted">{t('Original version')}</span>
        </div>
        <div>
          <span className="revision-dot local" />
          {diff.afterLabel}
          <span className="muted">
            {diff.afterLabel === 'Working tree' || diff.afterLabel === t('Working tree')
              ? t('Local Changes')
              : t('Commit version')}
          </span>
        </div>
      </div>
      {diff.binary || diff.truncated || comparison.error ? (
        <Empty
          icon={<File size={32} />}
          title={
            comparison.error ||
            (diff.binary ? t('Binary file or submodule') : t('File exceeds the preview limit'))
          }
          detail={t('Use the native VS Code diff editor to continue.')}
        >
          <button className="button" onClick={openNative}>
            <ExternalLink size={14} />
            {t('Open Diff')}
          </button>
        </Empty>
      ) : !rows.length ? (
        <Empty
          title={t('No text differences')}
          detail={t('The file may have only permission changes, or its contents are identical.')}
        />
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
              label={t('Resize the diff panes')}
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
        <span>{t('{0} changed lines', rows.filter((row) => row.type === 'change').length)}</span>
        <span className="legend-dot removed-dot" />
        {t('Removed')}
        <span className="legend-dot added-dot" />
        {t('Added')}
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
  const [comparisonSwap, setComparisonSwap] = useState(false);
  const [compareGrouped, setCompareGrouped] = useState(true);
  const [collapsedCompareFolders, setCollapsedCompareFolders] = useState<Set<string>>(new Set());
  const [comparisonFile, setComparisonFile] = useState('');
  const [detailExisting, setDetailExisting] = useState<{ key: string; paths: Set<string> } | null>(null);
  const [stashExisting, setStashExisting] = useState<{ key: string; paths: Set<string> } | null>(null);
  const [compareExisting, setCompareExisting] = useState<{ key: string; paths: Set<string> } | null>(null);
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
    [branchCommits, setBranchCommits] = useState<Commit[] | null>(null),
    [activeCommit, setActiveCommit] = useState(''),
    [detail, setDetail] = useState<CommitDetail | null>(null);
  const [branchGrouped, setBranchGrouped] = useState(stored.branchGrouped === true);
  const [collapsedBranchFolders, setCollapsedBranchFolders] = useState<Set<string>>(new Set());
  const [fileLayout, setFileLayout] = useState<Snapshot['fileLayout']>(snapshot?.fileLayout ?? 'tree');
  const fileGrouped = fileLayout === 'tree';
  const [collapsedFileFolders, setCollapsedFileFolders] = useState<Set<string>>(new Set());
  const [collapsedDetailFolders, setCollapsedDetailFolders] = useState<Set<string>>(new Set());
  useEffect(() => setFileLayout(snapshot?.fileLayout ?? 'tree'), [snapshot?.fileLayout]);
  useEffect(() => setCollapsedDetailFolders(new Set()), [activeCommit]);
  const [historyFile, setHistoryFile] = useState(''),
    [activeStash, setActiveStash] = useState(''),
    [stashFiles, setStashFiles] = useState<Change[]>([]);
  const [stashFile, setStashFile] = useState(''),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [inlinePreview, setInlinePreview] = useState(false);
  const [pushPreview, setPushPreview] = useState<PushPreview | null>(null);
  const root = useRef<string | undefined>(undefined),
    diffSequence = useRef(0),
    lastNative = useRef({ key: '', at: 0 }),
    commitInput = useRef<HTMLTextAreaElement>(null);
  const fileViewport = useViewport(),
    logViewport = useViewport();
  const fileListElement = useRef<HTMLDivElement | null>(null),
    logListElement = useRef<HTMLDivElement | null>(null);
  const currentDraft = drafts[snapshot?.repository?.path || ''] || '';
  const changes = snapshot?.changes ?? NO_CHANGES;
  const isBusy = !!busy;
  const diffTarget = snapshot?.diffTarget ?? 'editor';
  const showInlineDiff = diffTarget === 'panel' || inlinePreview;
  const activeConflict = changes.some((change) => change.path === activeFile && change.status === 'conflict');
  const showMiddlePane = showInlineDiff || activeConflict;
  useEffect(() => setInlinePreview(false), [diffTarget]);
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
    setComparisonSwap(false);
    setCollapsedCompareFolders(new Set());
    setComparisonFile('');
  }, [dialog?.type, dialog?.branch?.name, dialog?.branch?.remote]);
  useEffect(() => {
    setComparison(null);
    if (dialog?.type !== 'compare' || !dialog.branch) return;
    let cancelled = false;
    void request('compareBranch', {
      branch: dialog.branch.name,
      remote: dialog.branch.remote,
      swap: comparisonSwap,
    })
      .then((value) => {
        if (!cancelled) setComparison(value);
      })
      .catch((error) => {
        if (!cancelled) setNotice({ message: error.message, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [dialog, snapshot?.repository?.path, comparisonSwap]);
  useEffect(() => {
    if (!comparison) return;
    const key = `${comparison.base}:${comparison.head}`;
    const paths = comparison.files.map((file) => file.path);
    setCompareExisting({ key, paths: new Set(paths) });
    if (!paths.length) return;
    let cancelled = false;
    void request('existingFiles', { paths })
      .then((value) => {
        if (!cancelled) setCompareExisting({ key, paths: new Set(value) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [comparison]);
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
            output: t('{0} completed (sample data)', label),
            error: false,
          },
          ...previous,
        ]);
      after?.();
      if (
        ![
          'openFile',
          'openDiff',
          'resolve',
          'copyBranch',
          'openBranchDiff',
          'copyPaths',
          'revealPath',
        ].includes(method)
      )
        await refresh();
      const pushError = method === 'commit' ? (result as Requests['commit']['result']).pushError : undefined;
      setNotice(
        pushError
          ? { message: t('Local commit completed, but the push failed: {0}', pushError), error: true }
          : { message: t('{0} completed', label), error: false },
      );
    } catch (error) {
      setNotice({ message: (error as Error).message, error: true });
      await refresh();
    } finally {
      setBusy('');
    }
  };
  useEffect(() => {
    if (!branchFilter) {
      setBranchCommits(null);
      return;
    }
    let cancelled = false;
    void request('branchLog', { branch: branchFilter })
      .then((commits) => {
        if (!cancelled) setBranchCommits(commits);
      })
      .catch(() => {
        // A renamed or deleted branch leaves nothing to show instead of the old list.
        if (!cancelled) setBranchCommits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branchFilter, snapshot?.updatedAt, snapshot?.repository?.path]);
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
    if (!detail) return;
    const key = detail.commit.hash;
    const paths = detail.files.map((file) => file.path);
    setDetailExisting({ key, paths: new Set(paths) });
    if (!paths.length) return;
    let cancelled = false;
    void request('existingFiles', { paths })
      .then((value) => {
        if (!cancelled) setDetailExisting({ key, paths: new Set(value) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [detail]);
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
  useEffect(() => {
    if (!stashFiles.length) return;
    const key = activeStash;
    const paths = stashFiles.map((file) => file.path);
    setStashExisting({ key, paths: new Set(paths) });
    let cancelled = false;
    void request('existingFiles', { paths })
      .then((value) => {
        if (!cancelled) setStashExisting({ key, paths: new Set(value) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [stashFiles, activeStash]);
  const openNativeDiff = (path: string, commit?: string, stash?: string, keepFocus = true) => {
    if (!path) return;
    const key = `${path}\0${commit || ''}\0${stash || ''}`;
    const now = Date.now();
    if (key === lastNative.current.key && now - lastNative.current.at < 400) return;
    lastNative.current = { key, at: now };
    void request('openDiff', {
      path,
      ...(commit ? { commit } : {}),
      ...(stash ? { stash } : {}),
      keepFocus,
    }).catch((error) => setNotice({ message: (error as Error).message, error: true }));
  };
  const openWorkingFile = (path: string) => {
    void request('openFile', { path }).catch((error) =>
      setNotice({ message: (error as Error).message, error: true }),
    );
  };
  const openFileAction = (path: string, exists: boolean) =>
    exists ? (
      <IconButton
        title={t('Open file {0}', path)}
        className="file-open"
        onClick={(event) => {
          event.stopPropagation();
          openWorkingFile(path);
        }}
      >
        <GoToFile size={14} />
      </IconButton>
    ) : (
      <span className="file-missing" title={t('File no longer exists')}>
        {t('Deleted')}
      </span>
    );
  const detailKey = detail?.commit.hash ?? '';
  const detailExists = (path: string) =>
    !detailExisting || detailExisting.key !== detailKey || detailExisting.paths.has(path);
  const stashExists = (path: string) =>
    !stashExisting || stashExisting.key !== activeStash || stashExisting.paths.has(path);
  const comparisonKey = comparison ? `${comparison.base}:${comparison.head}` : '';
  const compareExists = (path: string) =>
    !compareExisting || compareExisting.key !== comparisonKey || compareExisting.paths.has(path);
  const diffFile = view === 'changes' ? activeFile : view === 'log' ? historyFile : stashFile;
  useEffect(() => {
    const sequence = ++diffSequence.current;
    if (!diffFile || !snapshot?.repository || !showInlineDiff) {
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
  }, [
    diffFile,
    view,
    activeCommit,
    activeStash,
    showInlineDiff,
    snapshot?.updatedAt,
    snapshot?.repository?.path,
  ]);
  const commitPaths = (paths: string[], push = false) => {
    if (!paths.length || isBusy) return;
    setSelected(new Set(paths));
    if (!currentDraft.trim()) {
      commitInput.current?.focus();
      setNotice({ message: t('Enter a commit message first.'), error: true });
      return;
    }
    const chosen = new Set(paths);
    if (changes.some((change) => change.status === 'conflict' && chosen.has(change.path))) {
      setNotice({ message: t('Resolve all conflicts first.'), error: true });
      return;
    }
    void perform(
      'commit',
      { paths, message: currentDraft, push },
      push ? t('Commit & Push') : t('Commit'),
      () => {
        setDrafts((previous) => ({ ...previous, [snapshot!.repository!.path]: '' }));
      },
    );
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
  const showDialog = (value: Dialog, anchor?: DialogAnchor) => {
    setBranchMenu(null);
    setDialogValue(
      value.type === 'renameBranch'
        ? value.branch?.name || ''
        : value.type === 'upstream'
          ? value.branch?.upstream || ''
          : '',
    );
    setDialog(anchor ? { ...value, anchor } : value);
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
        name: t('Merge Conflicts'),
        files: filteredChanges.filter((change) => change.status === 'conflict'),
      },
      {
        id: 'default',
        name: t('Default Changelist'),
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
        name: t('Unversioned Files'),
        files: filteredChanges.filter((change) => change.status === 'untracked' && !listed.has(change.path)),
      },
    ].filter((group) => group.files.length || (!['conflicts', 'untracked'].includes(group.id) && !fileQuery));
  }, [filteredChanges, changelists, fileQuery]);
  const fileItems = useMemo(() => {
    const items: (
      | { kind: 'group'; group: (typeof groups)[number] }
      | { kind: 'folder'; folder: FileFolder; groupId: string; depth: number }
      | { kind: 'file'; change: Change; depth: number }
    )[] = [];
    const offsets = [0];
    const pushFile = (change: Change, depth: number) => {
      items.push({ kind: 'file', change, depth });
      offsets.push(offsets.at(-1)! + FILE_ROW_HEIGHT);
    };
    const pushFolder = (groupId: string, folder: FileFolder, depth: number) => {
      items.push({ kind: 'folder', folder, groupId, depth });
      offsets.push(offsets.at(-1)! + FOLDER_ROW_HEIGHT);
      if (!fileQuery && collapsedFileFolders.has(fileFolderKey(groupId, folder.path))) return;
      for (const child of folder.folders) pushFolder(groupId, child, depth + 1);
      for (const file of folder.files) pushFile(file.change, depth + 1);
    };
    for (const group of groups) {
      items.push({ kind: 'group', group });
      offsets.push(offsets.at(-1)! + GROUP_ROW_HEIGHT);
      if (collapsed.has(group.id)) continue;
      if (fileGrouped) {
        for (const entry of groupFiles(group.files)) {
          if (entry.kind === 'folder') pushFolder(group.id, entry, 0);
          else pushFile(entry.change, 0);
        }
      } else {
        for (const change of group.files) pushFile(change, 0);
      }
    }
    return { items, offsets };
  }, [groups, collapsed, fileGrouped, collapsedFileFolders, fileQuery]);
  const visibleFilePaths = useMemo(
    () => fileItems.items.flatMap((item) => (item.kind === 'file' ? [item.change.path] : [])),
    [fileItems],
  );
  const toggleFileFolder = (key: string) =>
    setCollapsedFileFolders((previous) => {
      const next = new Set(previous);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const toggleFileLayout = () => {
    const previous = fileLayout;
    const next = previous === 'tree' ? 'flat' : 'tree';
    setFileLayout(next);
    void request('setFileLayout', { layout: next }).catch((error) => {
      setFileLayout(previous);
      setNotice({ message: (error as Error).message, error: true });
    });
  };
  const toggleDetailFolder = (path: string) =>
    setCollapsedDetailFolders((previous) => {
      const next = new Set(previous);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  const detailItems = useMemo(
    () =>
      detail && fileLayout === 'tree' ? flattenFileItems(detail.files, true, collapsedDetailFolders) : [],
    [detail, fileLayout, collapsedDetailFolders],
  );
  const toggleCompareFolder = (path: string) =>
    setCollapsedCompareFolders((previous) => {
      const next = new Set(previous);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  const compareItems = useMemo(
    () => flattenFileItems(comparison?.files ?? [], compareGrouped, collapsedCompareFolders),
    [comparison, compareGrouped, collapsedCompareFolders],
  );
  const detailFileRow = (file: Change, depth: number) => (
    <div className={`detail-file-row${historyFile === file.path ? ' selected' : ''}`} key={file.path}>
      <button
        className={`detail-select${historyFile === file.path ? ' selected' : ''}`}
        data-path={file.path}
        title={file.path}
        style={fileGrouped ? { paddingLeft: 26 + depth * FILE_TREE_INDENT } : undefined}
        onFocus={() => setHistoryFile(file.path)}
        onClick={() => {
          setHistoryFile(file.path);
          if (!showInlineDiff) openNativeDiff(file.path, activeCommit);
        }}
      >
        <FileIcon file={file.path} />
        <span className={`file-name status-${file.status}`}>
          {basename(file.path)}
          {!fileGrouped && <small>{dirname(file.path)}</small>}
        </span>
        <b className={`file-status ${file.status}`}>{statusLetters[file.status]}</b>
      </button>
      {openFileAction(file.path, detailExists(file.path))}
    </div>
  );
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
  // Arrows walk file rows by logical index, so the virtual change list keeps
  // working for rows that are not rendered yet.
  const selectedFileListPath = (container: HTMLElement) => {
    const kind = container.dataset.fileList;
    if (kind === 'compare') return comparisonFile;
    if (kind === 'stash') return stashFile;
    if (kind === 'detail') return historyFile;
    return activeFile;
  };
  const fileListRow = (container: HTMLElement, path: string) =>
    path ? container.querySelector<HTMLButtonElement>(`[data-path="${CSS.escape(path)}"]`) : null;
  const restoreFileListFocus = (container: HTMLElement) => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    // Focus the row that owns the selection. The selected class sits on the row
    // wrapper for some lists, and falling back to the first row would move the
    // anchor there, so the next arrow key restarts at the top of the list.
    fileListRow(container, selectedFileListPath(container))?.focus({ preventScroll: true });
  };
  // Virtual lists render only a window of rows, so scroll the target into view and
  // retry focusing it for a few frames until the new window is rendered.
  const focusListRow = (container: HTMLElement, top: number, rowHeight: number, selector: string) => {
    const bottom = top + rowHeight;
    if (top < container.scrollTop) container.scrollTop = Math.max(0, top - rowHeight);
    else if (bottom > container.scrollTop + container.clientHeight)
      container.scrollTop = bottom - container.clientHeight + rowHeight;
    const focus = (attempt = 0) => {
      const row = container.querySelector<HTMLButtonElement>(selector);
      if (row) row.focus({ preventScroll: true });
      else if (attempt < 8) requestAnimationFrame(() => focus(attempt + 1));
    };
    focus();
  };
  const focusChangesRow = (path: string) => {
    const container = fileListElement.current;
    const index = fileItems.items.findIndex((item) => item.kind === 'file' && item.change.path === path);
    if (!container || index < 0) return;
    focusListRow(
      container,
      fileItems.offsets[index],
      FILE_ROW_HEIGHT,
      `.file-select[data-path="${CSS.escape(path)}"]`,
    );
  };
  const navigateChangesList = (
    key: FileListKey,
    modifiers?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => {
    const paths = visibleFilePaths,
      path = paths[nextRowIndex(key, paths.indexOf(activeFile), paths.length)];
    if (!path) return;
    selectFileRow(path, modifiers);
    focusChangesRow(path);
  };
  const navigateDomFileList = (container: HTMLElement, key: FileListKey) => {
    const rows = [...container.querySelectorAll<HTMLButtonElement>('.detail-select, .comparison-select')];
    const focused = rowIndex(rows, document.activeElement),
      selected = rows.findIndex((row) => row.dataset.path === selectedFileListPath(container)),
      next = rows[nextRowIndex(key, focused >= 0 ? focused : selected, rows.length)];
    if (!next) return;
    next.focus();
    const path = next.dataset.path || '',
      kind = container.dataset.fileList;
    if (kind === 'compare') setComparisonFile(path);
    else if (kind === 'stash') setStashFile(path);
    else setHistoryFile(path);
  };
  const currentFileList = () => {
    if (dialog?.type === 'compare') return document.querySelector<HTMLElement>('[data-file-list="compare"]');
    if (view === 'changes') return document.querySelector<HTMLElement>('[data-file-list="changes"]');
    if (view === 'stash') return document.querySelector<HTMLElement>('[data-file-list="stash"]');
    if (view === 'log') return document.querySelector<HTMLElement>('[data-file-list="detail"]');
    return null;
  };
  const moveFileListFocus = (container: HTMLElement, key: FileListKey) => {
    if (container.dataset.fileList === 'changes') navigateChangesList(key);
    else navigateDomFileList(container, key);
  };
  const handleFileListKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!isFileListKey(event.key)) return;
    // Arrows only move the selection; Enter or a click opens the diff, so browsing
    // never hands the keyboard focus to an editor tab.
    event.preventDefault();
    event.stopPropagation();
    moveFileListFocus(event.currentTarget, event.key);
  };
  // The commit history is virtualized the same way, so it walks logical rows too.
  const navigateCommitList = (key: FileListKey) => {
    const container = logListElement.current;
    const index = nextRowIndex(
      key,
      visibleCommits.findIndex((commit) => commit.hash === activeCommit),
      visibleCommits.length,
    );
    const commit = visibleCommits[index];
    if (!container || !commit) return;
    setActiveCommit(commit.hash);
    setHistoryFile('');
    focusListRow(
      container,
      index * COMMIT_ROW_HEIGHT,
      COMMIT_ROW_HEIGHT,
      `.log-row[data-hash="${CSS.escape(commit.hash)}"]`,
    );
  };
  const handleCommitListKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!isFileListKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    navigateCommitList(event.key);
  };
  // A native diff can take the editor focus. When the panel gets it back without a
  // focused row, send the arrow keys to the list instead of scrolling the panel.
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!isFileListKey(event.key) || event.defaultPrevented) return;
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      // History owns the keyboard through its commit list; the detail file list only
      // takes over once a row inside it has focus.
      if (view === 'log' && logListElement.current) {
        event.preventDefault();
        navigateCommitList(event.key);
        return;
      }
      const container = currentFileList();
      if (!container) return;
      event.preventDefault();
      moveFileListFocus(container, event.key);
      restoreFileListFocus(container);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });
  useEffect(() => {
    const restore = () => {
      const container = currentFileList();
      if (container) restoreFileListFocus(container);
    };
    window.addEventListener('focus', restore);
    return () => window.removeEventListener('focus', restore);
  });
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
    const untracked = targets.length > 0 && targets.every((change) => change.status === 'untracked');
    const onDisk = targets.filter((change) => change.status !== 'deleted');
    const single = paths.length === 1;
    return [
      {
        label: t('Show Diff'),
        icon: <GitCompareArrows size={14} />,
        disabled: !single || conflict,
        run: () => (showInlineDiff ? setActiveFile(paths[0]) : openNativeDiff(paths[0])),
      },
      {
        label: t('Open File'),
        icon: <GoToFile size={14} />,
        disabled: !single || !onDisk.length,
        run: () => openWorkingFile(paths[0]),
      },
      {
        label: t('Copy Path'),
        icon: <File size={14} />,
        disabled: !targets.length,
        run: () => void perform('copyPaths', { paths, absolute: true }, t('Copy Path')),
      },
      {
        label: t('Copy Relative Path'),
        icon: <File size={14} />,
        separator: true,
        disabled: !targets.length,
        run: () => void perform('copyPaths', { paths }, t('Copy Relative Path')),
      },
      {
        label: paths.length > 1 ? t('Add {0} files to Git', paths.length) : t('Add to Git'),
        icon: <Plus size={14} />,
        disabled: isBusy || !targets.length || conflict || alreadyStaged,
        run: () => void perform('stage', { paths }, t('Add to Git')),
      },
      {
        label: t('Rollback Changes…'),
        icon: <Undo2 size={14} />,
        disabled: isBusy || !targets.length || conflict,
        run: () => void perform('discard', { paths }, t('Discard Changes')),
      },
      {
        label: t('Delete Files…'),
        icon: <Trash2 size={14} />,
        danger: true,
        separator: true,
        disabled: isBusy || !onDisk.length,
        run: () => void perform('deleteFiles', { paths }, t('Delete Files')),
      },
      {
        label: t('Add to .gitignore'),
        icon: <ShieldCheck size={14} />,
        separator: true,
        disabled: isBusy || !untracked,
        run: () => void perform('ignorePaths', { paths }, t('Add to .gitignore')),
      },
      {
        label: t('Add to .git/info/exclude'),
        icon: <ShieldCheck size={14} />,
        disabled: isBusy || !untracked,
        run: () => void perform('ignorePaths', { paths, target: 'exclude' }, t('Add to .git/info/exclude')),
      },
      {
        label: t('Move to Another Changelist…'),
        icon: <FolderClosed size={14} />,
        separator: true,
        disabled: isBusy || !targets.length,
        run: (anchor) => showDialog({ type: 'move', paths }, anchor),
      },
      {
        label: t('Commit Selected Files…'),
        icon: <GitCommitHorizontal size={14} />,
        disabled: isBusy || !targets.length || conflict || !!snapshot?.operation,
        run: () => commitPaths(paths),
      },
      {
        label: t('Reveal in File Manager'),
        icon: <ExternalLink size={14} />,
        separator: true,
        disabled: !single || !onDisk.length,
        run: () => void perform('revealPath', { path: paths[0] }, t('Reveal in File Manager')),
      },
    ];
  };
  const totalAdded = changes
    .filter((change) => selected.has(change.path))
    .reduce((sum, change) => sum + change.additions, 0);
  const totalDeleted = changes
    .filter((change) => selected.has(change.path))
    .reduce((sum, change) => sum + change.deletions, 0);
  // Keep the checked-out branch first; the rest keeps the host's name order.
  const localBranches = currentFirst(
    (snapshot?.branches || []).filter(
      (branch) => !branch.remote && branch.name.toLowerCase().includes(branchQuery.toLowerCase()),
    ),
  );
  const remoteBranches = (snapshot?.branches || []).filter(
    (branch) => branch.remote && branch.name.toLowerCase().includes(branchQuery.toLowerCase()),
  );
  const visibleCommits = useMemo(() => {
    // A selected branch loads its own history from Git: filtering the shared log window
    // dropped older commits and could keep commits that only exist on the remote.
    const commits = branchFilter ? (branchCommits ?? []) : snapshot?.commits || [];
    const query = logQuery.toLowerCase();
    return commits.filter((commit) =>
      `${commit.subject} ${commit.author} ${commit.hash}`.toLowerCase().includes(query),
    );
  }, [snapshot?.commits, branchFilter, branchCommits, logQuery]);
  // Keep the selection inside the visible history, so the detail pane never keeps a
  // commit that belongs to the branch selected before.
  useEffect(() => {
    if (!visibleCommits.length || visibleCommits.some((commit) => commit.hash === activeCommit)) return;
    setActiveCommit(visibleCommits[0].hash);
    setHistoryFile('');
  }, [visibleCommits, activeCommit]);
  const graph = useMemo(() => makeGraph(visibleCommits), [visibleCommits]);
  const [logStart, logEnd] = uniformRange(visibleCommits.length, COMMIT_ROW_HEIGHT, logViewport);
  // Size the graph column from the rows actually on screen. Reserving the width of
  // the densest merge anywhere in history left a wide empty gutter above it.
  const graphWidth = useMemo(() => {
    const first = Math.floor(logViewport.top / COMMIT_ROW_HEIGHT);
    const last = Math.max(
      first + 1,
      Math.ceil((logViewport.top + (logViewport.height || COMMIT_ROW_HEIGHT)) / COMMIT_ROW_HEIGHT),
    );
    let lanes = 1;
    for (let index = first; index < last; index++) lanes = Math.max(lanes, graph.rowLanes[index] ?? 1);
    return Math.min(MAX_GRAPH_WIDTH, graphColumnWidth(lanes));
  }, [graph, logViewport.top, logViewport.height]);
  const repositoryOptions = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [];
    if (!snapshot?.repository) list.push({ value: '', label: t('Select repository') });
    for (const repo of snapshot?.repositories ?? [])
      list.push({ value: repo.path, label: repo.name, title: repo.path });
    list.push({ value: '__pick', label: t('Open another repository…'), separator: true });
    return list;
  }, [snapshot?.repository, snapshot?.repositories]);
  const branchFilterOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('All branches') },
      ...(snapshot?.branches ?? []).map((branch) => ({
        value: branch.name,
        label: branch.name,
        title: branch.remote ? t('Remote branch {0}', branch.name) : branch.name,
      })),
    ],
    [snapshot?.branches],
  );
  const selectedFiles = [...selected];
  const openNative = () => {
    if (!diffFile) return;
    setInlinePreview(false);
    openNativeDiff(
      diffFile,
      view === 'log' ? activeCommit : undefined,
      view === 'stash' ? activeStash : undefined,
      false,
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
        label: branch.current
          ? t('Current branch')
          : branch.remote
            ? t('Check out and track remote branch')
            : t('Check out branch'),
        icon: <Check size={14} />,
        disabled: locked || branch.current,
        run: () => void perform('checkout', params, t('Switch Branch'), () => setDialog(null)),
      },
      {
        label: t('Create and switch from this branch…'),
        icon: <Plus size={14} />,
        disabled: locked,
        run: (anchor) => showDialog({ type: 'newBranch', branch }, anchor),
      },
      {
        label: t('Compare with current branch…'),
        icon: <GitCompareArrows size={14} />,
        disabled: isBusy || branch.current,
        separator: true,
        run: () => showDialog({ type: 'compare', branch }),
      },
      {
        label: t('Show history for this branch'),
        icon: <History size={14} />,
        run: () => {
          setBranchFilter(branch.name);
          setView('log');
          setDialog(null);
        },
      },
      {
        label: t('Merge {0} into the current branch', branch.name),
        icon: <GitMerge size={14} />,
        disabled: locked || branch.current,
        separator: true,
        run: () => void perform('merge', params, t('Merge Branch'), () => setDialog(null)),
      },
      {
        label: t('Rebase current branch onto {0}', branch.name),
        icon: <GitFork size={14} />,
        disabled: locked || branch.current || snapshot?.detached,
        run: () => void perform('rebase', params, t('Rebase'), () => setDialog(null)),
      },
    ];
    if (!branch.remote && !branch.current)
      actions.push(
        {
          label: t('Update branch from its upstream (fast-forward only)'),
          icon: <ArrowDownToLine size={14} />,
          disabled: locked || !branch.upstream,
          separator: true,
          run: () =>
            void perform('updateBranch', { branch: branch.name }, t('Update Branch'), () => setDialog(null)),
        },
        {
          label: t('Push this branch to its remote…'),
          icon: <ArrowUpFromLine size={14} />,
          disabled: locked,
          run: () =>
            void perform('pushBranch', { branch: branch.name }, t('Push Branch'), () => setDialog(null)),
        },
      );
    if (!branch.remote)
      actions.push(
        {
          label: t('Rename branch…'),
          icon: <Settings2 size={14} />,
          disabled: locked,
          separator: true,
          run: (anchor) => showDialog({ type: 'renameBranch', branch }, anchor),
        },
        {
          label: t('Set upstream branch…'),
          icon: <Box size={14} />,
          disabled: locked,
          run: (anchor) => showDialog({ type: 'upstream', branch }, anchor),
        },
      );
    if (branch.current)
      actions.push(
        {
          label: t('Pull and update current branch'),
          icon: <ArrowDownToLine size={14} />,
          disabled: locked || !snapshot?.upstream,
          separator: true,
          run: () => void perform('pull', {}, t('Update Project'), () => setDialog(null)),
        },
        {
          label: t('Push current branch…'),
          icon: <ArrowUpFromLine size={14} />,
          disabled: locked,
          run: () => showDialog({ type: 'push' }),
        },
      );
    actions.push(
      {
        label: t('Copy branch name'),
        icon: <Code2 size={14} />,
        separator: true,
        run: () => void perform('copyBranch', params, t('Copy Branch Name')),
      },
      {
        label: branch.remote ? t('Delete remote branch…') : t('Delete branch…'),
        icon: <Trash2 size={14} />,
        disabled: locked || branch.current,
        danger: true,
        run: () =>
          void perform('deleteBranch', { name: branch.name, remote: branch.remote }, t('Delete Branch'), () =>
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
        label: t('Cherry-pick commit'),
        icon: <GitCommitHorizontal size={14} />,
        disabled: locked,
        run: () => void perform('cherryPick', { hash: target.hash }, t('Cherry-pick')),
      },
      {
        label: t('Revert commit'),
        icon: <Undo2 size={14} />,
        disabled: locked,
        run: () => void perform('revert', { hash: target.hash }, t('Revert Commit')),
      },
      {
        label: t('Hard reset current branch to this commit…'),
        icon: <RefreshCw size={14} />,
        disabled: locked || snapshot?.detached,
        separator: true,
        danger: true,
        run: () => void perform('reset', { hash: target.hash }, t('Hard Reset')),
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
        title={t(
          '{0}\n{1}\nClick to view history, right-click for branch actions, double-click to check out',
          branch.name,
          branch.subject,
        )}
        onClick={() => {
          setBranchFilter(branch.name);
          setView('log');
        }}
        onDoubleClick={() => {
          if (!branch.current && !isBusy)
            void perform('checkout', { branch: branch.name, remote: branch.remote }, t('Switch Branch'));
        }}
      >
        <GitBranch size={14} className={branch.current ? 'current-branch-icon' : undefined} />
        <span className="branch-label">{label}</span>
        {branch.current && (
          <span
            className="current-check"
            title={t('Current branch')}
            role="img"
            aria-label={t('Current branch')}
          >
            <Check size={12} />
          </span>
        )}
        <BranchSync branch={branch} />
      </button>
      <button
        className="icon-button"
        title={t('Branch actions for {0}', branch.name)}
        aria-label={t('Branch actions for {0}', branch.name)}
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
          title={t(open ? 'Collapse branch group {0}' : 'Expand branch group {0}', folder.path)}
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
    // The current branch stays on top of the local list, outside the namespace tree.
    const current = scope === 'local' ? branches.find((branch) => branch.current) : undefined;
    const tree = groupBranches(
      current ? branches.filter((branch) => branch !== current) : branches,
      scope === 'remote' ? snapshot?.remotes || [] : [],
    ).map((entry) =>
      entry.kind === 'branch' ? branchRow(entry.branch, entry.label) : branchFolder(entry, scope, 0),
    );
    return current ? [branchRow(current), ...tree] : tree;
  };
  // Section keys have no ':' so they cannot collide with folder keys like `local:feature`.
  const branchSection = (scope: 'local' | 'remote', title: string, branches: Branch[]) => {
    const open = !collapsedBranchFolders.has(scope);
    return (
      <>
        <button
          className={`branch-section branch-folder-heading${scope === 'remote' ? ' remote-heading' : ''}`}
          aria-expanded={open}
          title={t(open ? 'Collapse {0} branches' : 'Expand {0} branches', title)}
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
            ariaLabel={t('Select repository')}
            placeholder={t('Select repository')}
            value={snapshot?.repository?.path || ''}
            options={repositoryOptions}
            menuMinWidth={240}
            onChange={(value) => {
              if (value === '__pick') void perform('pickRepository', {}, t('Select Repository'));
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
              title={t('Switch, merge, or create a branch')}
              aria-haspopup="dialog"
              aria-expanded={!!branchDropdown}
              onContextMenu={(event) => {
                event.preventDefault();
                const branch = snapshot?.branches.find((branch) => branch.current);
                if (branch) openBranchMenu(branch, event.clientX, event.clientY);
              }}
            >
              <GitBranch size={13} />
              <span>{snapshot?.branch || t('No repository open')}</span>
              <ChevronDown size={11} />
            </button>
            <nav className="panel-tabs" aria-label={t('Git views')}>
              <button className={view === 'changes' ? 'selected' : ''} onClick={() => setView('changes')}>
                <ListChecks size={14} />
                {t('Changes')}
                <span>{changes.length}</span>
              </button>
              <button
                className={view === 'log' ? 'selected' : ''}
                onClick={() => {
                  setView('log');
                  setBranchFilter('');
                }}
              >
                <History size={14} />
                {t('History')}
              </button>
              <button className={view === 'stash' ? 'selected' : ''} onClick={() => setView('stash')}>
                <Layers size={14} />
                Stash<span>{snapshot?.stashes.length || 0}</span>
              </button>
            </nav>
          </>
        )}
        {isPreview && <span className="preview-badge">{t('Interactive preview · Sample repository')}</span>}
        <div className="spacer" />
        <button
          className="toolbar-button"
          disabled={isBusy || !snapshot?.remotes.length}
          title={t('Fetch the latest information from all remotes')}
          onClick={() => void perform('fetch', {}, t('Fetch Updates'))}
        >
          <RefreshCw size={14} />
          {t('Fetch')}
        </button>
        <button
          className="toolbar-button"
          disabled={isBusy || !snapshot?.upstream}
          title={t('Update Project')}
          onClick={() => void perform('pull', {}, t('Update Project'))}
        >
          <ArrowDownToLine size={15} />
          {t('Pull')}
          {snapshot?.behind ? <span className="count">{snapshot.behind}</span> : null}
        </button>
        <button
          className="button push-button"
          disabled={isBusy || !snapshot?.repository || snapshot.detached}
          onClick={() => showDialog({ type: 'push' })}
        >
          <ArrowUpFromLine size={14} />
          {t('Push')}
          {snapshot?.ahead ? <span>{snapshot.ahead}</span> : null}
        </button>
        <IconButton
          title={t('Refresh workbench')}
          disabled={isBusy || refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
        </IconButton>
        <IconButton title={t('Guide and keyboard shortcuts')} onClick={() => showDialog({ type: 'help' })}>
          <BookOpen size={16} />
        </IconButton>
      </header>
      <div className="workspace-body">
        <aside className="sidebar">
          <div className="workspace-caption">
            {t('Workspace')}
            <span className="caption-dot" />
          </div>
          <nav className="main-nav" aria-label={t('Git navigation')}>
            <button className={view === 'changes' ? 'selected' : ''} onClick={() => setView('changes')}>
              <ListChecks size={17} />
              <span>{t('Local Changes')}</span>
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
              <span>{t('Commit History')}</span>
            </button>
            <button className={view === 'stash' ? 'selected' : ''} onClick={() => setView('stash')}>
              <Layers size={17} />
              <span>Stash</span>
              <b>{snapshot?.stashes.length || 0}</b>
            </button>
          </nav>
          <div className="sidebar-rule" />
          <div className="branch-heading">
            <span>{t('Branches')}</span>
            <div className="branch-heading-actions">
              <IconButton
                title={branchGrouped ? t('Toggle flat branch list') : t('Group branches by prefix')}
                className={branchGrouped ? 'active' : ''}
                disabled={!snapshot?.repository}
                onClick={() => setBranchGrouped((value) => !value)}
              >
                <ListTree size={15} />
              </IconButton>
              <IconButton
                title={t('Fetch all remote branches without changing local branches')}
                disabled={isBusy || !snapshot?.remotes.length}
                onClick={() => void perform('fetch', {}, t('Fetch Updates'))}
              >
                <RefreshCw size={15} />
              </IconButton>
              <IconButton
                title={t('New branch')}
                disabled={isBusy || !snapshot?.repository || !snapshot.commits.length}
                onClick={(event) =>
                  showDialog({ type: 'newBranch' }, event.currentTarget.getBoundingClientRect())
                }
              >
                <Plus size={15} />
              </IconButton>
            </div>
          </div>
          <label className="search-box branch-search">
            <Search size={13} />
            <input
              aria-label={t('Search branches')}
              placeholder={t('Search branches…')}
              value={branchQuery}
              onChange={(event) => {
                setBranchQuery(event.target.value);
                setCollapsedBranchFolders(new Set());
              }}
            />
            <kbd>⌕</kbd>
          </label>
          <div className="branches-scroll">
            {branchSection('local', t('local'), localBranches)}
            {branchSection('remote', t('remote'), remoteBranches)}
            {!localBranches.length && !remoteBranches.length && (
              <p className="sidebar-empty">
                {branchQuery ? t('No matching branches') : t('Branches appear after the first commit')}
              </p>
            )}
          </div>
        </aside>
        <ResizeHandle
          label={t('Resize branch pane')}
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
                  ? t('Rebase in progress')
                  : snapshot?.merging
                    ? t('Merge in progress')
                    : snapshot?.operation === 'cherry-pick'
                      ? t('Cherry-pick in progress')
                      : snapshot?.operation === 'revert'
                        ? t('Revert in progress')
                        : t('Git operation has conflicts')}{' '}
                · {t('Resolve conflicts, mark them as resolved, then continue.')}
              </span>
              <button
                disabled={isBusy}
                onClick={() => void perform('continueOperation', {}, t('Continue Operation'))}
              >
                {t('Continue')}
              </button>
              <button
                disabled={isBusy}
                onClick={() => void perform('abortOperation', {}, t('Abort Operation'))}
              >
                {t('Abort')}
              </button>
            </div>
          )}
          {!snapshot ? (
            <Empty
              icon={<LoaderCircle size={32} className="spin" />}
              title={t('Connecting to Git repository…')}
            />
          ) : !snapshot.repository ? (
            <Empty
              icon={<FolderGit2 size={42} />}
              title={t('Start with a Git repository')}
              detail={t(
                "Open an existing repository to manage changes, branches, and commits the way you're used to.",
              )}
            >
              <button
                className="button primary"
                disabled={isBusy}
                onClick={() => void perform('pickRepository', {}, t('Open Repository'))}
              >
                <FolderClosed size={15} />
                {t('Open Repository')}
              </button>
            </Empty>
          ) : view === 'changes' ? (
            <div className={`changes-workspace ${showMiddlePane ? '' : 'native-diff'}`}>
              {showMiddlePane && (
                <ResizeHandle
                  label={t('Resize file list')}
                  min={150}
                  target=".file-list"
                  value={sizes.files}
                  reset={defaultSizes.files}
                  onChange={resize('files')}
                  reserve=".commit-panel"
                  style={{ left: 'var(--file-width)' }}
                />
              )}
              <ResizeHandle
                label={t('Resize commit panel')}
                min={180}
                target=".commit-panel"
                side="right"
                value={sizes.commit}
                reset={defaultSizes.commit}
                onChange={resize('commit')}
                /* Without the middle diff the file list is the elastic 1fr track, so
                   only its minimum width is reserved; 150 matches the track floor. */
                reserve={showMiddlePane ? '.file-list' : 150}
                reserveExtra={showMiddlePane ? 160 : 0}
                style={{ right: 'var(--commit-width)' }}
              />
              <section className="changes-panel" aria-label={t('Local changes list')}>
                <div className="panel-toolbar">
                  <span className="panel-title">
                    {t('Changes')}
                    <span className="count">{changes.length}</span>
                  </span>
                  <div className="spacer" />
                  <IconButton
                    title={t('New changelist')}
                    disabled={isBusy}
                    onClick={(event) =>
                      showDialog({ type: 'changelist' }, event.currentTarget.getBoundingClientRect())
                    }
                  >
                    <Plus size={15} />
                  </IconButton>
                  <IconButton
                    title={t('Move checked files to a changelist')}
                    disabled={!selected.size || isBusy}
                    onClick={(event) =>
                      showDialog({ type: 'move' }, event.currentTarget.getBoundingClientRect())
                    }
                  >
                    <FolderClosed size={14} />
                  </IconButton>
                  <IconButton
                    title={t('Discard checked changes')}
                    disabled={!selected.size || isBusy}
                    onClick={() => void perform('discard', { paths: selectedFiles }, t('Discard Changes'))}
                  >
                    <Undo2 size={14} />
                  </IconButton>
                  <IconButton
                    title={
                      fileGrouped ? t('Toggle flat changed file list') : t('Group changed files by directory')
                    }
                    className={fileGrouped ? 'active' : ''}
                    onClick={toggleFileLayout}
                  >
                    <ListTree size={15} />
                  </IconButton>
                  {!showInlineDiff && (
                    <IconButton title={t('Show inline diff')} onClick={() => setInlinePreview(true)}>
                      <GitCompareArrows size={15} />
                    </IconButton>
                  )}
                </div>
                <label className="search-box file-search">
                  <Search size={14} />
                  <input
                    aria-label={t('Search changed files')}
                    placeholder={t('Filter by file name…')}
                    value={fileQuery}
                    onChange={(event) => setFileQuery(event.target.value)}
                  />
                  {fileQuery && (
                    <button aria-label={t('Clear file filter')} onClick={() => setFileQuery('')}>
                      <X size={13} />
                    </button>
                  )}
                </label>
                <div
                  className="file-list"
                  data-file-list="changes"
                  onKeyDown={handleFileListKeyDown}
                  ref={(element) => {
                    fileListElement.current = element;
                    fileViewport.ref(element);
                  }}
                >
                  {!changes.length ? (
                    <Empty
                      icon={<CircleCheck size={32} />}
                      title={t('Working tree is clean')}
                      detail={t('New changes will appear here.')}
                    />
                  ) : !filteredChanges.length ? (
                    <Empty icon={<Search size={26} />} title={t('No matching files')} />
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
                                aria-label={t(
                                  collapsed.has(group.id) ? 'Expand {0}' : 'Collapse {0}',
                                  group.name,
                                )}
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
                                aria-label={t('Select {0}', group.name)}
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
                              {group.id === 'default' && <span className="default-tag">{t('Default')}</span>}
                              {!['default', 'conflicts', 'untracked'].includes(group.id) && (
                                <IconButton
                                  title={t('Delete changelist {0}', group.name)}
                                  disabled={isBusy}
                                  onClick={() =>
                                    void perform(
                                      'changelist',
                                      { action: 'delete', id: group.id },
                                      t('Delete Changelist'),
                                    )
                                  }
                                >
                                  <X size={12} />
                                </IconButton>
                              )}
                            </div>
                          );
                        }
                        if (item.kind === 'folder') {
                          const key = fileFolderKey(item.groupId, item.folder.path);
                          const open = !!fileQuery || !collapsedFileFolders.has(key);
                          return (
                            <div
                              className="file-folder"
                              key={`folder:${item.groupId}:${item.folder.path}`}
                              style={{ paddingLeft: 8 + item.depth * FILE_TREE_INDENT }}
                            >
                              <button
                                className="file-folder-toggle"
                                aria-expanded={open}
                                title={t(
                                  open ? 'Collapse directory {0}' : 'Expand directory {0}',
                                  item.folder.path,
                                )}
                                onClick={() => toggleFileFolder(key)}
                              >
                                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                <FolderClosed size={13} />
                                <span>{item.folder.name}</span>
                                <small>{item.folder.count}</small>
                              </button>
                            </div>
                          );
                        }
                        const change = item.change;
                        const stage = stageState(change);
                        return (
                          <div
                            className={`file-row ${activeFile === change.path ? 'selected' : ''} ${fileSelection.has(change.path) ? 'marked' : ''}`}
                            key={`file:${change.path}`}
                            style={
                              fileGrouped ? { paddingLeft: 8 + item.depth * FILE_TREE_INDENT } : undefined
                            }
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
                              aria-label={t('Select file {0}', change.path)}
                              checked={selected.has(change.path)}
                              disabled={isBusy || change.status === 'conflict'}
                              onFocus={() => setActiveFile(change.path)}
                              onChange={() => toggle(change.path)}
                            />
                            <button
                              className="file-select"
                              data-path={change.path}
                              data-status={change.status}
                              onFocus={() => setActiveFile(change.path)}
                              title={`${change.path}\n${statusLabels[change.status]}${stage ? `\n${stage === 'staged' ? t('All changes are staged') : t('Some changes are staged; the working tree has unstaged changes')}` : ''}\n${t('Shift / {0} click to select multiple', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')}`}
                              onClick={(event) => {
                                selectFileRow(change.path, event);
                                if (
                                  !showInlineDiff &&
                                  !event.shiftKey &&
                                  !event.metaKey &&
                                  !event.ctrlKey &&
                                  change.status !== 'conflict'
                                )
                                  openNativeDiff(change.path);
                              }}
                              onKeyDown={(event) => {
                                if (
                                  event.key === 'Enter' &&
                                  !showInlineDiff &&
                                  change.status !== 'conflict'
                                ) {
                                  event.preventDefault();
                                  openNativeDiff(change.path);
                                }
                                if (event.key === ' ' && !isBusy && change.status !== 'conflict') {
                                  event.preventDefault();
                                  toggle(change.path);
                                }
                              }}
                              onDoubleClick={() => {
                                if (showInlineDiff) openNativeDiff(change.path);
                              }}
                            >
                              <FileIcon file={change.path} />
                              <span className="file-label">
                                <strong className={`file-name status-${change.status}`}>
                                  {basename(change.path)}
                                </strong>
                                {!fileGrouped && <small>{dirname(change.path) || t('Project root')}</small>}
                              </span>
                              {stage && (
                                <span
                                  className={`stage-badge ${stage}`}
                                  title={
                                    stage === 'staged'
                                      ? t('This file is fully staged')
                                      : t('Some changes are staged; the working tree has unstaged changes')
                                  }
                                >
                                  {stage === 'staged' ? t('Staged') : t('Partially staged')}
                                </span>
                              )}
                              <span
                                className={`file-status ${change.status}`}
                                title={t('Status: {0}', statusLabels[change.status])}
                              >
                                {statusLetters[change.status]}
                              </span>
                            </button>
                            {openFileAction(change.path, change.status !== 'deleted')}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="selection-summary">
                  <span>
                    {t('Selected {0} of {1} files', selected.size, changes.length)}
                    {fileSelection.size > 1 && <em> · {t('Selected: {0}', fileSelection.size)}</em>}
                  </span>
                  <span className="diff-stat">
                    <b>+{totalAdded}</b>
                    <i>−{totalDeleted}</i>
                  </span>
                </div>
                <div className="commit-panel">
                  <div className="commit-heading">
                    <GitCommitHorizontal size={16} />
                    <strong>{t('Commit changes')}</strong>
                    <span>COMMIT</span>
                  </div>
                  <textarea
                    ref={commitInput}
                    aria-label={t('Commit message')}
                    placeholder={t(
                      'Describe the purpose of this change…\n\nFor example: feat: add a command palette',
                    )}
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
                      {t('Only commits all changes in checked files')}
                    </span>
                    <span>{currentDraft.split('\n')[0].length}/72</span>
                  </div>
                  <div className="commit-actions">
                    <button
                      className="button primary"
                      disabled={isBusy || !selected.size || !currentDraft.trim() || !!snapshot.operation}
                      onClick={() => commit()}
                    >
                      {busy.startsWith(t('Commit')) ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Check size={14} />
                      )}
                      {t('Commit')}
                      {selected.size ? <span>{selected.size}</span> : null}
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
                      {t('Commit & Push')}
                      <ArrowUpRightIcon />
                    </button>
                  </div>
                  <div className="keyboard-hint">
                    <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd>
                    <kbd>↵</kbd>
                    <span>{t('Commit changes')}</span>
                    <button
                      disabled={isBusy || !changes.length}
                      title={t('Stash all local changes, including untracked files')}
                      onClick={(event) =>
                        showDialog({ type: 'stash' }, event.currentTarget.getBoundingClientRect())
                      }
                    >
                      <Layers size={12} />
                      Stash
                    </button>
                  </div>
                </div>
              </section>
              {activeConflict ? (
                <div className="conflict-view">
                  <Empty
                    icon={<GitMerge size={42} />}
                    title={t('This file has merge conflicts')}
                    detail={activeFile}
                  >
                    <button
                      className="button primary"
                      onClick={() => void perform('resolve', { path: activeFile }, t('Open Merge Editor'))}
                    >
                      {t('Open 3-way Merge Editor')}
                    </button>
                    <button
                      className="button"
                      disabled={isBusy}
                      onClick={() => void perform('markResolved', { path: activeFile }, t('Mark Resolved'))}
                    >
                      {t('Mark as Resolved')}
                    </button>
                  </Empty>
                </div>
              ) : showInlineDiff ? (
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
              ) : null}
            </div>
          ) : view === 'log' ? (
            <div className="history-workspace">
              <div className="history-upper">
                <ResizeHandle
                  label={t('Resize commit details')}
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
                        aria-label={t('Search commits')}
                        placeholder={t('Search commits, authors, or hashes…')}
                        value={logQuery}
                        onChange={(event) => setLogQuery(event.target.value)}
                      />
                    </label>
                    <SelectMenu
                      ariaLabel={t('Filter branch history')}
                      className="filter-select"
                      value={branchFilter}
                      options={branchFilterOptions}
                      menuMinWidth={220}
                      onChange={setBranchFilter}
                    />
                    <span className="history-count">{t('Commits: {0}', visibleCommits.length)}</span>
                  </div>
                  <div className="log-table-header">
                    <span style={{ width: graphWidth }}>{t('Commit graph')}</span>
                    <span className="log-subject">{t('Subject')}</span>
                    <span className="log-author">{t('Author')}</span>
                    <span className="log-hash">Hash</span>
                    <span className="log-date">{t('Date')}</span>
                  </div>
                  <div
                    className="log-scroll"
                    ref={(element) => {
                      logListElement.current = element;
                      logViewport.ref(element);
                    }}
                    onKeyDown={handleCommitListKeyDown}
                  >
                    {!visibleCommits.length ? (
                      <Empty
                        icon={<History size={32} />}
                        title={
                          branchFilter && !branchCommits
                            ? t('Reading branch history…')
                            : logQuery || branchFilter
                              ? t('No matching commits')
                              : t('No commits yet')
                        }
                        detail={t('History will appear here after the first commit.')}
                      />
                    ) : (
                      <div className="log-table">
                        <svg
                          className="commit-graph"
                          style={{ width: graphWidth }}
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
                            data-hash={commit.hash}
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
                            title={t(
                              '{0}\nRight-click or press Shift+F10 for commit actions',
                              commit.subject,
                            )}
                          >
                            <span style={{ width: graphWidth }} />
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
                              {commit.parents.length > 1 && (
                                <span className="merge-badge" title={t('Merge commit')}>
                                  {t('Merge')}
                                </span>
                              )}
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
                    <span>{t('Latest {0} commits · sorted topologically', snapshot.commits.length)}</span>
                    <div className="spacer" />
                    <button
                      onClick={() => {
                        setLogQuery('');
                        setBranchFilter('');
                      }}
                    >
                      {t('Reset filters')}
                    </button>
                  </div>
                </section>
                <aside className="commit-detail">
                  {detail ? (
                    <>
                      <div className="detail-title">
                        <GitCommitHorizontal size={16} />
                        <strong>{t('Commit details')}</strong>
                        {detail.commit.parents.length > 1 && (
                          <span className="merge-badge" title={t('Merge commit')}>
                            {t('Merge')}
                          </span>
                        )}
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
                          title={t('Apply this commit to the current branch')}
                          onClick={() => void perform('cherryPick', { hash: activeCommit }, t('Cherry-pick'))}
                        >
                          <GitCommitHorizontal size={13} />
                          Cherry-pick
                        </button>
                        <IconButton
                          title={t('Revert this commit (creates an inverse commit)')}
                          disabled={isBusy}
                          onClick={() => void perform('revert', { hash: activeCommit }, t('Revert Commit'))}
                        >
                          <Undo2 size={14} />
                        </IconButton>
                      </div>
                      <div className="detail-files-heading">
                        {t('Changed files')}
                        <span>{detail.files.length}</span>
                        <div className="spacer" />
                        <IconButton
                          title={
                            fileGrouped
                              ? t('Toggle flat changed file list')
                              : t('Group changed files by directory')
                          }
                          className={fileGrouped ? 'active' : ''}
                          onClick={toggleFileLayout}
                        >
                          <ListTree size={13} />
                        </IconButton>
                        {!showInlineDiff && (
                          <IconButton
                            title={t('Show inline diff')}
                            disabled={!historyFile}
                            onClick={() => setInlinePreview(true)}
                          >
                            <GitCompareArrows size={13} />
                          </IconButton>
                        )}
                      </div>
                      <div className="detail-files" data-file-list="detail" onKeyDown={handleFileListKeyDown}>
                        {fileGrouped
                          ? detailItems.map((item) =>
                              item.kind === 'folder' ? (
                                <button
                                  className="detail-folder"
                                  key={`folder:${item.folder.path}`}
                                  title={item.folder.path}
                                  aria-expanded={!collapsedDetailFolders.has(item.folder.path)}
                                  style={{ paddingLeft: 8 + item.depth * FILE_TREE_INDENT }}
                                  onClick={() => toggleDetailFolder(item.folder.path)}
                                >
                                  {collapsedDetailFolders.has(item.folder.path) ? (
                                    <ChevronRight size={12} />
                                  ) : (
                                    <ChevronDown size={12} />
                                  )}
                                  <FolderClosed size={13} />
                                  <span>{item.folder.name}</span>
                                  <small>{item.folder.count}</small>
                                </button>
                              ) : (
                                detailFileRow(item.change, item.depth)
                              ),
                            )
                          : detail.files.map((file) => detailFileRow(file, 0))}
                      </div>
                      <p className="detail-tip">
                        {showInlineDiff
                          ? t('Select a file to view its changes from this commit below.')
                          : t('Select a file to open its diff in the main editor.')}
                      </p>
                    </>
                  ) : (
                    <Empty
                      icon={<GitCommitHorizontal size={28} />}
                      title={activeCommit ? t('Loading commit details…') : t('Select a commit')}
                    />
                  )}
                </aside>
              </div>
              {historyFile && showInlineDiff && (
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
            <div className={`stash-workspace ${showInlineDiff ? '' : 'native-diff'}`}>
              {showInlineDiff && (
                <ResizeHandle
                  label={t('Resize Stash list')}
                  min={160}
                  target=".stash-list"
                  value={sizes.stash}
                  reset={defaultSizes.stash}
                  onChange={resize('stash')}
                  style={{ left: 'var(--stash-width)' }}
                />
              )}
              <section className="stash-list">
                <div className="panel-toolbar">
                  <strong>{t('Stashed changes')}</strong>
                  <span className="count">{snapshot.stashes.length}</span>
                  <div className="spacer" />
                  {!showInlineDiff && (
                    <IconButton
                      title={t('Show inline diff')}
                      disabled={!stashFile}
                      onClick={() => setInlinePreview(true)}
                    >
                      <GitCompareArrows size={15} />
                    </IconButton>
                  )}
                  <IconButton
                    title={t('Stash all current changes')}
                    disabled={isBusy || !changes.length}
                    onClick={(event) =>
                      showDialog({ type: 'stash' }, event.currentTarget.getBoundingClientRect())
                    }
                  >
                    <Plus size={16} />
                  </IconButton>
                </div>
                {!snapshot.stashes.length ? (
                  <Empty
                    icon={<Layers size={32} />}
                    title={t('No stashed changes')}
                    detail={t('Use Stash to save your progress when switching tasks.')}
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
                      onClick={() => void perform('stashApply', { ref: activeStash }, t('Apply Stash'))}
                    >
                      <ArrowDown size={14} />
                      {t('Apply')}
                    </button>
                    <button
                      className="button"
                      disabled={isBusy}
                      onClick={() =>
                        void perform('stashApply', { ref: activeStash, pop: true }, t('Apply & Drop Stash'))
                      }
                    >
                      {t('Apply & Drop')}
                    </button>
                    <IconButton
                      title={t('Delete selected stash')}
                      disabled={isBusy}
                      onClick={() => void perform('stashDrop', { ref: activeStash }, t('Delete Stash'))}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                )}
                <div className="detail-files" data-file-list="stash" onKeyDown={handleFileListKeyDown}>
                  {stashFiles.map((file) => (
                    <div
                      className={`detail-file-row${stashFile === file.path ? ' selected' : ''}`}
                      key={file.path}
                    >
                      <button
                        className={`detail-select${stashFile === file.path ? ' selected' : ''}`}
                        data-path={file.path}
                        onFocus={() => setStashFile(file.path)}
                        onClick={() => {
                          setStashFile(file.path);
                          if (!showInlineDiff) openNativeDiff(file.path, undefined, activeStash);
                        }}
                      >
                        <FileIcon file={file.path} />
                        <span className={`file-name status-${file.status}`}>
                          {basename(file.path)}
                          <small>{dirname(file.path)}</small>
                        </span>
                        <b className={`file-status ${file.status}`}>{statusLetters[file.status]}</b>
                      </button>
                      {openFileAction(file.path, stashExists(file.path))}
                    </div>
                  ))}
                </div>
              </section>
              {showInlineDiff && (
                <DiffViewer
                  split={sizes.diff}
                  setSplit={resize('diff')}
                  diff={diff}
                  loading={diffLoading}
                  openNative={openNative}
                />
              )}
            </div>
          )}
          {consoleOpen && (
            <section className="console-panel">
              <div className="panel-toolbar">
                <Terminal size={14} />
                <strong>{t('Git Console')}</strong>
                <span className="count">{activities.length}</span>
                <div className="spacer" />
                <IconButton title={t('Clear console')} onClick={() => setActivities([])}>
                  <Trash2 size={13} />
                </IconButton>
                <IconButton title={t('Close console')} onClick={() => setConsoleOpen(false)}>
                  <X size={14} />
                </IconButton>
              </div>
              <div className="console-scroll">
                {!activities.length ? (
                  <p className="muted">
                    {t('Commands and results will appear here after you run Git operations.')}
                  </p>
                ) : (
                  activities.map((activity) => (
                    <div className={`console-entry ${activity.error ? 'error' : ''}`} key={activity.id}>
                      <time>{new Date(activity.time).toLocaleTimeString(dateLocale, { hour12: false })}</time>
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
              {isPreview
                ? t('Sample repository · Interactive preview')
                : snapshot?.repository
                  ? t('Connected to local repository')
                  : t('Waiting for a repository')}
            </span>
          </>
        )}
        <div className="spacer" />
        <span className="status-hint">
          {selected.size ? t('{0} files ready to commit', selected.size) : t('All changes under control')}
        </span>
        <button className={consoleOpen ? 'active' : ''} onClick={() => setConsoleOpen(!consoleOpen)}>
          <Terminal size={12} />
          {t('Console')}
          {activities.some((activity) => activity.error) && <span className="error-dot" />}
        </button>
      </footer>
      {notice && (
        <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>
          {notice.error ? <Info size={18} /> : <CircleCheck size={18} />}
          <span>{notice.message}</span>
          {notice.error && <button onClick={() => setConsoleOpen(true)}>{t('View console')}</button>}
          <IconButton title={t('Dismiss notification')} onClick={() => setNotice(null)}>
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
          label={t('Commit actions for {0}', commitMenu.commit.hash.slice(0, 8))}
          actions={commitActions(commitMenu.commit)}
          close={closeCommitMenu}
        />
      )}
      {fileMenu && (
        <ContextMenu
          x={fileMenu.x}
          y={fileMenu.y}
          title={
            fileMenu.paths.length > 1 ? t('Selected files: {0}', fileMenu.paths.length) : fileMenu.paths[0]
          }
          label={t('File actions: {0}', fileMenu.paths.join(', '))}
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
          onNewBranch={(anchor) => {
            closeBranchDropdown();
            showDialog({ type: 'newBranch' }, anchor);
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
            savedFrame={dialog.anchor ? undefined : dialogFrames[dialog.type]}
            onFrameChange={(frame) => rememberDialogFrame(dialog.type, frame)}
            anchor={dialog.anchor}
            defaultWidth={
              dialog.anchor ? (dialog.type === 'move' ? 300 : dialog.type === 'stash' ? 340 : 320) : 480
            }
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
                title={
                  dialog.anchor
                    ? undefined
                    : t(
                        'Drag the title bar to move, drag the edges to resize, and double-click the title bar to restore the default position and size',
                      )
                }
              >
                {
                  {
                    newBranch: t('New Branch'),
                    renameBranch: t('Rename Branch'),
                    upstream: t('Set Upstream Branch'),
                    compare: t('Compare with Current Branch'),
                    changelist: t('New Changelist'),
                    stash: t('Stash Local Changes'),
                    push: t('Push Commits'),
                    move: t('Move to Changelist'),
                    help: t('A Familiar Git Workflow'),
                  }[dialog.type]
                }
              </h2>
              <IconButton title={t('Close dialog')} disabled={isBusy} onClick={() => setDialog(null)}>
                <X size={18} />
              </IconButton>
            </div>
            {dialog.type === 'compare' ? (
              <>
                <p className="modal-description comparison-route">
                  <code>{comparisonSwap ? snapshot?.branch : dialog.branch?.name}</code>
                  {comparisonSwap && <span className="tag">{t('Current')}</span>}
                  <ArrowRight size={14} />
                  <code>{comparisonSwap ? dialog.branch?.name : snapshot?.branch}</code>
                  {!comparisonSwap && <span className="tag">{t('Current')}</span>}
                  <span className="spacer" />
                  <IconButton
                    title={t('Swap compared branches')}
                    disabled={isBusy || !comparison}
                    onClick={() => setComparisonSwap((value) => !value)}
                  >
                    <ArrowSwap size={14} />
                  </IconButton>
                </p>
                <p className="modal-description">
                  {comparison
                    ? t(
                        'Current branch has {0} unique commits, the other branch has {1}; {2} files differ.',
                        comparison.ahead,
                        comparison.behind,
                        comparison.files.length,
                      )
                    : t('Comparing branches…')}
                </p>
                {comparison && (
                  <div className="comparison-toolbar">
                    <span>{t('Changed files')}</span>
                    <span>{comparison.files.length}</span>
                    <div className="spacer" />
                    <IconButton
                      title={
                        compareGrouped
                          ? t('Toggle flat changed file list')
                          : t('Group changed files by directory')
                      }
                      className={compareGrouped ? 'active' : ''}
                      onClick={() => setCompareGrouped((value) => !value)}
                    >
                      <ListTree size={13} />
                    </IconButton>
                  </div>
                )}
                <div className="comparison-files" data-file-list="compare" onKeyDown={handleFileListKeyDown}>
                  {comparison &&
                    compareItems.map((item) =>
                      item.kind === 'folder' ? (
                        <button
                          key={`folder:${item.folder.path}`}
                          className="comparison-folder"
                          title={item.folder.path}
                          aria-expanded={!collapsedCompareFolders.has(item.folder.path)}
                          style={{ paddingLeft: 12 + item.depth * FILE_TREE_INDENT }}
                          onClick={() => toggleCompareFolder(item.folder.path)}
                        >
                          {collapsedCompareFolders.has(item.folder.path) ? (
                            <ChevronRight size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )}
                          <FolderClosed size={13} />
                          <span>{item.folder.name}</span>
                          <small>{item.folder.count}</small>
                        </button>
                      ) : (
                        <div
                          className={`comparison-file-row${comparisonFile === item.change.path ? ' selected' : ''}`}
                          key={item.change.path}
                        >
                          <button
                            className="comparison-select"
                            data-path={item.change.path}
                            onFocus={() => setComparisonFile(item.change.path)}
                            style={
                              compareGrouped ? { paddingLeft: 26 + item.depth * FILE_TREE_INDENT } : undefined
                            }
                            onClick={() => {
                              setComparisonFile(item.change.path);
                              void perform(
                                'openBranchDiff',
                                {
                                  path: item.change.path,
                                  base: comparison.base,
                                  head: comparison.head,
                                  keepFocus: true,
                                },
                                t('Open Branch Comparison'),
                              );
                            }}
                          >
                            <FileIcon file={item.change.path} />
                            <span className={`file-name status-${item.change.status}`}>
                              {item.change.originalPath
                                ? `${item.change.originalPath} → ${item.change.path}`
                                : compareGrouped
                                  ? basename(item.change.path)
                                  : item.change.path}
                            </span>
                            <b className={`file-status ${item.change.status}`}>
                              {statusLetters[item.change.status]}
                            </b>
                          </button>
                          {openFileAction(item.change.path, compareExists(item.change.path))}
                        </div>
                      ),
                    )}
                  {comparison && !comparison.files.length && (
                    <p className="sidebar-empty">{t('The two branches have identical file contents')}</p>
                  )}
                </div>
                <div className="modal-footer">
                  <span className="muted">{t('Select a file to compare it in the VS Code diff editor')}</span>
                  <div className="spacer" />
                  <button className="button" onClick={() => setDialog(null)}>
                    {t('Close')}
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
                    t('Set Upstream Branch'),
                    () => setDialog(null),
                  );
                }}
              >
                <p className="modal-description">
                  {t('Set the pull and push target for {0}.', dialog.branch?.name ?? '')}
                </p>
                <div className="form-label">
                  <span>{t('Upstream branch')}</span>
                  <SelectMenu
                    ariaLabel={t('Upstream branch')}
                    value={dialogValue}
                    menuMinWidth={240}
                    onChange={setDialogValue}
                    options={[
                      { value: '', label: t('Do not track an upstream') },
                      ...(snapshot?.branches ?? [])
                        .filter((branch) => branch.remote)
                        .map((branch) => ({ value: branch.name, label: branch.name })),
                    ]}
                  />
                </div>
                <div className="modal-footer">
                  <button className="button" type="button" onClick={() => setDialog(null)}>
                    {t('Cancel')}
                  </button>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={isBusy || (!dialogValue && !dialog.branch?.upstream)}
                  >
                    {t('Save')}
                  </button>
                </div>
              </form>
            ) : dialog.type === 'help' ? (
              <div className="help-content">
                <p>
                  {t(
                    'Bring your everyday IDEA workflow and Git operations together in one workbench. Drag pane boundaries to resize and double-click to reset; you can also focus a boundary and use the left and right arrow keys. Drag a dialog title bar to move it, drag its edges to resize, and double-click the title bar to reset.',
                  )}
                </p>
                <ol>
                  <li>
                    <b>{t('Select changes')}</b>
                    <span>
                      {t('Check files or an entire changelist; select a file to view a side-by-side diff.')}
                    </span>
                  </li>
                  <li>
                    <b>{t('Review and commit')}</b>
                    <span>
                      {t(
                        'Write a commit message and click Commit or Commit & Push. The commit includes all changes in the checked files.',
                      )}
                    </span>
                  </li>
                  <li>
                    <b>{t('Manage branches and history')}</b>
                    <span>
                      {t(
                        'Click a branch to filter history; right-click for checkout, compare, merge, rebase, and more; double-click to check out.',
                      )}
                    </span>
                  </li>
                  <li>
                    <b>{t('Stash and resolve conflicts')}</b>
                    <span>
                      {t(
                        "Use Stash to save all local progress; resolve conflict files in VS Code's three-way merge editor.",
                      )}
                    </span>
                  </li>
                </ol>
                <div className="shortcut-row">
                  <span>{t('Commit / Commit & Push')}</span>
                  <kbd>⌘ / Ctrl + Enter</kbd>
                  <kbd>+ Shift</kbd>
                </div>
                <div className="shortcut-row">
                  <span>{t('Open commit window')}</span>
                  <kbd>⌘ / Ctrl + Alt + K</kbd>
                </div>
                <div className="shortcut-row">
                  <span>{t('Refresh / Close dialog')}</span>
                  <kbd>⌘ / Ctrl + R</kbd>
                  <kbd>Esc</kbd>
                </div>
                {isPreview && (
                  <p className="preview-note">
                    {t(
                      'This is a sample data preview. After installing the VSIX, the extension connects to the real Git repository you open in VS Code.',
                    )}
                  </p>
                )}
                <button className="button primary full-width" onClick={() => setDialog(null)}>
                  {t('Get Started')}
                </button>
              </div>
            ) : dialog.type === 'push' ? (
              <>
                <p className="modal-description">
                  {t('Push local commits from the current branch to the remote repository.')}
                </p>
                <div className="push-route">
                  <div>
                    <GitBranch size={16} />
                    <span>
                      <small>{t('Local branch')}</small>
                      <strong>{snapshot?.branch}</strong>
                    </span>
                  </div>
                  <ArrowUp size={20} />
                  <div>
                    <Box size={16} />
                    <span>
                      <small>{t('Remote branch')}</small>
                      <strong>
                        {pushPreview
                          ? pushPreview.remote
                            ? `${pushPreview.remote}/${pushPreview.target}`
                            : t('Configure a remote or upstream first')
                          : snapshot?.upstream || t('Checking push target…')}
                      </strong>
                    </span>
                  </div>
                </div>
                <div className="push-summary">
                  <ShieldCheck size={16} />
                  <span>
                    {pushPreview
                      ? t(
                          'Commits to push: {0}. {1}',
                          pushPreview.total,
                          snapshot?.upstream ? '' : t('The first push will set the upstream.'),
                        )
                      : t('Reading commits to push…')}
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
                      <small>
                        {t('Only the latest 100 commits are previewed; {0} total.', pushPreview.total)}
                      </small>
                    )}
                    {!pushPreview.total && <small>{t('The local branch is already up to date.')}</small>}
                  </div>
                )}
                {!!snapshot?.behind && (
                  <p className="modal-warning">
                    {t(
                      'The branch is {0} commits behind its upstream. Pull before pushing.',
                      snapshot.behind,
                    )}
                  </p>
                )}
                <div className="modal-footer">
                  <span className="muted">{t('Uses a standard push and preserves remote history.')}</span>
                  <div className="spacer" />
                  <button className="button" disabled={isBusy} onClick={() => setDialog(null)}>
                    {t('Cancel')}
                  </button>
                  <button
                    className="button primary"
                    disabled={isBusy || !pushPreview?.remote || !!snapshot?.behind}
                    onClick={() => void perform('push', {}, t('Push'), () => setDialog(null))}
                  >
                    {isBusy ? <LoaderCircle size={14} className="spin" /> : <ArrowUpFromLine size={14} />}
                    {t('Push')}
                  </button>
                </div>
              </>
            ) : dialog.type === 'move' ? (
              <>
                <p className="modal-description">
                  {t(
                    'Move the {0} selected files into a changelist.',
                    (dialog.paths ?? selectedFiles).length,
                  )}
                </p>
                <div className="move-options">
                  {[{ id: '', name: t('Default Changelist') }, ...(snapshot?.changelists || [])].map(
                    (list) => (
                      <button
                        className="button"
                        disabled={isBusy}
                        key={list.id}
                        onClick={() =>
                          void perform(
                            'changelist',
                            { action: 'move', id: list.id, paths: dialog.paths ?? selectedFiles },
                            t('Move Files'),
                            () => setDialog(null),
                          )
                        }
                      >
                        <FolderClosed size={15} />
                        {list.name}
                        <ChevronRight size={14} />
                      </button>
                    ),
                  )}
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
                      t('Create Branch'),
                      () => setDialog(null),
                    );
                  if (dialog.type === 'renameBranch')
                    void perform(
                      'renameBranch',
                      { branch: dialog.branch!.name, name: dialogValue.trim() },
                      t('Rename Branch'),
                      () => setDialog(null),
                    );
                  if (dialog.type === 'changelist')
                    void perform(
                      'changelist',
                      { action: 'create', name: dialogValue.trim() },
                      t('Create Changelist'),
                      () => setDialog(null),
                    );
                  if (dialog.type === 'stash')
                    void perform('stash', { message: dialogValue.trim() }, t('Stash Changes'), () =>
                      setDialog(null),
                    );
                }}
              >
                <p className="modal-description">
                  {dialog.type === 'newBranch'
                    ? t(
                        'Create a branch from {0} and switch to it automatically.',
                        dialog.branch?.name || t('current HEAD'),
                      )
                    : dialog.type === 'renameBranch'
                      ? t(
                          'Rename the local branch {0}. The remote branch name stays unchanged.',
                          dialog.branch?.name ?? '',
                        )
                      : dialog.type === 'changelist'
                        ? t('Organize changes by task and review and commit them separately.')
                        : t(
                            'Save all {0} local changes (including untracked files), then clean the working tree.',
                            changes.length,
                          )}
                </p>
                <label className="form-label">
                  {dialog.type === 'newBranch' || dialog.type === 'renameBranch'
                    ? t('Branch name')
                    : dialog.type === 'changelist'
                      ? t('Changelist name')
                      : t('Stash message (optional)')}
                  <input
                    autoFocus
                    aria-label={
                      dialog.type === 'newBranch' || dialog.type === 'renameBranch'
                        ? t('Branch name')
                        : dialog.type === 'changelist'
                          ? t('Changelist name')
                          : t('Stash message (optional)')
                    }
                    placeholder={
                      dialog.type === 'newBranch' || dialog.type === 'renameBranch'
                        ? 'feature/my-next-idea'
                        : dialog.type === 'changelist'
                          ? t('e.g. Login feature')
                          : t('WIP: save current progress…')
                    }
                    value={dialogValue}
                    onChange={(event) => setDialogValue(event.target.value)}
                    maxLength={dialog.type === 'changelist' ? 80 : 240}
                    disabled={isBusy}
                  />
                </label>
                <div className="modal-footer">
                  <button className="button" type="button" disabled={isBusy} onClick={() => setDialog(null)}>
                    {t('Cancel')}
                  </button>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={isBusy || (dialog.type !== 'stash' && !dialogValue.trim())}
                  >
                    {isBusy && <LoaderCircle size={14} className="spin" />}
                    {dialog.type === 'stash'
                      ? t('Stash Changes')
                      : dialog.type === 'renameBranch'
                        ? t('Rename')
                        : t('Create')}
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
