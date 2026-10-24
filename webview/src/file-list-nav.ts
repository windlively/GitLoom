export type FileListKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

const KEYS: readonly string[] = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

export function isFileListKey(key: string): key is FileListKey {
  return KEYS.includes(key);
}

// Indexes stay logical: the change list renders only a window of rows, so callers
// must keep the full file order instead of the buttons currently in the DOM.
export function nextRowIndex(key: FileListKey, current: number, count: number): number {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (current < 0) return key === 'ArrowUp' ? count - 1 : 0;
  return Math.max(0, Math.min(count - 1, current + (key === 'ArrowDown' ? 1 : -1)));
}

export function rowIndex(rows: Element[], active: Element | null): number {
  if (!active) return -1;
  return rows.findIndex((row) => row === active || row.contains(active));
}
