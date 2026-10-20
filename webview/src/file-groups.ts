import type { Change } from '../../src/shared/types';

export interface FileEntry {
  kind: 'file';
  change: Change;
  label: string;
}
export interface FileFolder {
  kind: 'folder';
  name: string;
  path: string;
  count: number;
  folders: FileFolder[];
  files: FileEntry[];
}
export type FileListEntry = FileFolder | FileEntry;

const compare = (a: string, b: string) => {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
};

const folder = (name: string, path: string): FileFolder => ({
  kind: 'folder',
  name,
  path,
  count: 0,
  folders: [],
  files: [],
});

function simplify(node: FileFolder) {
  node.folders = node.folders.map((child) => {
    let merged = child;
    while (merged.files.length === 0 && merged.folders.length === 1) {
      const only = merged.folders[0];
      merged = { ...only, name: `${merged.name}/${only.name}` };
    }
    simplify(merged);
    return merged;
  });
}

function sort(node: FileFolder) {
  node.folders.sort((a, b) => compare(a.name, b.name));
  node.files.sort((a, b) => compare(a.label, b.label));
  node.folders.forEach(sort);
}

function count(node: FileFolder): number {
  node.count = node.files.length + node.folders.reduce((sum, child) => sum + count(child), 0);
  return node.count;
}

export function groupFiles(files: Change[]): FileListEntry[] {
  const root = folder('', '');
  for (const change of files) {
    const segments = change.path.split('/').filter(Boolean);
    const label = segments.pop();
    if (!label) continue;
    let node = root;
    const path: string[] = [];
    for (const segment of segments) {
      path.push(segment);
      let child = node.folders.find((item) => item.name === segment);
      if (!child) {
        child = folder(segment, path.join('/'));
        node.folders.push(child);
      }
      node = child;
    }
    node.files.push({ kind: 'file', change, label });
  }
  simplify(root);
  sort(root);
  count(root);
  return [...root.folders, ...root.files];
}
