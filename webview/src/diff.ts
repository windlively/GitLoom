import { diffLines } from 'diff';
import { t } from './i18n';
export interface DiffRow {
  left: string;
  right: string;
  leftNumber?: number;
  rightNumber?: number;
  type: 'same' | 'change' | 'gap';
}
export function makeDiffRows(before: string, after: string, contextOnly = false): DiffRow[] {
  const chunks = diffLines(before, after, { timeout: 1000 });
  if (!chunks) throw new Error(t('Diff calculation timed out. Use the native VS Code diff editor.'));
  const rows: DiffRow[] = [];
  let left = 1,
    right = 1;
  const lines = (text: string) => {
    const values = text.split('\n');
    if (values.at(-1) === '') values.pop();
    return values;
  };
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.added && !chunk.removed) {
      for (const value of lines(chunk.value))
        rows.push({ left: value, right: value, leftNumber: left++, rightNumber: right++, type: 'same' });
    } else {
      const removed = chunk.removed ? lines(chunk.value) : [];
      let added = chunk.added ? lines(chunk.value) : [];
      if (chunk.removed && chunks[i + 1]?.added) added = lines(chunks[++i].value);
      for (let j = 0; j < Math.max(removed.length, added.length); j++)
        rows.push({
          left: removed[j] ?? '',
          right: added[j] ?? '',
          leftNumber: j < removed.length ? left++ : undefined,
          rightNumber: j < added.length ? right++ : undefined,
          type: 'change',
        });
    }
  }
  if (!contextOnly) return rows;
  return rows
    .filter(
      (row, i) =>
        row.type === 'change' ||
        rows.slice(Math.max(0, i - 3), i + 4).some((item) => item.type === 'change') ||
        i === 0,
    )
    .flatMap((row, i, filtered) =>
      i && row.leftNumber && filtered[i - 1].leftNumber && row.leftNumber - filtered[i - 1].leftNumber! > 1
        ? [{ left: '···', right: '···', type: 'gap' as const }, row]
        : [row],
    );
}
