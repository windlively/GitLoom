export interface Change {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';
  additions: number;
  deletions: number;
}
export interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string;
  subject: string;
}
export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string[];
}
export interface Stash {
  ref: string;
  hash: string;
  subject: string;
  date: string;
}
export interface Changelist {
  id: string;
  name: string;
  paths: string[];
}
export interface Repository {
  path: string;
  name: string;
}
export interface Snapshot {
  repositories: Repository[];
  repository: Repository | null;
  branch: string;
  detached: boolean;
  upstream: string;
  ahead: number;
  behind: number;
  changes: Change[];
  branches: Branch[];
  commits: Commit[];
  stashes: Stash[];
  remotes: string[];
  changelists: Changelist[];
  merging: boolean;
  rebasing: boolean;
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;
  updatedAt: number;
}
export interface FileDiff {
  path: string;
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  binary: boolean;
  truncated: boolean;
}
export interface CommitDetail {
  commit: Commit;
  message: string;
  files: Change[];
}
export interface BranchComparison {
  branch: string;
  base: string;
  head: string;
  ahead: number;
  behind: number;
  files: Change[];
}
export interface PushPreview {
  branch: string;
  remote: string;
  target: string;
  total: number;
  commits: Commit[];
}
export interface Activity {
  id: string;
  time: number;
  command: string;
  output: string;
  error: boolean;
}
export interface Requests {
  snapshot: { params: { repository?: string }; result: Snapshot };
  diff: { params: { path: string; commit?: string; stash?: string }; result: FileDiff };
  commitDetail: { params: { hash: string }; result: CommitDetail };
  commit: {
    params: { paths: string[]; message: string; push?: boolean };
    result: { output: string; pushError?: string };
  };
  stage: { params: { paths: string[] }; result: string };
  fetch: { params: Record<string, never>; result: string };
  pull: { params: Record<string, never>; result: string };
  push: { params: Record<string, never>; result: string };
  outgoing: { params: Record<string, never>; result: PushPreview };
  checkout: { params: { branch: string; remote?: boolean }; result: string };
  createBranch: { params: { name: string; source?: string; remote?: boolean }; result: string };
  deleteBranch: { params: { name: string; remote?: boolean }; result: string };
  merge: { params: { branch: string; remote?: boolean }; result: string };
  rebase: { params: { branch: string; remote?: boolean }; result: string };
  renameBranch: { params: { branch: string; name: string }; result: string };
  setUpstream: { params: { branch: string; upstream?: string }; result: string };
  copyBranch: { params: { branch: string; remote?: boolean }; result: void };
  compareBranch: { params: { branch: string; remote?: boolean }; result: BranchComparison };
  openBranchDiff: { params: { path: string; base: string; head: string }; result: void };
  stash: { params: { message: string }; result: string };
  stashApply: { params: { ref: string; pop?: boolean }; result: string };
  stashDrop: { params: { ref: string }; result: string };
  stashFiles: { params: { ref: string }; result: Change[] };
  discard: { params: { paths: string[] }; result: string };
  markResolved: { params: { path: string }; result: string };
  resolve: { params: { path: string }; result: void };
  openFile: { params: { path: string }; result: void };
  openDiff: { params: { path: string; commit?: string }; result: void };
  pickRepository: { params: Record<string, never>; result: void };
  changelist: {
    params: { action: 'create' | 'move' | 'delete'; id?: string; name?: string; paths?: string[] };
    result: void;
  };
  cherryPick: { params: { hash: string }; result: string };
  revert: { params: { hash: string }; result: string };
  reset: { params: { hash: string }; result: string };
  continueOperation: { params: Record<string, never>; result: string };
  abortOperation: { params: Record<string, never>; result: string };
}
export type Method = keyof Requests;
export type View = 'changes' | 'log' | 'stash';
