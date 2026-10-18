import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { Branch } from '../../src/shared/types';
import { ChevronRight, GitBranch, Plus, Search } from './icons';

type Placement = { left: number; top: number; width: number; maxHeight: number };

export function BranchDropdown({
  anchor,
  branches,
  activeBranch,
  onBranch,
  onBranchHover,
  onDismissSubmenu,
  onNewBranch,
  newBranchDisabled = false,
  close,
}: {
  anchor: HTMLElement;
  branches: Branch[];
  activeBranch?: Branch | null;
  onBranch: (branch: Branch, x: number, y: number) => void;
  onBranchHover: (branch: Branch, x: number, y: number) => void;
  onDismissSubmenu: () => void;
  onNewBranch: () => void;
  newBranchDisabled?: boolean;
  close: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const [query, setQuery] = useState('');
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const element = panel.current!;
    const anchorRect = anchor.getBoundingClientRect();
    const viewportWidth = Math.max(1, window.innerWidth - 8);
    const width = Math.min(Math.max(anchorRect.width, 320), viewportWidth);
    const left = Math.max(4, Math.min(anchorRect.left, window.innerWidth - width - 4));
    const top = anchorRect.bottom + 4;
    const maxHeight = Math.max(80, window.innerHeight - top - 8);
    setPlacement({ left, top, width, maxHeight });

    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      const submenu = target instanceof Element && target.closest('.branch-context-menu');
      if (element.contains(target) || anchor.contains(target) || submenu) return;
      closeRef.current();
    };
    const resize = () => closeRef.current();
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('resize', resize);
      if (document.activeElement === document.body || element.contains(document.activeElement))
        anchor.focus();
    };
  }, [anchor]);

  useLayoutEffect(() => {
    if (placement) search.current?.focus();
  }, [placement]);

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  const cancelHover = () => {
    if (!hoverTimer.current) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  const scheduleHover = (branch: Branch, button: HTMLButtonElement) => {
    cancelHover();
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      if (!button.isConnected) return;
      const rect = button.getBoundingClientRect();
      onBranchHover(branch, rect.right + 2, rect.top);
    }, 120);
  };

  const matches = branches.filter((branch) => branch.name.toLowerCase().includes(query.toLowerCase()));
  const groups = [
    { label: '本地分支', items: matches.filter((branch) => !branch.remote) },
    { label: '远程分支', items: matches.filter((branch) => branch.remote) },
  ];
  const isActive = (branch: Branch) =>
    !!activeBranch && activeBranch.name === branch.name && activeBranch.remote === branch.remote;

  const moveFocus = (event: ReactKeyboardEvent, delta: number) => {
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('.branch-dropdown-name') || [])];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      index < 0 ? (delta > 0 ? 0 : buttons.length - 1) : (index + delta + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.target === search.current && event.key === 'ArrowUp') return;
    moveFocus(event, event.key === 'ArrowDown' ? 1 : -1);
  };

  return (
    <div
      ref={panel}
      className="branch-dropdown"
      role="dialog"
      aria-label="选择分支"
      style={{
        left: placement?.left ?? 4,
        top: placement?.top ?? 0,
        width: placement?.width ?? 320,
        maxHeight: placement?.maxHeight,
        visibility: placement ? 'visible' : 'hidden',
      }}
      onKeyDown={onKeyDown}
    >
      <label className="search-box">
        <Search size={14} />
        <input
          ref={search}
          aria-label="查找分支"
          placeholder="查找分支…"
          value={query}
          onChange={(event) => {
            onDismissSubmenu();
            setQuery(event.target.value);
          }}
        />
      </label>
      <div className="branch-dropdown-list" onScroll={onDismissSubmenu}>
        {groups.map((group) =>
          group.items.length ? (
            <div key={group.label}>
              <div className="branch-dropdown-heading">{group.label}</div>
              {group.items.map((branch) => (
                <div
                  className="branch-dropdown-row"
                  key={`${branch.remote}-${branch.name}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    cancelHover();
                    onDismissSubmenu();
                    onBranch(branch, event.clientX, event.clientY);
                  }}
                >
                  <button
                    className={`branch-dropdown-name${isActive(branch) ? ' active' : ''}`}
                    title={`${branch.name}\n${branch.subject}`}
                    onPointerEnter={(event) => scheduleHover(branch, event.currentTarget)}
                    onPointerLeave={cancelHover}
                    onClick={(event) => {
                      cancelHover();
                      const rect = event.currentTarget.getBoundingClientRect();
                      onBranch(branch, rect.right + 2, rect.top);
                    }}
                  >
                    <GitBranch size={14} />
                    <span className="branch-dropdown-text">
                      <strong>{branch.name}</strong>
                      <small>{branch.upstream || branch.subject}</small>
                    </span>
                    {branch.current && <span className="tag">当前</span>}
                    <ChevronRight size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null,
        )}
        {!matches.length && <p className="sidebar-empty">没有匹配的分支</p>}
      </div>
      <div className="branch-dropdown-footer">
        <button
          className="button"
          disabled={newBranchDisabled}
          title={newBranchDisabled ? '请先完成当前 Git 操作' : undefined}
          onClick={onNewBranch}
        >
          <Plus size={14} />
          新建分支
        </button>
        <span className="muted">悬停分支查看操作</span>
      </div>
    </div>
  );
}
