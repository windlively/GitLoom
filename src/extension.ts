import * as vscode from 'vscode';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { GitService } from './git/service';
import { normalizeLocale, translate, type Locale } from './shared/i18n';
import type { Activity, Changelist, Method, Repository, Requests, Snapshot, View } from './shared/types';

const METHODS: Method[] = [
  'snapshot',
  'diff',
  'commitDetail',
  'commit',
  'stage',
  'fetch',
  'pull',
  'push',
  'outgoing',
  'checkout',
  'createBranch',
  'deleteBranch',
  'merge',
  'rebase',
  'renameBranch',
  'setUpstream',
  'copyBranch',
  'compareBranch',
  'openBranchDiff',
  'stash',
  'stashApply',
  'stashDrop',
  'stashFiles',
  'discard',
  'markResolved',
  'resolve',
  'openFile',
  'openDiff',
  'pickRepository',
  'changelist',
  'cherryPick',
  'revert',
  'reset',
  'continueOperation',
  'abortOperation',
];
const READ_ONLY = new Set<Method>([
  'snapshot',
  'diff',
  'commitDetail',
  'outgoing',
  'copyBranch',
  'compareBranch',
  'openBranchDiff',
  'stashFiles',
  'openFile',
  'openDiff',
  'resolve',
  'pickRepository',
]);
export const WORKBENCH_VIEW_ID = 'gitWorkbench.workbench';
// Windows kept open across an extension update can lack the generated view focus command.
const WORKBENCH_CONTAINER_COMMAND = 'workbench.view.extension.gitWorkbench';
const fingerprint = (state: Snapshot) => JSON.stringify({ ...state, updatedAt: 0 });

export async function activate(context: vscode.ExtensionContext) {
  const workbench = new Workbench(context);
  context.subscriptions.push(workbench);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WORKBENCH_VIEW_ID, workbench, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  for (const [command, view] of [
    ['open', 'changes'],
    ['commit', 'changes'],
    ['log', 'log'],
  ] as const) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`gitWorkbench.${command}`, () => workbench.open(view)),
    );
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('gitWorkbench.push', async () => {
      await workbench.open('changes', true);
    }),
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  status.text = '$(git-branch) GitLoom';
  status.tooltip = workbench.t('Open the IDEA-style Git workbench');
  status.command = 'gitWorkbench.open';
  if (vscode.workspace.workspaceFolders?.length) status.show();
  context.subscriptions.push(status);
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('gitWorkbench', {
      deserializeWebviewPanel: async (legacyPanel) => {
        // Migrate editor tabs restored from 0.1.0 into the native bottom panel.
        legacyPanel.dispose();
        await workbench.open('changes');
      },
    }),
  );
  return { workbench };
}

export class Workbench implements vscode.WebviewViewProvider, vscode.Disposable {
  private panel?: vscode.WebviewView;
  private requestedView: View = 'changes';
  private pendingView?: View;
  private viewDisposables: vscode.Disposable[] = [];
  private viewWaiters = new Set<(view: vscode.WebviewView) => void>();
  private repositories: Repository[] = [];
  private service?: GitService;
  private services = new Map<string, GitService>();
  private disposables: vscode.Disposable[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private scheduledForce = false;
  private refreshing = false;
  private refreshQueued: boolean | undefined;
  private posted = '';
  private discovery?: Promise<void>;
  private gitWatched = false;
  private gitActivating = false;
  private webviewReady = false;
  private pendingPush = false;
  private readonly documents = new Map<string, string>();
  private readonly executable: string;
  private readonly locale: Locale = normalizeLocale(vscode.env.language);
  t(message: string, ...values: (string | number)[]) {
    return translate(this.locale, message, ...values);
  }
  constructor(private readonly context: vscode.ExtensionContext) {
    const configured = vscode.workspace.getConfiguration('git').get<string | string[]>('path');
    this.executable = (Array.isArray(configured) ? configured[0] : configured) || 'git';
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider('git-workbench-preview', {
        provideTextDocumentContent: (uri) => this.documents.get(uri.toString()) || '',
      }),
    );
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        for (const tab of event.closed) {
          if (tab.input instanceof vscode.TabInputTextDiff) {
            this.documents.delete(tab.input.original.toString());
            this.documents.delete(tab.input.modified.toString());
          } else if (tab.input instanceof vscode.TabInputText)
            this.documents.delete(tab.input.uri.toString());
        }
      }),
    );
    this.disposables.push(vscode.workspace.onDidSaveTextDocument(() => this.scheduleRefresh(true)));
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.discover(true).then(() => this.refresh(true));
      }),
    );
    this.disposables.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) this.scheduleRefresh(true);
      }),
    );
    // Polling only pushes snapshots that differ, so an idle panel does not re-render every few seconds.
    const poll = setInterval(() => {
      if (this.panel?.visible && vscode.window.state.focused) this.scheduleRefresh(false);
    }, 8000);
    this.disposables.push({ dispose: () => clearInterval(poll) });
  }
  dispose() {
    clearTimeout(this.timer);
    this.viewDisposables.forEach((item) => item.dispose());
    this.disposables.forEach((item) => item.dispose());
  }
  post(message: unknown) {
    void this.panel?.webview.postMessage(message);
  }
  private scheduleRefresh(force: boolean) {
    clearTimeout(this.timer);
    this.scheduledForce ||= force;
    this.timer = setTimeout(() => {
      const forced = this.scheduledForce;
      this.scheduledForce = false;
      void this.refresh(forced);
    }, 650);
  }

  private discover(force = false): Promise<void> {
    if (force || !this.discovery) this.discovery = this.scan();
    return this.discovery;
  }
  private async scan() {
    const roots = new Set<string>();
    const found = await Promise.all(
      (vscode.workspace.workspaceFolders || []).map((folder) =>
        GitService.discover(folder.uri.fsPath, this.executable),
      ),
    );
    for (const root of found) if (root) roots.add(root);
    // The built-in Git extension also discovers nested and multi-root repositories. Waiting for its
    // activation would delay the first snapshot, so its repositories are merged in once it is ready.
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension?.isActive) {
      try {
        const api = gitExtension.exports?.getAPI(1);
        if (api && !this.gitWatched) {
          this.gitWatched = true;
          this.disposables.push(
            api.onDidOpenRepository(() => void this.discover(true).then(() => this.refresh(true))),
          );
        }
        const nested = await Promise.all(
          (api?.repositories || []).map((repo: { rootUri: vscode.Uri }) =>
            GitService.discover(repo.rootUri.fsPath, this.executable),
          ),
        );
        for (const root of nested) if (root) roots.add(root);
      } catch {
        /* Workspace folders remain available if built-in Git is disabled. */
      }
    } else if (gitExtension && !this.gitActivating) {
      this.gitActivating = true;
      void Promise.resolve(gitExtension.activate()).then(
        () => this.discover(true).then(() => this.refresh(true)),
        () => undefined,
      );
    }
    for (const repository of this.repositories) roots.add(repository.path);
    this.repositories = [...roots].map((root) => ({ path: root, name: path.basename(root) }));
    const preferred = this.context.workspaceState.get<string>('repository');
    if (!this.service && this.repositories.length)
      this.selectRepository(
        this.repositories.find((repo) => repo.path === preferred)?.path || this.repositories[0].path,
      );
  }
  private selectRepository(root: string) {
    if (!this.repositories.some((repo) => repo.path === root))
      throw new Error(this.t('Select a repository from the current workspace.'));
    let service = this.services.get(root);
    if (!service) {
      service = new GitService(
        root,
        this.executable,
        (entry) => {
          if (this.service?.root === root) this.post({ type: 'activity', entry });
        },
        this.locale,
      );
      this.services.set(root, service);
    }
    this.service = service;
    void this.context.workspaceState.update('repository', root);
  }

  private async reveal(panel?: vscode.WebviewView) {
    const commands = await vscode.commands.getCommands(true);
    const focus = `${WORKBENCH_VIEW_ID}.focus`;
    if (commands.includes(focus)) {
      try {
        await vscode.commands.executeCommand(focus);
        return;
      } catch {
        // A window opened before the extension was updated can keep a stale view registry.
      }
    }
    if (panel) {
      panel.show(false);
      return;
    }
    if (commands.includes(WORKBENCH_CONTAINER_COMMAND)) {
      await vscode.commands.executeCommand(WORKBENCH_CONTAINER_COMMAND);
      return;
    }
    throw new Error(this.t('The GitLoom view is not registered. Reload the VS Code window and try again.'));
  }

  async open(view: View, push = false) {
    this.requestedView = view;
    this.pendingView = view;
    if (push) this.pendingPush = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: ((view: vscode.WebviewView) => void) | undefined;
    const resolved = this.panel
      ? Promise.resolve(this.panel)
      : new Promise<vscode.WebviewView>((resolve, reject) => {
          listener = resolve;
          this.viewWaiters.add(listener);
          timer = setTimeout(
            () =>
              reject(
                new Error(this.t('The Git bottom panel did not open. Reload the window and try again.')),
              ),
            10000,
          );
        });
    let panel: vscode.WebviewView;
    try {
      await this.reveal(this.panel);
      panel = await resolved;
    } finally {
      clearTimeout(timer);
      if (listener) this.viewWaiters.delete(listener);
    }
    if (!panel.visible) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          subscription.dispose();
          reject(new Error(this.t('The Git panel did not become visible.')));
        }, 10000);
        const subscription = panel.onDidChangeVisibility(() => {
          if (panel.visible) {
            clearTimeout(timeout);
            subscription.dispose();
            resolve();
          }
        });
        panel.show(false);
      });
    } else panel.show(false);
    await this.refresh();
    this.flushPendingPush();
  }
  async resolveWebviewView(panel: vscode.WebviewView) {
    this.viewDisposables.forEach((item) => item.dispose());
    this.viewDisposables = [];
    this.panel = panel;
    this.webviewReady = false;
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    panel.webview.onDidReceiveMessage(
      (message) => {
        void this.receive(message);
      },
      undefined,
      this.viewDisposables,
    );
    this.viewDisposables.push(
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = undefined;
          this.webviewReady = false;
        }
      }),
    );
    this.viewDisposables.push(
      panel.onDidChangeVisibility(() => {
        if (panel.visible) this.scheduleRefresh(true);
      }),
    );
    this.posted = '';
    panel.webview.html = this.html(panel.webview, this.requestedView);
    await this.discover();
    for (const resolve of this.viewWaiters) resolve(panel);
    this.viewWaiters.clear();
  }
  private html(webview: vscode.Webview, view: View) {
    const nonce = randomBytes(24).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
    const lang = this.locale === 'zh-cn' ? 'zh-CN' : 'en';
    return `<!doctype html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"><title>GitLoom</title></head><body data-host="panel" data-locale="${this.locale}" data-initial-view="${view}"><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }

  private async snapshot(): Promise<Snapshot> {
    await this.discover(!this.service);
    if (!this.service)
      return {
        repositories: this.repositories,
        repository: null,
        branch: '',
        detached: false,
        upstream: '',
        ahead: 0,
        behind: 0,
        changes: [],
        branches: [],
        commits: [],
        stashes: [],
        remotes: [],
        changelists: [],
        merging: false,
        rebasing: false,
        operation: null,
        updatedAt: Date.now(),
      };
    const git = this.service;
    const limit = Math.min(
      2000,
      Math.max(50, vscode.workspace.getConfiguration('gitWorkbench').get<number>('historyLimit', 300)),
    );
    const state = await git.snapshot(limit);
    return {
      ...state,
      repositories: this.repositories,
      repository: this.repositories.find((repo) => repo.path === git.root)!,
      changelists: this.changelists(git.root),
    };
  }
  private async refresh(force = true) {
    if (!this.panel) return;
    if (this.refreshing) {
      this.refreshQueued = this.refreshQueued || force;
      return;
    }
    this.refreshing = true;
    try {
      for (let next: boolean | undefined = force; next !== undefined && this.panel;) {
        this.refreshQueued = undefined;
        const state = await this.snapshot();
        const key = fingerprint(state);
        if (state.repository?.path === this.service?.root && (next || key !== this.posted)) {
          this.posted = key;
          this.post({ type: 'snapshot', snapshot: state });
        }
        next = this.refreshQueued;
      }
    } catch (error) {
      this.post({ type: 'error', message: (error as Error).message });
    } finally {
      this.refreshQueued = undefined;
      this.refreshing = false;
    }
  }
  private changelists(root: string) {
    return this.context.workspaceState.get<Changelist[]>(`lists:${root}`, []);
  }

  private async receive(message: unknown) {
    if (!message || typeof message !== 'object') return;
    const request = message as { id?: unknown; method?: unknown; params?: unknown; repository?: unknown };
    if (
      typeof request.id !== 'string' ||
      typeof request.method !== 'string' ||
      !METHODS.includes(request.method as Method)
    )
      return;
    const method = request.method as Method;
    try {
      if (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))
        throw new Error(this.t('Invalid operation parameters.'));
      if (!READ_ONLY.has(method) && !vscode.workspace.isTrusted)
        throw new Error(this.t('Trust the current workspace first.'));
      if (method !== 'snapshot' && method !== 'pickRepository' && request.repository !== this.service?.root)
        throw new Error(this.t('The repository has changed. Refresh and try again.'));
      const result = await this.dispatch(method, request.params as Record<string, unknown>);
      this.post({ type: 'response', id: request.id, result });
      if (method === 'snapshot') {
        this.webviewReady = true;
        this.flushPendingPush();
      }
    } catch (error) {
      this.post({ type: 'response', id: request.id, error: (error as Error).message });
    } finally {
      if (!READ_ONLY.has(method) || method === 'pickRepository') await this.refresh(false);
    }
  }

  private flushPendingPush() {
    if (this.webviewReady && this.pendingView) {
      this.post({ type: 'view', view: this.pendingView });
      this.pendingView = undefined;
    }
    if (this.webviewReady && this.pendingPush) {
      this.pendingPush = false;
      this.post({ type: 'pushDialog' });
    }
  }

  private async dispatch(method: Method, params: Record<string, unknown>): Promise<unknown> {
    const string = (key: string, optional = false): string => {
      if (optional && params[key] === undefined) return '';
      if (typeof params[key] !== 'string' || (params[key] as string).includes('\0'))
        throw new Error(this.t('Invalid parameter: {0}', key));
      return params[key] as string;
    };
    const paths = () => {
      if (
        !Array.isArray(params.paths) ||
        !params.paths.length ||
        params.paths.length > 5000 ||
        params.paths.some((file) => typeof file !== 'string')
      )
        throw new Error(this.t('Select the files to operate on.'));
      return params.paths as string[];
    };
    if (method === 'snapshot') {
      if (params.repository) {
        await this.discover();
        this.selectRepository(string('repository'));
      }
      const state = await this.snapshot();
      this.posted = fingerprint(state);
      return state;
    }
    if (method === 'pickRepository') {
      const selection = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: this.t('Select Git Repository'),
      });
      if (!selection?.[0]) return;
      const root = await GitService.discover(selection[0].fsPath, this.executable);
      if (!root)
        throw new Error(
          this.t(
            'This directory is not a Git repository. Run git init or choose an existing repository first.',
          ),
        );
      if (!this.repositories.some((repo) => repo.path === root))
        this.repositories.push({ path: root, name: path.basename(root) });
      this.selectRepository(root);
      return;
    }
    const git = this.service;
    if (!git) throw new Error(this.t('Open a Git repository first.'));
    switch (method) {
      case 'diff':
        return git.diff(string('path'), {
          commit: string('commit', true) || undefined,
          stash: string('stash', true) || undefined,
        });
      case 'commitDetail':
        return git.commitDetail(string('hash'));
      case 'commit': {
        if (!(await vscode.workspace.saveAll(false)))
          throw new Error(this.t('Some files could not be saved. Save them and try again.'));
        const result = await git.commit(paths(), string('message'));
        if (params.push === true) {
          try {
            await git.push();
          } catch (error) {
            // A successful commit must not appear failed just because a later push failed.
            return { output: result, pushError: (error as Error).message };
          }
        }
        return { output: result };
      }
      case 'stage':
        return git.stage(paths());
      case 'fetch':
        return git.fetch();
      case 'pull':
        return git.pull(
          vscode.workspace
            .getConfiguration('gitWorkbench')
            .get<'ff-only' | 'rebase' | 'merge'>('pullStrategy', 'ff-only'),
        );
      case 'push':
        return git.push();
      case 'outgoing':
        return git.outgoing();
      case 'checkout':
        return git.checkout(string('branch'), params.remote === true);
      case 'createBranch':
        return git.createBranch(string('name'), string('source', true) || undefined, params.remote === true);
      case 'deleteBranch': {
        const name = string('name'),
          remote = params.remote === true;
        if (
          await this.confirm(
            this.t('Delete the {0} branch "{1}"?', this.t(remote ? 'remote' : 'local'), name),
            this.t('Delete Branch'),
            this.t(
              remote
                ? 'This deletes the branch on the remote server and affects collaborators. The deletion is rejected if the remote branch has changed.'
                : 'Git only deletes branches that have been merged.',
            ),
          )
        )
          return git.deleteBranch(name, remote);
        throw new Error(this.t('Branch deletion canceled.'));
      }
      case 'merge':
        return git.merge(string('branch'), params.remote === true);
      case 'rebase': {
        const name = string('branch');
        if (
          await this.confirm(
            this.t('Rebase the current branch onto "{0}"?', name),
            this.t('Rebase'),
            this.t(
              'Commits on the current branch will be reapplied and their IDs will change. Coordinate with collaborators for branches that have already been pushed. If conflicts occur, continue or abort from the workbench.',
            ),
          )
        )
          return git.rebase(name, params.remote === true);
        throw new Error(this.t('Rebase canceled.'));
      }
      case 'renameBranch':
        return git.renameBranch(string('branch'), string('name'));
      case 'setUpstream':
        return git.setUpstream(string('branch'), string('upstream', true) || undefined);
      case 'copyBranch': {
        const branch = await git.existingBranch(string('branch'), params.remote === true);
        await vscode.env.clipboard.writeText(branch.name);
        return;
      }
      case 'compareBranch':
        return git.compareBranch(string('branch'), params.remote === true);
      case 'openBranchDiff': {
        const diff = await git.branchDiff(string('path'), string('base'), string('head'));
        if (diff.binary || diff.truncated)
          throw new Error(
            diff.binary
              ? this.t('Text comparison of binary files between branches is not supported.')
              : this.t('The file exceeds 20 MB. Use an external diff tool.'),
          );
        const token = randomUUID();
        const before = vscode.Uri.from({
          scheme: 'git-workbench-preview',
          path: `/${token}/before/${diff.path}`,
        });
        const after = vscode.Uri.from({
          scheme: 'git-workbench-preview',
          path: `/${token}/after/${diff.path}`,
        });
        this.documents.set(before.toString(), diff.before);
        this.documents.set(after.toString(), diff.after);
        await vscode.commands.executeCommand(
          'vscode.diff',
          before,
          after,
          `${path.basename(diff.path)} (${diff.beforeLabel} ↔ ${diff.afterLabel})`,
          { preview: false },
        );
        return;
      }
      case 'stash': {
        if (!(await vscode.workspace.saveAll(false)))
          throw new Error(this.t('Some files could not be saved. Save them and try again.'));
        return git.stash(string('message'));
      }
      case 'stashApply':
        return git.stashApply(string('ref'), params.pop === true);
      case 'stashFiles':
        return git.stashFiles(string('ref'));
      case 'stashDrop': {
        if (
          await this.confirm(
            this.t('Delete {0}?', string('ref')),
            this.t('Delete Stash'),
            this.t('A deleted stash cannot be restored from the Stash list.'),
          )
        )
          return git.stashDrop(string('ref'));
        throw new Error(this.t('Stash deletion canceled.'));
      }
      case 'discard': {
        const selected = paths();
        if (
          await this.confirm(
            this.t('Discard all local changes in {0} files?', selected.length),
            this.t('Discard Changes'),
            this.t(
              '{0}\n\nThis resets to HEAD, including staged changes; untracked files will be deleted. This cannot be undone.',
              selected.slice(0, 8).join('\n'),
            ),
          )
        )
          return git.discard(selected);
        throw new Error(this.t('Discard canceled.'));
      }
      case 'markResolved':
        return git.markResolved(string('path'));
      case 'resolve':
        await vscode.commands.executeCommand(
          'git.openMergeEditor',
          vscode.Uri.file(await git.safePath(string('path'))),
        );
        return;
      case 'openFile':
        await vscode.window.showTextDocument(vscode.Uri.file(await git.safePath(string('path'), true)), {
          preview: true,
        });
        return;
      case 'openDiff':
        return this.openDiff(git, string('path'), string('commit', true));
      case 'cherryPick':
        return git.cherryPick(string('hash'));
      case 'revert': {
        const hash = string('hash');
        if (
          await this.confirm(
            this.t('Revert the changes in commit {0}?', hash.slice(0, 8)),
            this.t('Create Revert Commit'),
            this.t('This creates a new inverse commit and preserves the original history.'),
          )
        )
          return git.revert(hash);
        throw new Error(this.t('Revert canceled.'));
      }
      case 'reset': {
        const hash = string('hash');
        if (
          await this.confirm(
            this.t('Hard reset the current branch to commit {0}?', hash.slice(0, 8)),
            this.t('Hard Reset'),
            this.t(
              'The current branch will point to this commit. Tracked changes in the index and working tree will be discarded; untracked files are kept. This cannot be undone.',
            ),
          )
        )
          return git.reset(hash);
        throw new Error(this.t('Hard reset canceled.'));
      }
      case 'continueOperation':
        return git.continueOperation();
      case 'abortOperation': {
        if (
          await this.confirm(
            this.t('Abort the current Git operation?'),
            this.t('Abort Operation'),
            this.t('Git will restore the state before the operation.'),
          )
        )
          return git.abortOperation();
        throw new Error(this.t('Abort canceled.'));
      }
      case 'changelist': {
        let lists = this.changelists(git.root);
        const action = string('action'),
          id = string('id', true);
        if (action === 'create') {
          const name = string('name').trim();
          if (!name || name.length > 80 || lists.some((list) => list.name === name))
            throw new Error(this.t('Enter a unique changelist name (1–80 characters).'));
          lists = [...lists, { id: randomUUID(), name, paths: [] }];
        } else if (action === 'delete') lists = lists.filter((list) => list.id !== id);
        else if (action === 'move') {
          const selected = paths();
          if (id && !lists.some((list) => list.id === id))
            throw new Error(this.t('The changelist does not exist.'));
          for (const file of selected) git.validatePath(file);
          lists = lists.map((list) => ({
            ...list,
            paths: [
              ...list.paths.filter((file) => !selected.includes(file)),
              ...(list.id === id ? selected : []),
            ],
          }));
        } else throw new Error(this.t('Invalid changelist operation.'));
        await this.context.workspaceState.update(`lists:${git.root}`, lists);
        return;
      }
    }
  }

  private confirm(message: string, button: string, detail: string) {
    return vscode.window
      .showWarningMessage(message, { modal: true, detail }, button)
      .then((choice) => choice === button);
  }
  private async openDiff(git: GitService, file: string, commit?: string) {
    const diff = await git.diff(file, { commit: commit || undefined, full: true });
    if (diff.binary) {
      if (!commit) {
        await vscode.commands.executeCommand('git.openChange', vscode.Uri.file(await git.safePath(file)));
        return;
      }
      throw new Error(
        this.t('Native comparison of binary files in history is not supported. Use a local file viewer.'),
      );
    }
    if (diff.truncated)
      throw new Error(this.t('The file exceeds 20 MB. Use an external diff tool to view it.'));
    const scheme = 'git-workbench-preview';
    const token = randomUUID();
    const before = vscode.Uri.from({ scheme, path: `/${token}/before/${file}` });
    let virtualAfter = !!commit;
    if (!commit) {
      try {
        virtualAfter = (await lstat(await git.safePath(file))).isSymbolicLink();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') virtualAfter = true;
        else throw error;
      }
    }
    const after = virtualAfter
      ? vscode.Uri.from({ scheme, path: `/${token}/after/${file}` })
      : vscode.Uri.file(await git.safePath(file));
    this.documents.set(before.toString(), diff.before);
    if (virtualAfter) this.documents.set(after.toString(), diff.after);
    await vscode.commands.executeCommand(
      'vscode.diff',
      before,
      after,
      `${path.basename(file)} (${diff.beforeLabel} ↔ ${diff.afterLabel})`,
      { preview: false },
    );
  }
}
