# GitLoom

[简体中文](README.md) | English

**Review, diff, commit, and push from VS Code's bottom panel.** As compact as IntelliJ IDEA's Git tool window, while following VS Code's themes, fonts, and panel conventions.

GitLoom is a compact Git workbench for VS Code's bottom panel: review changes with inline diff, stage selected files, commit, browse history, and manage branches without leaving the editor.

The interface, command titles, settings descriptions, errors, and confirmations follow VS Code's display language: English for non-Chinese locales, Simplified Chinese for `zh-*` locales.

## Installation

Requires VS Code 1.96+ and Git.

- **Marketplace**: search for **GitLoom** in the Extensions view, or run `code --install-extension windlively.gitloom`.
- **Offline**: run `code --install-extension <file>.vsix`, or choose **Install from VSIX…** in the Extensions view `…` menu.

Open a Git project, click the **GitLoom** tab next to the terminal, or run the **GitLoom: Open Git Workbench** command. You can also use the status bar entry.

## Interface

Change list with inline diff (dark theme):

![GitLoom change list, inline diff, and commit box](https://gcore.jsdelivr.net/gh/windlively/GitLoom@0d8b8db/docs/screenshots/changes-dark.png)

Commit history, graph, and details (light theme):

![GitLoom commit history and details](https://gcore.jsdelivr.net/gh/windlively/GitLoom@0d8b8db/docs/screenshots/history-light.png)

The workbench uses a native VS Code panel container and does not open an editor tab. Drag the top edge to resize it, use VS Code's maximize, collapse, and close buttons, or press `Cmd+J` / `Ctrl+J` to toggle the bottom panel. Switching to the terminal and back preserves the workbench and commit draft.

The bottom panel uses a compact layout: repository, branch, Git views, and sync actions at the top; file list, diff (opened in the VS Code editor by default, with an option for the inline panel), and commit box arranged in columns. Drag the boundaries of the branch pane, file list, commit area, history details, Stash list, and left/right diff panes to resize them; the widths are remembered. Double-click a boundary to restore its default; focus a boundary and use the arrow keys to fine-tune, or Shift + arrow keys for 40px steps. In narrow windows, manage branches from the top branch picker.

Dialogs such as branch selection and push preview can be moved by dragging their title bar and resized from the edges or corners; double-click the title bar to restore the default position and size, and reopened dialogs reuse the last size.

The UI follows VS Code's native component style, inheriting panel, list, input, button, hover, selection, and focus colors from the current theme in real time. Fonts follow VS Code settings, and diffs use the editor font. Repository selection, history filters, and upstream branch selection use custom dropdowns with arrow keys, Home/End, and type-ahead. The commit graph uses the same compact swimlanes, rounded connectors, and node styling as VS Code's Source Control view. File rows are 22px and history rows 24px; the UI uses official Codicons and works in light, dark, and high-contrast themes. Large file lists and histories use virtual scrolling, rendering only visible rows.

## Everyday workflow

### Local changes and commits

- Files are grouped by change list, with untracked files and merge conflicts shown separately.
- Changed files and commit detail files are shown as a directory tree by default; folders collapse level by level, single-child chains such as `webview/src` are compacted into one row with a file count, and the toolbar grouping button or the `gitWorkbench.fileLayout` setting switches to a flat list with full paths.
- Check files or an entire changelist, then click a file to review its side-by-side diff. The button on the right of each file row opens the current working-tree file; when the file no longer exists, that slot shows "Deleted".
- Diffs opened in VS Code use preview tabs, matching native Git: reviewing one file after another reuses the same diff window instead of piling up tabs.
- File rows support IntelliJ IDEA-style selection: click to select, `Shift` to select a range, and `Cmd` / `Ctrl` to toggle multiple selections. File names are colored by status using VS Code's Git decoration theme colors (added/untracked green, deleted red, modified amber in the default themes; other themes may differ), and selected rows follow the selection foreground. Row selection and commit checkboxes are independent.
- Right-click a file or the current multi-selection for the actions menu: show the diff, open the file, copy the path or relative path, **Add to Git**, **Rollback Changes**, **Delete Files**, **Add to .gitignore** or **.git/info/exclude**, move to another changelist, **Commit Selected Files**, and reveal in the file manager. Delete and rollback ask for native confirmation first; ignore rules only accept untracked files and never duplicate existing lines.
- Staged and partially staged files display status badges; staging affects only the selected files and leaves other changes untouched.
- The diff supports syntax highlighting, added/removed lines, line numbers, context filtering, unified view, synchronized vertical scrolling, and independent horizontal scrolling.
- Enter a message and click **Commit** or **Commit & Push**. Open files are saved before committing.
- A commit includes **all working tree changes** for the checked files. Staged changes in unchecked files remain staged.
- If a commit hook fails, the message is preserved and the Git error is shown. If the local commit succeeds but the push fails, GitLoom clearly reports that the local commit completed and lets you retry the push separately.
- Create additional change lists and move checked files into the appropriate task; drafts and groups are saved in VS Code's workspace state.

### Branches and commit history

- Local and remote branches appear on the left. Click a branch to see its own history, starting at that branch head — a local branch never shows commits that only exist on its remote-tracking branch; double-click to check out, or right-click / use the ellipsis to open the branch menu. The top branch dropdown supports search and scrolls inside the list when the panel is short. Hovering a branch row reveals its actions menu while the first-level list stays visible; right-clicking also opens it. The fetch button in the branch header refreshes every remote branch (`git fetch --all --prune`) without changing any local branch.
- Local branches with an upstream show their difference from it in both the branch pane and the branch dropdown: `↑N` counts commits that are not pushed yet and `↓N` counts commits that are not pulled yet, matching IDEA's branch popup. The numbers come from `%(upstream:track)` in `git for-each-ref`, are measured against the remote-tracking branch from the last fetch, and never trigger network access. Branches in sync show no marker.
- The branch pane is flat by default: the checked-out branch is pinned first and marked with a check icon, bold name and its own branch color, the rest is sorted by branch name so updating or fast-forwarding a branch never moves its row; use the grouping button in its header to collapse branches by namespace prefix. `feature/ui/login` becomes a hierarchical `feature` → `ui` → `login` directory, with branch counts at each level and independently collapsible folders. The setting is remembered; remote branch grouping ignores remote-name prefixes such as `origin`, while search still matches the full branch name.
- The menu offers checkout, create and switch from a selected branch, compare with current, view history, fast-forward a non-current branch from its upstream, push a selected local branch, merge into current, rebase current onto the selected branch, rename, set upstream, copy name, and delete. The current branch additionally offers pull and push. Updating or pushing another branch never checks it out; if it has diverged from its upstream or the remote has new commits, the operation is rejected and both sides stay unchanged.
- Branch comparison shows commits unique to each side and changed files; files can be grouped by directory and collapsed, and the direction button swaps the compared branches. Click a file to review it in VS Code's native diff.
- Create branches from the current HEAD or a selected branch; checking out a remote branch creates a local tracking branch or reuses an existing local branch that already tracks it.
- Rebase requires a clean working tree; conflicts can be continued or aborted. Renaming changes only the local name and keeps the existing upstream setting.
- The commit graph is drawn from real parent-child relationships in topological order and supports searching messages, authors, and hashes. Merge commits carry a small "Merge" label before their subject in the list and in the details title.
- Select a commit to view its author, message, and file list; click a file to see its diff against the first parent.
- Right-click a commit to cherry-pick, revert, or hard reset the current branch; a hard reset first shows a native confirmation and discards tracked local changes.
- Local branches are deleted with Git's safe delete, which only allows merged, non-current branches. Deleting a remote branch shows a native confirmation and verifies that the remote commit hasn't changed.

### Sync and push

- **Fetch**: fetch all remotes and prune stale remote-tracking references.
- **Pull**: update the current branch using the configured strategy. Fast-forward only by default; if there are local changes, GitLoom asks you to commit or stash first.
- **Push**: first show the target remote branch and commits to push, then run a standard push. On first push, GitLoom defaults to `origin` or the only remote and sets the upstream.
- With multiple remotes and no `origin`, set the upstream from the branch menu. Pushing never forces.
- Uses your local Git credential helper, Git configuration, and SSH agent; no credentials or tokens are stored separately.

### Stash and conflicts

- Stash saves all local changes, including untracked files; view stashed file diffs, apply, apply and drop, or delete.
- Conflict files can open VS Code's three-way merge editor; save and mark them resolved.
- Unfinished merge, rebase, cherry-pick, and revert states show continue and abort actions.
- Reverting files, hard reset, deleting a stash or branch, rebase, revert, and abort show native confirmation prompts.
- The Git console shows the actual commands and results.

## Keyboard shortcuts

| Action                    | macOS             | Windows / Linux    |
| ------------------------- | ----------------- | ------------------ |
| Open commit window        | `Cmd+Alt+K`       | `Ctrl+Alt+K`       |
| Open commit history       | `Cmd+Alt+9`       | `Alt+9`            |
| Commit (workbench)        | `Cmd+Enter`       | `Ctrl+Enter`       |
| Commit & Push (workbench) | `Cmd+Shift+Enter` | `Ctrl+Shift+Enter` |
| Refresh (workbench)       | `Cmd+R`           | `Ctrl+R`           |
| Move through file lists   | `↑` / `↓`         | `↑` / `↓`          |
| Jump to first/last file   | `Home` / `End`    | `Home` / `End`     |
| Move through commits      | `↑` / `↓`         | `↑` / `↓`          |
| Jump to first/last commit | `Home` / `End`    | `Home` / `End`     |
| Close dialog              | `Esc`             | `Esc`              |

When a file list (changes, commit details, Stash, branch comparison) has focus, `↑` / `↓` move the selection one file at a time and `Home` / `End` jump to the first or last file; long lists scroll row by row instead of jumping. Arrows only move the selection and never open a diff (which would hand focus to the editor); press `Enter` or click to open one. The keys also work from checkboxes and folder rows, and regaining panel focus or pressing an arrow while the panel is unfocused continues from the selected file, including after clicking one with the mouse. The commit history works the same way: `↑` / `↓` / `Home` / `End` move the selected commit and load its details, while arrows go back to moving files once a row in the commit detail file list has focus.

## Settings

```json
{
  "gitWorkbench.diffTarget": "editor",
  "gitWorkbench.fileLayout": "tree",
  "gitWorkbench.historyLimit": 300,
  "gitWorkbench.pullStrategy": "ff-only"
}
```

`diffTarget` controls where file diffs open: `editor` (default) opens VS Code's native diff in the main editor, while `panel` keeps the inline diff inside the bottom panel. This applies to changes, commit history, and Stash files; in `editor` mode the panel does not reserve a diff column, and the diff button in the toolbar can temporarily switch to the inline diff. `fileLayout` controls how changed files and commit detail files are displayed: the default `tree` groups them by directory, while `flat` lists full paths; the grouping buttons in both toolbars update this setting. `historyLimit` accepts 50–2000; history filtering applies to loaded commits only. `pullStrategy` supports `ff-only`, `rebase`, and `merge`. The Git executable follows VS Code's `git.path`.

The Marketplace extension ID is `windlively.gitloom`. If you installed an early VSIX under `local-workbench.git-workbench`, uninstall the old ID before installing the Marketplace build; command and setting prefixes remain `gitWorkbench.*`, so existing settings continue to work.

## Development and verification

```sh
npm ci
npm run check
npm test
npm run build
```

Press `F5` in VS Code to launch the Extension Development Host. `npm run watch` rebuilds continuously, and `npm run dev` starts the interactive browser preview (`http://127.0.0.1:5173`, sample data, no repository on disk is touched).

```sh
npm run test:host
npm run package
```

Host tests default to macOS `/Applications/Visual Studio Code.app/Contents/MacOS/Code`. Set `VSCODE_EXECUTABLE_PATH` to use a different installation. Tests run in an isolated temporary repository and VS Code configuration directory, not your personal extensions directory.

`npm test` uses a real temporary repository and a local bare remote to verify selective commits, staging of selected files, preservation of staged content in unselected files, special file names, renames, branch grouping, branch creation from a specified start point, branch comparison and direction swapping, fast-forward updates and pushes of non-current branches, rebase, upstream settings, remote checkout and deletion, merges, conflict continue/abort, stash, fetch/pull/push, failing hooks, path boundaries, and size limits. Host tests cover activation, commands, the webview, message handling, changelist storage, push failure after commit, and native diff.

## Architecture

```text
src/extension.ts       VS Code lifecycle, repository discovery, message validation, native editors and confirmations
src/git/service.ts     Git subprocesses, repository operations, working tree and history diffs
src/git/parsers.ts     NUL-delimited Git output parsing
src/shared/types.ts    Message protocol shared by host and UI
webview/src/           React workbench, diff rendering, commit graph, and development preview
tests/                 Git integration tests, rendering algorithm tests, VS Code host tests
```

Git is invoked with separate arguments and literal path matching, never through a shell. The webview uses local resources and a content security policy; repository paths, commit IDs, stash refs, and message methods are validated in the host. Write operations are serialized per repository.

## Current scope

This is the installable 0.5.8 release covering the workflows above. IntelliJ IDEA's line/hunk-level commits, interactive rebase, shelf patches, blame, remote repository configuration UI, and dedicated Git LFS management are not implemented yet; submodules appear as file statuses without a dedicated management view.

Inline text preview is limited to 1 MB; native text diffs support up to 20 MB. Native comparison is not available for binary files in history. The workbench shows on-disk content; unsaved edits are saved before commit or stash. Auto-refresh runs every 8 seconds while the window is focused and the workbench is visible; saving files and focusing the window also refresh.

GitLoom is an independent implementation and is not affiliated with JetBrains.

## Feedback

Report issues and suggestions on [GitHub Issues](https://github.com/windlively/GitLoom/issues).

## Brand icon

GitLoom's logo is a branch graph: three ring-shaped commit nodes connected by low-opacity lines on a deep-purple rounded tile, with a lavender trunk node and a lime accent on the upper-right branch node. The source files are the [primary icon SVG](resources/gitloom.svg) and the [transparent-background SVG](resources/gitloom-mark.svg); the panel uses a [monochrome SVG](resources/git-workbench.svg) that follows the theme color, and the 128×128 Marketplace PNG is exported from the vector source. See the [icon guide](docs/branding/README.md) for sizes and usage.

## License

[MIT](LICENSE). The UI uses [Microsoft Codicons](https://github.com/microsoft/vscode-codicons), provided by Microsoft Corporation under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The icon font is unmodified, and its license is bundled at `resources/codicons-LICENSE.txt`.

## Interaction references

- [IntelliJ IDEA Git tutorial and workflows](https://www.jetbrains.com/help/idea/working-with-git-tutorial.html)
- [IntelliJ IDEA commit and push changes](https://www.jetbrains.com/help/idea/commit-and-push-changes.html)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
