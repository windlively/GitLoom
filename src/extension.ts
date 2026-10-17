import * as vscode from 'vscode';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { GitService } from './git/service';
import type { Activity, Changelist, Method, Repository, Requests, Snapshot, View } from './shared/types';

const METHODS: Method[] = [
  'snapshot',
  'diff',
  'commitDetail',
  'commit',
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
  status.tooltip = '打开 IDEA 风格 Git 工作台';
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
  private refreshing = false;
  private webviewReady = false;
  private pendingPush = false;
  private readonly documents = new Map<string, string>();
  private readonly executable: string;
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
    this.disposables.push(vscode.workspace.onDidSaveTextDocument(() => this.scheduleRefresh()));
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.discover().then(() => this.refresh());
      }),
    );
    this.disposables.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) this.scheduleRefresh();
      }),
    );
    const poll = setInterval(() => {
      if (this.panel?.visible && vscode.window.state.focused) this.scheduleRefresh();
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
  private scheduleRefresh() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.refresh();
    }, 650);
  }

  private async discover() {
    const roots = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const root = await GitService.discover(folder.uri.fsPath, this.executable);
      if (root) roots.add(root);
    }
    // The built-in Git extension also discovers nested and multi-root repositories.
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    try {
      const git = await gitExtension?.activate();
      for (const repo of git?.getAPI(1)?.repositories || []) {
        const root = await GitService.discover(repo.rootUri.fsPath, this.executable);
        if (root) roots.add(root);
      }
    } catch {
      /* Workspace folders remain available if built-in Git is disabled. */
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
      throw new Error('请从当前工作区选择一个仓库。');
    let service = this.services.get(root);
    if (!service) {
      service = new GitService(root, this.executable, (entry) => {
        if (this.service?.root === root) this.post({ type: 'activity', entry });
      });
      this.services.set(root, service);
    }
    this.service = service;
    void this.context.workspaceState.update('repository', root);
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
          timer = setTimeout(() => reject(new Error('Git 底部面板未能打开，请重载窗口后重试。')), 10000);
        });
    let panel: vscode.WebviewView;
    try {
      await vscode.commands.executeCommand(`${WORKBENCH_VIEW_ID}.focus`);
      panel = await resolved;
    } finally {
      clearTimeout(timer);
      if (listener) this.viewWaiters.delete(listener);
    }
    if (!panel.visible) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          subscription.dispose();
          reject(new Error('Git 面板未能显示。'));
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
        if (panel.visible) this.scheduleRefresh();
      }),
    );
    panel.webview.html = this.html(panel.webview, this.requestedView);
    await this.discover();
    for (const resolve of this.viewWaiters) resolve(panel);
    this.viewWaiters.clear();
  }
  private html(webview: vscode.Webview, view: View) {
    const nonce = randomBytes(24).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"><title>GitLoom</title></head><body data-host="panel" data-initial-view="${view}"><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }

  private async snapshot(): Promise<Snapshot> {
    await this.discover();
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
  private async refresh() {
    if (!this.panel || this.refreshing) return;
    this.refreshing = true;
    try {
      const state = await this.snapshot();
      if (state.repository?.path === this.service?.root) this.post({ type: 'snapshot', snapshot: state });
    } catch (error) {
      this.post({ type: 'error', message: (error as Error).message });
    } finally {
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
        throw new Error('无效的操作参数。');
      if (!READ_ONLY.has(method) && !vscode.workspace.isTrusted) throw new Error('请先信任当前工作区。');
      if (method !== 'snapshot' && method !== 'pickRepository' && request.repository !== this.service?.root)
        throw new Error('仓库已切换，请刷新后重试。');
      const result = await this.dispatch(method, request.params as Record<string, unknown>);
      this.post({ type: 'response', id: request.id, result });
      if (method === 'snapshot') {
        this.webviewReady = true;
        this.flushPendingPush();
      }
    } catch (error) {
      this.post({ type: 'response', id: request.id, error: (error as Error).message });
    } finally {
      if (!READ_ONLY.has(method) || method === 'pickRepository') await this.refresh();
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
        throw new Error(`无效参数：${key}`);
      return params[key] as string;
    };
    const paths = () => {
      if (
        !Array.isArray(params.paths) ||
        !params.paths.length ||
        params.paths.length > 5000 ||
        params.paths.some((file) => typeof file !== 'string')
      )
        throw new Error('请选择需要操作的文件。');
      return params.paths as string[];
    };
    if (method === 'snapshot') {
      await this.discover();
      if (params.repository) this.selectRepository(string('repository'));
      return this.snapshot();
    }
    if (method === 'pickRepository') {
      const selection = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: '选择 Git 仓库',
      });
      if (!selection?.[0]) return;
      const root = await GitService.discover(selection[0].fsPath, this.executable);
      if (!root) throw new Error('该目录不是 Git 仓库。请先运行 git init 或选择已有仓库。');
      if (!this.repositories.some((repo) => repo.path === root))
        this.repositories.push({ path: root, name: path.basename(root) });
      this.selectRepository(root);
      return;
    }
    const git = this.service;
    if (!git) throw new Error('请先打开一个 Git 仓库。');
    switch (method) {
      case 'diff':
        return git.diff(string('path'), {
          commit: string('commit', true) || undefined,
          stash: string('stash', true) || undefined,
        });
      case 'commitDetail':
        return git.commitDetail(string('hash'));
      case 'commit': {
        if (!(await vscode.workspace.saveAll(false))) throw new Error('部分文件未能保存，请保存文件后重试。');
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
            `删除${remote ? '远程' : '本地'}分支「${name}」？`,
            '删除分支',
            remote
              ? '这会删除远程服务器上的分支，影响其他协作者。远程分支已更新时会拒绝删除。'
              : 'Git 只会删除已经合并的分支。',
          )
        )
          return git.deleteBranch(name, remote);
        throw new Error('已取消删除分支。');
      }
      case 'merge':
        return git.merge(string('branch'), params.remote === true);
      case 'rebase': {
        const name = string('branch');
        if (
          await this.confirm(
            `将当前分支 Rebase 到「${name}」？`,
            'Rebase',
            '当前分支的提交将被重新应用，提交 ID 会变化。已推送的分支需要与协作者协调。发生冲突后可在工作台继续或中止。',
          )
        )
          return git.rebase(name, params.remote === true);
        throw new Error('已取消 Rebase。');
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
            diff.binary ? '暂不支持分支间二进制文件的文本比较。' : '文件超过 20 MB，请使用外部差异工具。',
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
        if (!(await vscode.workspace.saveAll(false))) throw new Error('部分文件未能保存，请保存文件后重试。');
        return git.stash(string('message'));
      }
      case 'stashApply':
        return git.stashApply(string('ref'), params.pop === true);
      case 'stashFiles':
        return git.stashFiles(string('ref'));
      case 'stashDrop': {
        if (await this.confirm(`删除 ${string('ref')}？`, '删除 Stash', '删除后无法通过 Stash 列表恢复。'))
          return git.stashDrop(string('ref'));
        throw new Error('已取消删除 Stash。');
      }
      case 'discard': {
        const selected = paths();
        if (
          await this.confirm(
            `回滚 ${selected.length} 个文件的所有本地更改？`,
            '回滚更改',
            `${selected.slice(0, 8).join('\n')}\n\n将还原到 HEAD，包含暂存区更改；未跟踪文件会被删除。此操作无法撤销。`,
          )
        )
          return git.discard(selected);
        throw new Error('已取消回滚。');
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
            `还原提交 ${hash.slice(0, 8)} 的改动？`,
            '创建还原提交',
            '会创建一个新的反向提交，保留原提交历史。',
          )
        )
          return git.revert(hash);
        throw new Error('已取消还原提交。');
      }
      case 'continueOperation':
        return git.continueOperation();
      case 'abortOperation': {
        if (await this.confirm('中止当前 Git 操作？', '中止操作', '将交由 Git 恢复到操作前的状态。'))
          return git.abortOperation();
        throw new Error('已取消中止操作。');
      }
      case 'changelist': {
        let lists = this.changelists(git.root);
        const action = string('action'),
          id = string('id', true);
        if (action === 'create') {
          const name = string('name').trim();
          if (!name || name.length > 80 || lists.some((list) => list.name === name))
            throw new Error('请输入不重复的更改列表名称（1–80 字）。');
          lists = [...lists, { id: randomUUID(), name, paths: [] }];
        } else if (action === 'delete') lists = lists.filter((list) => list.id !== id);
        else if (action === 'move') {
          const selected = paths();
          if (id && !lists.some((list) => list.id === id)) throw new Error('更改列表不存在。');
          for (const file of selected) git.validatePath(file);
          lists = lists.map((list) => ({
            ...list,
            paths: [
              ...list.paths.filter((file) => !selected.includes(file)),
              ...(list.id === id ? selected : []),
            ],
          }));
        } else throw new Error('无效的更改列表操作。');
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
      throw new Error('暂不支持历史二进制文件的原生比较，请使用本地文件查看器。');
    }
    if (diff.truncated) throw new Error('文件超过 20 MB，请使用外部差异工具查看。');
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
