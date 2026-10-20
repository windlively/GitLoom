import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import path from 'node:path';
import { access, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { Workbench } from '../src/extension';
import type { Snapshot } from '../src/shared/types';

export async function run() {
  const root = process.env.GIT_WORKBENCH_TEST_REPO!;
  const extension = vscode.extensions.getExtension('windlively.gitloom');
  assert.ok(extension, 'development extension is discovered');
  const { workbench } = (await extension.activate()) as { workbench: Workbench };
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const command of ['gitWorkbench.open', 'gitWorkbench.commit', 'gitWorkbench.log', 'gitWorkbench.push'])
    assert.ok(commands.includes(command));
  for (const command of ['gitWorkbench.workbench.focus', 'workbench.view.extension.gitWorkbench'])
    assert.ok(commands.includes(command), `view command ${command} is registered`);
  assert.equal(extension.packageJSON.contributes.viewsContainers.panel[0].id, 'gitWorkbench');
  assert.equal(extension.packageJSON.contributes.viewsContainers.activitybar, undefined);
  assert.equal(extension.packageJSON.contributes.views.gitWorkbench[0].type, 'webview');
  await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, 'tracked.txt')), { preview: false });
  const terminal = vscode.window.createTerminal({
    name: 'Git panel co-existence test',
    shellPath: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  });
  terminal.show();
  const internal = workbench as unknown as {
    receive(message: unknown): Promise<void>;
    panel?: vscode.WebviewView;
  };
  const messages: any[] = [];
  const originalPost = workbench.post.bind(workbench);
  workbench.post = (message) => {
    messages.push(message);
    originalPost(message);
  };
  try {
    await vscode.commands.executeCommand('gitWorkbench.push');
    assert.ok(internal.panel?.visible, 'Git workbench is a visible native panel view');
    assert.match(internal.panel.webview.html, /data-host="panel"/);
    assert.match(internal.panel.webview.html, /data-locale="en"/);
    assert.match(internal.panel.webview.html, /font-src /, 'local Codicons are permitted by the Webview CSP');
    const style = await readFile(
      path.join(process.env.GIT_WORKBENCH_EXTENSION_ROOT!, 'dist/webview.css'),
      'utf8',
    );
    const font = /url\(["']?(?:\.\/)?(assets\/[^"'?)]+\.ttf)(?:\?[^"')]*)?["']?\)/.exec(style);
    assert.ok(font, 'Codicons font is bundled locally');
    await access(path.join(process.env.GIT_WORKBENCH_EXTENSION_ROOT!, 'dist', font[1]));
    assert.ok(
      vscode.window.visibleTextEditors.some(
        (editor) => editor.document.uri.fsPath === path.join(root, 'tracked.txt'),
      ),
      'source editor stays visible above the panel',
    );
    assert.ok(
      !vscode.window.tabGroups.all.flatMap((group) => group.tabs).some((tab) => tab.label === 'GitLoom'),
      'opening Git creates no editor tab',
    );
    assert.ok(vscode.window.terminals.includes(terminal), 'terminal remains available beside the Git panel');
    async function rpc(method: string, params: unknown, repository = root) {
      const id = `host-${messages.length}-${Date.now()}`;
      await internal.receive({ id, method, params, repository });
      const reply = messages.find((message) => message.type === 'response' && message.id === id);
      assert.ok(reply, `response to ${method}`);
      return reply;
    }
    let reply = await rpc('snapshot', {});
    assert.equal(reply.error, undefined);
    assert.ok(
      messages.some((message) => message.type === 'pushDialog'),
      'push dialog waits until the webview is ready',
    );
    let state: Snapshot = reply.result;
    assert.equal(state.repository?.path, root);
    assert.equal(state.diffTarget, 'editor', 'file diffs default to the VS Code editor');
    assert.equal(state.fileLayout, 'tree', 'file lists default to the directory tree');
    await vscode.workspace
      .getConfiguration('gitWorkbench')
      .update('diffTarget', 'panel', vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration('gitWorkbench')
      .update('fileLayout', 'flat', vscode.ConfigurationTarget.Global);
    state = (await rpc('snapshot', {})).result;
    assert.equal(state.diffTarget, 'panel', 'diffTarget setting reaches the webview snapshot');
    assert.equal(state.fileLayout, 'flat', 'fileLayout setting reaches the webview snapshot');
    await vscode.workspace
      .getConfiguration('gitWorkbench')
      .update('diffTarget', undefined, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration('gitWorkbench')
      .update('fileLayout', undefined, vscode.ConfigurationTarget.Global);
    reply = await rpc('setFileLayout', { layout: 'flat' });
    assert.equal(reply.error, undefined, 'the webview can save the file layout setting');
    assert.equal(
      vscode.workspace.getConfiguration('gitWorkbench').get('fileLayout'),
      'flat',
      'the layout toggle writes user settings',
    );
    await vscode.workspace
      .getConfiguration('gitWorkbench')
      .update('fileLayout', undefined, vscode.ConfigurationTarget.Global);
    assert.equal(state.changes.length, 2);
    const resolvedView = internal.panel;
    const hidden = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        subscription.dispose();
        reject(new Error('panel did not hide'));
      }, 5000);
      const subscription = resolvedView.onDidChangeVisibility(() => {
        if (!resolvedView.visible) {
          clearTimeout(timer);
          subscription.dispose();
          resolve();
        }
      });
    });
    await vscode.commands.executeCommand('workbench.action.closePanel');
    await hidden;
    await vscode.commands.executeCommand('gitWorkbench.log');
    assert.equal(internal.panel, resolvedView, 'hiding and reopening reuses the same native view');
    assert.equal(internal.panel.visible, true);
    assert.ok(messages.some((message) => message.type === 'view' && message.view === 'log'));
    assert.ok(
      vscode.window.visibleTextEditors.some(
        (editor) => editor.document.uri.fsPath === path.join(root, 'tracked.txt'),
      ),
    );
    await vscode.commands.executeCommand('gitWorkbench.commit');
    assert.ok(messages.some((message) => message.type === 'view' && message.view === 'changes'));
    reply = await rpc('diff', { path: 'tracked.txt' });
    assert.equal(reply.result.before, 'original\n');
    assert.equal(reply.result.after, 'edited\n');
    reply = await rpc('commit', { paths: ['tracked.txt'], message: 'host integration commit' });
    assert.equal(reply.error, undefined);
    assert.match(reply.result.output, /host integration commit/);
    state = (await rpc('snapshot', {})).result;
    assert.deepEqual(
      state.changes.map((file) => file.path),
      ['untracked.txt'],
    );
    reply = await rpc('commit', {
      paths: ['untracked.txt'],
      message: 'local commit before failed push',
      push: true,
    });
    assert.equal(reply.error, undefined);
    assert.match(reply.result.pushError, /No remote is configured/);
    state = (await rpc('snapshot', {})).result;
    assert.equal(state.commits[0].subject, 'local commit before failed push');
    const originalBranch = state.branch;
    reply = await rpc('createBranch', { name: 'host-branch', source: originalBranch, remote: false });
    assert.equal(reply.error, undefined);
    reply = await rpc('renameBranch', { branch: 'host-branch', name: 'host-renamed' });
    assert.equal(reply.error, undefined);
    reply = await rpc('compareBranch', { branch: originalBranch, remote: false });
    assert.equal(reply.error, undefined);
    assert.deepEqual(reply.result.files, []);
    await rpc('checkout', { branch: originalBranch, remote: false });
    reply = await rpc('compareBranch', { branch: 'missing-branch' });
    assert.match(reply.error, /does not exist/);
    reply = await rpc('openBranchDiff', {
      path: 'tracked.txt',
      base: state.commits[1].hash,
      head: state.commits[0].hash,
    });
    assert.match(reply.error, /not part of this branch comparison/);
    reply = await rpc('openBranchDiff', {
      path: 'untracked.txt',
      base: state.commits[1].hash,
      head: state.commits[0].hash,
    });
    assert.equal(reply.error, undefined);
    const branchDiffTab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label.startsWith('untracked.txt ('))?.input as vscode.TabInputTextDiff;
    assert.ok(branchDiffTab);
    assert.equal((await vscode.workspace.openTextDocument(branchDiffTab.original)).getText(), '');
    assert.equal((await vscode.workspace.openTextDocument(branchDiffTab.modified)).getText(), 'new file\n');
    await rpc('changelist', { action: 'create', name: '测试任务' });
    state = (await rpc('snapshot', {})).result;
    assert.equal(state.changelists[0].name, '测试任务');
    const list = state.changelists[0];
    await writeFile(path.join(root, 'tracked.txt'), 'modified after commit\n');
    await rpc('changelist', { action: 'move', id: list.id, paths: ['tracked.txt'] });
    assert.deepEqual(((await rpc('snapshot', {})).result as Snapshot).changelists[0].paths, ['tracked.txt']);
    reply = await rpc(
      'commit',
      { paths: ['tracked.txt'], message: 'should not commit' },
      '/wrong/repository',
    );
    assert.match(reply.error, /repository has changed/);
    reply = await rpc('diff', { path: '../outside' });
    assert.match(reply.error, /Invalid repository file path/);
    reply = await rpc('openFile', { path: 'tracked.txt' });
    assert.equal(reply.error, undefined);
    reply = await rpc('openDiff', { path: 'tracked.txt' });
    assert.equal(reply.error, undefined);
    const firstDiff = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((tab) => tab.input instanceof vscode.TabInputTextDiff)?.input as vscode.TabInputTextDiff;
    assert.ok(firstDiff);
    assert.equal((await vscode.workspace.openTextDocument(firstDiff.original)).getText(), 'edited\n');
    reply = await rpc('openDiff', { path: 'untracked.txt', commit: state.commits[0].hash });
    assert.equal(reply.error, undefined);
    const secondDiff = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.modified.path.endsWith('/after/untracked.txt'),
      )?.input as vscode.TabInputTextDiff;
    assert.ok(secondDiff);
    assert.equal((await vscode.workspace.openTextDocument(secondDiff.modified)).getText(), 'new file\n');
    assert.equal((await vscode.workspace.openTextDocument(firstDiff.original)).getText(), 'edited\n');
    await rm(path.join(root, 'tracked.txt'));
    reply = await rpc('openDiff', { path: 'tracked.txt' });
    assert.equal(reply.error, undefined);
    const deletedDiff = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.modified.path.endsWith('/after/tracked.txt'),
      )?.input as vscode.TabInputTextDiff;
    assert.ok(deletedDiff);
    assert.equal((await vscode.workspace.openTextDocument(deletedDiff.modified)).getText(), '');
    const outside = path.join(path.dirname(root), 'outside.txt');
    await writeFile(outside, 'outside file content\n');
    await symlink(outside, path.join(root, 'link.txt'));
    reply = await rpc('openFile', { path: 'link.txt' });
    assert.match(reply.error, /Opening link targets outside the repository/);
    reply = await rpc('openDiff', { path: 'link.txt' });
    assert.equal(reply.error, undefined);
    const linkDiff = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.path.endsWith('/after/link.txt'),
      )?.input as vscode.TabInputTextDiff;
    assert.ok(linkDiff);
    assert.equal((await vscode.workspace.openTextDocument(linkDiff.modified)).getText(), outside);
    console.log(
      'HOST PASS: native bottom panel, source editor and terminal co-existence, no Git editor tab, hide/reopen retains view, commands, real RPC snapshot/diff/selected commit, push failure, changelists, repository boundary, native diff providers.',
    );
  } finally {
    terminal.dispose();
    workbench.post = originalPost;
  }
}
