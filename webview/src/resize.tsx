import { useRef, type CSSProperties } from 'react';

export const defaultSizes = { sidebar: 180, files: 245, commit: 260, detail: 260, stash: 285, diff: 50 };
export type PaneSizes = typeof defaultSizes;
export function restoreSizes(value?: Partial<PaneSizes>): PaneSizes {
  return Object.fromEntries(
    Object.entries(defaultSizes).map(([key, fallback]) => {
      const size = value?.[key as keyof PaneSizes];
      return [
        key,
        typeof size === 'number' && Number.isFinite(size)
          ? Math.max(key === 'diff' ? 20 : 140, Math.min(key === 'diff' ? 80 : 800, size))
          : fallback,
      ];
    }),
  ) as PaneSizes;
}

export function ResizeHandle({
  label,
  target,
  value,
  onChange,
  reset,
  side = 'left',
  percent = false,
  min = 140,
  reserve = 200,
  reserveExtra = 160,
  style,
  className = '',
}: {
  label: string;
  target: string;
  value: number;
  onChange: (value: number) => void;
  reset: number;
  side?: 'left' | 'right';
  percent?: boolean;
  min?: number;
  reserve?: number | string;
  reserveExtra?: number;
  style: CSSProperties;
  className?: string;
}) {
  const drag = useRef<{ x: number; size: number; width: number; max: number } | null>(null);
  const constrain = (size: number, width: number, max: number) =>
    percent
      ? Math.max(20, Math.min(80, (size / width) * 100))
      : Math.max(min, Math.min(Math.max(min, max), size));
  const measure = (element: HTMLElement) => {
    const parent = element.parentElement!;
    const pane = parent.querySelector<HTMLElement>(target)!;
    const width = parent.clientWidth;
    return {
      size: pane.getBoundingClientRect().width,
      width,
      max:
        width -
        (typeof reserve === 'string'
          ? (parent.querySelector<HTMLElement>(reserve)?.getBoundingClientRect().width || 180) + reserveExtra
          : reserve),
    };
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={percent ? 20 : min}
      aria-valuemax={percent ? 80 : 800}
      className={`resize-handle ${className}`}
      style={style}
      onDoubleClick={() => onChange(reset)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { x: event.clientX, ...measure(event.currentTarget) };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add('dragging');
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start)
          onChange(
            constrain(
              start.size + (event.clientX - start.x) * (side === 'right' ? -1 : 1),
              start.width,
              start.max,
            ),
          );
      }}
      onLostPointerCapture={(event) => {
        drag.current = null;
        event.currentTarget.classList.remove('dragging');
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Home' || event.key === 'Enter') {
          event.preventDefault();
          onChange(reset);
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const current = measure(event.currentTarget);
        onChange(
          constrain(
            current.size +
              (event.key === 'ArrowRight' ? 1 : -1) *
                (side === 'right' ? -1 : 1) *
                (event.shiftKey ? 40 : 10),
            current.width,
            current.max,
          ),
        );
      }}
    />
  );
}
