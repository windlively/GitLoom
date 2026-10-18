import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from './i18n';

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  run: () => void;
}
export function ContextMenu({
  x,
  y,
  title,
  label,
  actions,
  close,
  onSelect,
  onCancel,
}: {
  x: number;
  y: number;
  title: string;
  label?: string;
  actions: MenuAction[];
  close: () => void;
  onSelect?: () => void;
  onCancel?: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const element = menu.current!;
    const previous = document.activeElement as HTMLElement | null;
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close();
    };
    const resize = () => close();
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('resize', resize);
      if (document.activeElement === document.body || element.contains(document.activeElement))
        previous?.focus();
    };
  }, [x, y, close]);
  return (
    <div
      ref={menu}
      className="branch-context-menu"
      role="menu"
      aria-label={label || t('Actions for branch {0}', title)}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          close();
          onCancel?.();
          return;
        }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      <div className="context-menu-caption" title={title}>
        {title}
      </div>
      {actions.map((action) => (
        <div key={action.label}>
          {action.separator && <div role="separator" className="menu-rule" />}
          <button
            role="menuitem"
            disabled={action.disabled}
            className={action.danger ? 'danger' : ''}
            onClick={() => {
              close();
              onSelect?.();
              action.run();
            }}
          >
            {action.icon || <span className="menu-icon-placeholder" />}
            <span>{action.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
