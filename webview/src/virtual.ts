import { useEffect, useState } from 'react';

const OVERSCAN = 12;
// Before the first layout measurement, render enough rows to fill a tall panel.
const FALLBACK_HEIGHT = 1200;

export function useViewport() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  useEffect(() => {
    if (!element) return;
    // Scroll events are already frame-aligned; updating synchronously avoids a blank frame while scrolling.
    const update = () =>
      setViewport((previous) =>
        previous.top === element.scrollTop && previous.height === element.clientHeight
          ? previous
          : { top: element.scrollTop, height: element.clientHeight },
      );
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [element]);
  return { ref: setElement, ...viewport };
}

type Viewport = { top: number; height: number };

export function uniformRange(count: number, rowHeight: number, { top, height }: Viewport) {
  const start = Math.min(count, Math.max(0, Math.floor(top / rowHeight) - OVERSCAN));
  const end = Math.min(count, Math.ceil((top + (height || FALLBACK_HEIGHT)) / rowHeight) + OVERSCAN);
  return [start, Math.max(start, end)] as const;
}

// offsets has one entry per item plus the total height; offsets[i] is the top of item i.
export function offsetRange(offsets: number[], { top, height }: Viewport) {
  const count = offsets.length - 1;
  const itemAt = (y: number) => {
    let low = 0,
      high = count - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (offsets[middle] <= y) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  if (count <= 0) return [0, 0] as const;
  const start = Math.max(0, itemAt(top) - OVERSCAN);
  const end = Math.min(count, itemAt(top + (height || FALLBACK_HEIGHT)) + 1 + OVERSCAN);
  return [start, end] as const;
}
