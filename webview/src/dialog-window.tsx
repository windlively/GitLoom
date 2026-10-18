import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

export type DialogFrame = { x: number; y: number; width: number; height: number };
export type DialogFrames = Record<string, DialogFrame>;

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Mode = 'move' | Edge;
type Bounds = { width: number; height: number };

const EDGE_GAP = 8;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;
const edges: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const cursors: Record<Mode, string> = {
  move: 'grabbing',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

const isFrame = (value: unknown): value is DialogFrame => {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<DialogFrame>;
  return [frame.x, frame.y, frame.width, frame.height].every(
    (part) => typeof part === 'number' && Number.isFinite(part),
  );
};

export function restoreDialogFrames(value: unknown): DialogFrames {
  if (!value || typeof value !== 'object') return {};
  const frames: DialogFrames = {};
  for (const [type, frame] of Object.entries(value)) {
    if (isFrame(frame)) frames[type] = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  }
  return frames;
}

const sameFrame = (left: DialogFrame, right: DialogFrame) =>
  left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;

const measureBounds = (element: HTMLElement): Bounds => {
  const rect = element.parentElement?.getBoundingClientRect();
  return {
    width: Math.max(1, rect?.width || window.innerWidth),
    height: Math.max(1, rect?.height || window.innerHeight),
  };
};

const fitFrame = (frame: DialogFrame, bounds: Bounds): DialogFrame => {
  const maxWidth = Math.max(1, bounds.width - EDGE_GAP * 2);
  const maxHeight = Math.max(1, bounds.height - EDGE_GAP * 2);
  const width = Math.min(maxWidth, Math.max(Math.min(MIN_WIDTH, maxWidth), frame.width));
  const height = Math.min(maxHeight, Math.max(Math.min(MIN_HEIGHT, maxHeight), frame.height));
  return {
    x: Math.max(0, clamp(frame.x, EDGE_GAP, bounds.width - width - EDGE_GAP)),
    y: Math.max(0, clamp(frame.y, EDGE_GAP, bounds.height - height - EDGE_GAP)),
    width,
    height,
  };
};

const resizeFrame = (start: DialogFrame, edge: Edge, dx: number, dy: number, bounds: Bounds) => {
  let { x, y, width, height } = start;
  if (edge.includes('e')) width = Math.min(start.width + dx, bounds.width - EDGE_GAP - start.x);
  if (edge.includes('s')) height = Math.min(start.height + dy, bounds.height - EDGE_GAP - start.y);
  if (edge.includes('w')) {
    x = Math.max(EDGE_GAP, start.x + dx);
    width = start.x + start.width - x;
  }
  if (edge.includes('n')) {
    y = Math.max(EDGE_GAP, start.y + dy);
    height = start.y + start.height - y;
  }
  const minWidth = Math.min(MIN_WIDTH, Math.max(1, bounds.width - EDGE_GAP * 2));
  const minHeight = Math.min(MIN_HEIGHT, Math.max(1, bounds.height - EDGE_GAP * 2));
  if (width < minWidth) {
    if (edge.includes('w')) x = start.x + start.width - minWidth;
    width = minWidth;
  }
  if (height < minHeight) {
    if (edge.includes('n')) y = start.y + start.height - minHeight;
    height = minHeight;
  }
  return { x, y, width, height };
};

export function DialogWindow({
  savedFrame,
  onFrameChange,
  defaultWidth = 480,
  className = '',
  titleId,
  children,
}: {
  savedFrame?: DialogFrame;
  onFrameChange?: (frame: DialogFrame | undefined) => void;
  defaultWidth?: number;
  className?: string;
  titleId?: string;
  children: ReactNode;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<DialogFrame | null>(savedFrame ?? null);
  const frameRef = useRef<DialogFrame | null>(frame);
  const session = useRef<(() => void) | null>(null);
  const onFrameChangeRef = useRef(onFrameChange);
  onFrameChangeRef.current = onFrameChange;

  useLayoutEffect(() => {
    const element = shell.current;
    if (!element) return;
    const update = () => {
      setFrame((current) => {
        if (!current) return current;
        const fitted = fitFrame(current, measureBounds(element));
        frameRef.current = fitted;
        return sameFrame(current, fitted) ? current : fitted;
      });
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (element.parentElement) observer?.observe(element.parentElement);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => () => session.current?.(), []);

  const applyFrame = (next: DialogFrame) => {
    const fitted = fitFrame(next, measureBounds(shell.current!));
    frameRef.current = fitted;
    setFrame(fitted);
  };

  const startSession = (event: ReactPointerEvent<HTMLElement>, mode: Mode) => {
    const element = shell.current;
    const backdrop = element?.parentElement;
    if (event.button !== 0 || !element || !backdrop) return;
    event.preventDefault();
    event.stopPropagation();
    session.current?.();

    const shellRect = element.getBoundingClientRect();
    const boundsRect = backdrop.getBoundingClientRect();
    const bounds = { width: boundsRect.width, height: boundsRect.height };
    const start = fitFrame(
      {
        x: shellRect.left - boundsRect.left,
        y: shellRect.top - boundsRect.top,
        width: shellRect.width,
        height: shellRect.height,
      },
      bounds,
    );
    const origin = { x: event.clientX, y: event.clientY };
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    let active = false;
    let finished = false;

    document.body.style.cursor = cursors[mode];
    document.body.style.userSelect = 'none';

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - origin.x;
      const dy = moveEvent.clientY - origin.y;
      if (!active && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      active = true;
      applyFrame(
        mode === 'move'
          ? { ...start, x: start.x + dx, y: start.y + dy }
          : resizeFrame(start, mode, dx, dy, bounds),
      );
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      session.current = null;
      cleanup();
      if (active && frameRef.current) onFrameChangeRef.current?.(frameRef.current);
    };

    session.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const resetFrame = () => {
    if (!frameRef.current) return;
    frameRef.current = null;
    setFrame(null);
    onFrameChangeRef.current?.(undefined);
  };

  const interactive = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest('button, input, select, textarea, a, [role="button"]');

  return (
    <div
      ref={shell}
      className={`dialog-shell${frame ? ' framed' : ''}`}
      style={
        (frame
          ? { left: frame.x, top: frame.y, width: frame.width, height: frame.height }
          : { width: defaultWidth }) satisfies CSSProperties
      }
    >
      <section
        className={`modal${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(event) => {
          if (interactive(event.target) || !(event.target instanceof Element)) return;
          if (event.target.closest('.modal-header')) startSession(event, 'move');
        }}
        onDoubleClick={(event) => {
          if (interactive(event.target)) return;
          if (event.target instanceof Element && event.target.closest('.modal-header')) resetFrame();
        }}
      >
        {children}
      </section>
      {edges.map((edge) => (
        <div
          key={edge}
          aria-hidden="true"
          className={`dialog-resize ${edge}`}
          onPointerDown={(event) => startSession(event, edge)}
        />
      ))}
    </div>
  );
}
