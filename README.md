# GitLoom · 织序

**在 VS Code 底部面板里完成「更改 → Diff → 提交 → 推送」。** 像 IntelliJ IDEA 的 Git 工具窗口一样紧凑，同时完全沿用 VS Code 的主题、字体与面板习惯。

GitLoom is a compact Git workbench for VS Code's bottom panel: review changes with inline diff, stage selected files, commit, browse history and manage branches without leaving the editor.

## 安装

需要 VS Code 1.96+ 和已安装的 Git。

- **扩展市场**：在扩展视图搜索 **GitLoom**，或运行 `code --install-extension windlively.gitloom`。
- **离线安装**：运行 `code --install-extension <文件>.vsix`，或在扩展面板 `…` 菜单中选择 **从 VSIX 安装…**。

打开一个 Git 项目，点击终端旁边的 **GitLoom** 标签，或运行命令 **GitLoom: 打开 Git 工作台**。也可以点击状态栏入口。

## 界面

更改列表与内嵌 Diff（深色主题）：

![GitLoom 更改列表、内嵌 Diff 与提交框](https://raw.githubusercontent.com/windlively/GitLoom/main/docs/screenshots/changes-dark.png)

提交历史、提交图与提交详情（浅色主题）：

![GitLoom 提交历史与提交详情](https://raw.githubusercontent.com/windlively/GitLoom/main/docs/screenshots/history-light.png)

工作台使用 VS Code 原生面板容器，打开时不创建编辑器标签页。可以拖动面板上边缘调整高度，使用 VS Code 面板的最大化、收起和关闭按钮，也可以用 `Cmd+J` / `Ctrl+J` 显示或隐藏底部面板。切换到终端再切回时保留工作台和提交草稿。

底部采用紧凑布局：顶部为仓库、分支、Git 视图与同步操作；文件列表、内嵌 Diff、提交框按列排列。分支栏、文件列表、提交栏、历史详情、Stash 列表和左右 Diff 均可拖动边界调整宽度，并记住设置。双击边界恢复默认；聚焦边界后按左右方向键可微调，Shift + 方向键每次调整 40px。窄窗口通过顶部分支选择器管理分支。

分支选择、推送预览等对话框可通过标题栏拖动位置，拖动边缘或四角调整大小；双击标题栏恢复默认位置和大小，关闭后再次打开会沿用上次的尺寸。

界面按 VS Code 原生组件风格呈现，实时沿用主题提供的面板、列表、输入框、按钮、悬停、选中与焦点颜色，字体跟随 VS Code 设置，Diff 跟随编辑器字体。仓库选择、历史筛选和上游分支使用自绘下拉菜单，支持方向键、Home/End 与首字母定位。提交图采用与 VS Code 源码管理视图一致的紧凑泳道、圆角连线和节点样式。文件行高 22px、提交历史行高 24px，使用官方 Codicons，浅色、深色和高对比度主题均可使用。大量文件和提交采用虚拟滚动，列表只渲染可见行。

## 日常工作流

### 本地更改与提交

- 按更改列表组织文件，单独展示未版本化文件和合并冲突。
- 勾选文件或整个更改列表，单击文件审查双栏 Diff。
- 文件行支持 IDEA 式选择：单击选中，`Shift` 连选，`Cmd` / `Ctrl` 切换多选。右键多选文件可 **添加到 Git** 暂存到索引，或直接 **提交所选文件**。行选择与提交复选框相互独立。
- 已暂存和部分暂存的文件会显示状态徽标；暂存只影响所选文件，其他未选更改保持不变。
- Diff 支持语法着色、增删行、行号、上下文筛选、统一视图、同步纵向滚动和独立横向滚动。
- 填写说明，点击 **提交** 或 **提交并推送**。提交前会保存已有文件。
- 提交包含勾选文件的**全部工作区改动**。未勾选的暂存文件会保留在暂存区。
- 提交钩子失败时保留说明并显示 Git 错误；本地提交成功但推送失败时，会明确提示“本地提交已完成”，可单独重试 Push。
- 可新建更改列表，并把勾选文件移动到相应任务中；草稿和分组保存在 VS Code 的工作区状态中。

### 分支与提交历史

- 左侧显示本地与远程分支。单击筛选历史，双击检出；右键或省略号打开分支菜单。顶部分支下拉列表可搜索分支，低高度时在列表内滚动。悬停分支行会自动展开操作菜单，一级列表保持显示；右键也可直接打开。
- 分支栏默认平铺，可点击标题栏的分组按钮按命名空间前缀逐级折叠查看。`feature/ui/login` 会形成 `feature` → `ui` → `login` 的多层级目录，每层显示包含的分支数，可独立折叠。设置会被记住；远程分支分组时忽略 `origin` 等远程名前缀，搜索仍匹配完整分支名。
- 菜单提供检出、从指定分支新建并切换、与当前比较、查看历史、合并到当前、将当前 Rebase 到所选分支、重命名、上游设置、复制名称和删除。当前分支额外提供拉取及推送。
- 分支比较展示双方独有提交数量和差异文件，点击文件在 VS Code 原生 Diff 中审查。
- 新建分支可从当前 HEAD 或选中分支创建；检出远程分支会建立本地跟踪分支，或复用已经跟踪它的本地分支。
- Rebase 前要求工作区干净；发生冲突可继续或中止。重命名只更改本地名称，保留已有上游设置。
- 提交图按真实父子关系与拓扑顺序绘制，支持搜索说明、作者、Hash。
- 选择提交查看作者、说明和文件清单；单击文件查看相对第一父提交的差异。
- 右键提交可优选（Cherry-pick）、还原（Revert）或强制重置当前分支；强制重置会先弹出原生确认，丢弃已跟踪的本地改动。
- 删除本地分支使用 Git 的安全删除，仅允许删除已合并的非当前分支。删除远程分支会弹出原生确认，并校验远程提交未变化。

### 同步与推送

- **Fetch**：获取所有远程更新并清理失效的远程引用。
- **Pull**：按配置更新当前分支。默认仅允许快进；有本地改动时提示先提交或 Stash。
- **Push**：先展示目标远程分支和待推送提交，再执行标准推送。首次推送默认选择 `origin`，或唯一的远程仓库，并建立上游。
- 多个远程且没有 `origin` 时，可在分支菜单中设置上游。推送提交不会执行强制推送。
- 使用本机 Git 的凭据助手、Git 配置和 SSH Agent，不额外保存账号或令牌。

### Stash 与冲突

- Stash 保存全部本地更改，包含未跟踪文件；可查看暂存文件差异、应用、应用并移除或删除。
- 冲突文件可打开 VS Code 三方合并编辑器，保存后标记为已解决。
- 合并、Rebase、Cherry-pick、Revert 的未完成状态会显示继续与中止操作。
- 回滚文件、强制重置、删除 Stash、删除分支、Rebase、Revert 和中止操作有原生确认提示。
- Git 控制台显示实际执行的命令和结果。

## 快捷键

| 操作                   | macOS             | Windows / Linux    |
| ---------------------- | ----------------- | ------------------ |
| 打开提交窗口           | `Cmd+Alt+K`       | `Ctrl+Alt+K`       |
| 打开提交历史           | `Cmd+Alt+9`       | `Alt+9`            |
| 提交（工作台内）       | `Cmd+Enter`       | `Ctrl+Enter`       |
| 提交并推送（工作台内） | `Cmd+Shift+Enter` | `Ctrl+Shift+Enter` |
| 刷新（工作台内）       | `Cmd+R`           | `Ctrl+R`           |
| 关闭对话框             | `Esc`             | `Esc`              |

## 设置

```json
{
  "gitWorkbench.historyLimit": 300,
  "gitWorkbench.pullStrategy": "ff-only"
}
```

`historyLimit` 支持 50–2000；历史筛选只针对已加载的提交。`pullStrategy` 支持 `ff-only`、`rebase`、`merge`。Git 可执行文件沿用 VS Code 的 `git.path`。

商店版本的扩展 ID 为 `windlively.gitloom`。早期以 VSIX 安装过 `local-workbench.git-workbench` 的用户，建议先卸载旧 ID 再安装商店版本；命令与设置前缀仍保留 `gitWorkbench.*`，原有设置继续生效。

## 开发与验证

```sh
npm ci
npm run check
npm test
npm run build
```

在 VS Code 中按 `F5` 启动扩展开发宿主。`npm run watch` 持续构建，`npm run dev` 启动浏览器交互预览（`http://127.0.0.1:5173`，示例数据，不操作磁盘上的仓库）。

```sh
npm run test:host
npm run package
```

宿主测试默认使用 macOS `/Applications/Visual Studio Code.app/Contents/MacOS/Code`。其他安装位置可用环境变量 `VSCODE_EXECUTABLE_PATH` 指定可执行文件。测试会在独立临时仓库和 VS Code 配置目录中运行，不使用个人扩展目录。

`npm test` 使用真实临时仓库及本地 bare 远程仓库，验证选择性提交、所选文件暂存、未选暂存内容保留、特殊文件名、重命名、分支分组、指定起点创建分支、分支比较、Rebase、上游设置、远程检出与删除、合并、冲突继续/中止、Stash、Fetch/Pull/Push、失败钩子、路径边界和大小限制。宿主测试覆盖激活、命令、Webview、消息处理、更改列表存储、提交后推送失败和原生 Diff。

## 实现结构

```text
src/extension.ts       VS Code 生命周期、仓库发现、消息校验、原生编辑器与确认提示
src/git/service.ts     Git 子进程、仓库操作、工作区与历史差异
src/git/parsers.ts     NUL 分隔的 Git 输出解析
src/shared/types.ts    宿主与界面的消息协议
webview/src/           React 工作台、差异渲染、提交图与开发预览
tests/                Git 集成测试、渲染算法测试、VS Code 宿主测试
```

Git 使用独立参数调用，文件路径使用字面路径匹配，不经过 shell。Webview 使用本地资源与内容安全策略；仓库路径、提交 ID、Stash 引用与消息方法均在宿主校验。写操作按仓库串行执行。

## 当前边界

这是可安装的 0.5.4 版本，覆盖上述日常流程。尚未实现 IDEA 的逐行/逐块提交、交互式 Rebase、Shelf 补丁、Blame、远程仓库配置界面和 Git LFS 专用管理；子模块以文件状态展示，不提供独立管理视图。

内嵌文本预览限制 1 MB；原生文本 Diff 最多 20 MB。历史二进制文件不提供原生比较。工作台展示磁盘内容，未保存的编辑在提交或 Stash 前保存。自动刷新在窗口聚焦且工作台可见时每 8 秒运行，保存文件和重新聚焦窗口也会刷新。

GitLoom 为独立实现，与 JetBrains 无关联。

## 反馈

问题与建议请提交到 [GitHub Issues](https://github.com/windlively/GitLoom/issues)。

## 品牌图标

GitLoom 的标志是一幅分支图：深紫圆角底板上，三个环形提交节点由低透明度连接线串起，主干节点为薰衣草色，右上的分支节点用青柠色强调。设计源文件为 [主图标 SVG](resources/gitloom.svg) 和 [透明底 SVG](resources/gitloom-mark.svg)；面板使用随主题着色的 [单色 SVG](resources/git-workbench.svg)，128×128 商店 PNG 从矢量源导出。尺寸与使用方式见 [图标说明](docs/branding/README.md)。

## 许可证

[MIT](LICENSE)。界面使用 [Microsoft Codicons](https://github.com/microsoft/vscode-codicons)，由 Microsoft Corporation 提供，按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 授权。图标字体未修改，许可证随包附于 `resources/codicons-LICENSE.txt`。

## 交互参考

- [IntelliJ IDEA Git 入门与工作流](https://www.jetbrains.com/help/idea/working-with-git-tutorial.html)
- [IntelliJ IDEA 提交与推送](https://www.jetbrains.com/help/idea/commit-and-push-changes.html)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
