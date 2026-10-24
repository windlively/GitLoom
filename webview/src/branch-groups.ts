import type { Branch } from '../../src/shared/types';

export interface BranchEntry {
  branch: Branch;
  label: string;
}
export interface BranchFolder {
  kind: 'folder';
  name: string;
  path: string;
  count: number;
  folders: BranchFolder[];
  branches: BranchEntry[];
}
export type BranchListEntry = ({ kind: 'branch' } & BranchEntry) | BranchFolder;

const compare = (a: string, b: string) => {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
};

const relativeName = (branch: Branch, remotes: string[]) => {
  if (!branch.remote) return branch.name;
  const remote = remotes
    .filter((name) => name && branch.name.startsWith(`${name}/`))
    .sort((a, b) => b.length - a.length)[0];
  return remote ? branch.name.slice(remote.length + 1) : branch.name;
};

function sortFolder(folder: BranchFolder) {
  folder.folders.sort((a, b) => compare(a.name, b.name));
  folder.branches.sort((a, b) => compare(a.label, b.label));
  folder.folders.forEach(sortFolder);
}

function countFolder(folder: BranchFolder): number {
  folder.count = folder.branches.length + folder.folders.reduce((sum, child) => sum + countFolder(child), 0);
  return folder.count;
}

// IDEA keeps the checked-out branch at the top of the local list; everything else keeps
// the order it arrived in (the host sorts branches by name).
export function currentFirst<T extends { current: boolean }>(branches: T[]): T[] {
  return [...branches].sort((a, b) => Number(b.current) - Number(a.current));
}

export function groupBranches(branches: Branch[], remotes: string[] = []): BranchListEntry[] {
  const root: BranchFolder = {
    kind: 'folder',
    name: '',
    path: '',
    count: 0,
    folders: [],
    branches: [],
  };
  for (const branch of branches) {
    const segments = relativeName(branch, remotes).split('/').filter(Boolean);
    const label = segments.pop();
    if (!label) continue;
    let node = root;
    const path: string[] = [];
    for (const segment of segments) {
      path.push(segment);
      let child = node.folders.find((folder) => folder.name === segment);
      if (!child) {
        child = {
          kind: 'folder',
          name: segment,
          path: path.join('/'),
          count: 0,
          folders: [],
          branches: [],
        };
        node.folders.push(child);
      }
      node = child;
    }
    node.branches.push({ branch, label });
  }
  sortFolder(root);
  countFolder(root);
  return [...root.folders, ...root.branches.map((entry) => ({ kind: 'branch' as const, ...entry }))];
}
