# GitLoom 开发指南

本文件适用于整个仓库，供参与开发的编码助手使用。开始任务前阅读本文件、`README.md` 和相关实现；子目录若有更具体的 `AGENTS.md`，同时遵循其约定。用户当前任务与明确授权优先于本文中的默认工作方式。

## 产品定位与交互原则

GitLoom（织序）是 VS Code 扩展，借鉴 IntelliJ IDEA 的 Git 操作逻辑，让用户在查看代码的同时完成更改审查、提交、分支管理和同步。

- 主工作台位于 VS Code **底部面板**，与终端、输出、问题并列。不要把主工作台改回编辑器标签页、独立网页或单独应用。
- 主要流程是「本地更改 → Diff → 提交 → Push」，兼顾分支、提交历史、Stash 和冲突处理。
- 操作逻辑参考 IDEA；视觉遵循 VS Code 的主题、字体、密度和交互习惯。界面、命令、设置说明、错误和确认提示跟随 VS Code 显示语言：`zh-*` 使用简体中文，其他语言使用英文。新增用户可见文案必须同时提供中英文。
- 文件列表、Diff、提交框应能在低高度面板中同时使用。保留分栏拖动、宽度记忆和复位能力。
- 分支名称支持右键菜单；菜单项应根据当前分支、本地/远程分支、进行中的 Git 操作和忙碌状态正确启用或禁用。
- 错误必须可见、可理解；明确区分操作成功、操作失败、冲突和用户取消。不要把真实 Git 失败伪装成成功。

## 技术栈与目录

使用 TypeScript、React 19、CSS、Git CLI 和 VS Code API。esbuild 构建正式扩展，Vite 仅用于开发预览；依赖通过 npm 和 `package-lock.json` 管理。

| 位置                                         | 职责                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `package.json`                               | 扩展清单、面板与命令贡献、设置、依赖、开发脚本                           |
| `src/extension.ts`                           | 扩展生命周期、底部面板、仓库选择、消息分发、原生 Diff/合并入口、确认提示 |
| `src/git/service.ts`                         | Git 子进程、仓库查询、串行写操作、文件内容与路径校验                     |
| `src/git/parsers.ts`                         | Git 状态、分支、日志、Stash 等输出解析                                   |
| `src/shared/types.ts`                        | 宿主与 Webview 共用的数据类型及请求协议                                  |
| `src/shared/i18n.ts`                         | 宿主与 Webview 共用的中英文文案、语言归一化与占位符插值                  |
| `package.nls.json`、`package.nls.zh-cn.json` | 扩展清单的英文默认文案与简体中文翻译                                     |
| `webview/src/main.tsx`                       | 工作台视图、选中文件、草稿、异步加载及弹窗                               |
| `webview/src/bridge.ts`                      | 类型化消息调用、响应匹配、仓库上下文、界面状态持久化                     |
| `webview/src/i18n.ts`                        | Webview 语言检测与翻译入口（读取宿主注入的 `data-locale`）               |
| `webview/src/preview.ts`                     | 浏览器预览使用的示例数据和模拟请求                                       |
| `webview/src/preview-theme.ts`               | 仅开发预览使用的主题样例                                                 |
| `webview/src/styles.css`、`icons.tsx`        | 主题样式及 Microsoft Codicons 图标适配                                   |
| `webview/src/context-menu.tsx`、`resize.tsx` | 分支菜单、键盘操作与分栏调整                                             |
| `webview/src/diff.ts`、`graph.ts`            | 文本差异行对齐与提交图算法                                               |
| `webview/src/branch-groups.ts`               | 分支按命名空间前缀构建多层级目录，处理无前缀分支与远程名前缀             |
| `webview/src/file-groups.ts`                 | 更改文件与提交详情文件按目录构建多层级列表，合并单链前缀并统计文件数     |
| `webview/src/virtual.ts`                     | 文件列表与提交历史的虚拟滚动视口和可见范围计算                           |
| `tests/git.test.ts`、`diff.test.ts`          | 真实临时仓库集成测试和 Diff/提交图算法测试                               |
| `tests/branch-groups.test.ts`                | 分支前缀分组的本地、远程与多远程场景测试                                 |
| `tests/file-groups.test.ts`                  | 目录分组、单链前缀合并、计数与特殊文件路径测试                           |
| `tests/i18n.test.ts`                         | 语言归一化、插值、文案完整性与清单本地化测试                             |
| `tests/host.ts`、`scripts/test-host.mjs`     | 使用隔离配置启动 VS Code 的宿主集成测试                                  |
| `scripts/build.mjs`                          | 宿主、Webview、CSS 和字体打包                                            |
| `resources/`                                 | 扩展图标与第三方许可证                                                   |

`dist/`、`artifacts/`、`node_modules/` 和测试产物目录不提交。修改源文件后重新构建，不直接编辑生成的 JS、CSS 或 VSIX。

## 命名与兼容性

对外项目名和插件显示名是 **GitLoom**，商店扩展 ID 为 `windlively.gitloom`（npm 包名 `gitloom`，publisher `windlively`）。早期本地 VSIX 使用过 `local-workbench.git-workbench`，商店版本不沿用该 ID。下列内部标识为兼容已保存设置和恢复中的面板而保留，不要仅因品牌更名而重命名：

- 面板容器：`gitWorkbench`；视图 ID：`gitWorkbench.workbench`。
- 命令和设置前缀：`gitWorkbench.*`。
- 内容提供器 scheme：`git-workbench-preview`。
- Webview 界面状态键：`git-workbench-ui`。

修改这些标识、持久化状态结构或消息协议时，需要考虑现有安装、已保存设置和恢复中的面板，并提供兼容读取或迁移方案。

## Git 操作必须保留的行为

- 所有仓库操作通过 `GitService` 实现。使用 `spawn` 和独立参数数组调用 Git，不拼接 shell 命令，不启用 `shell: true`。
- 按仓库通过 `serialize()` 串行执行写操作。失败不能阻塞后续操作，也不要在一个串行写操作内部等待另一个串行写操作。
- 在宿主校验文件路径、分支、提交 ID、Stash 引用及仓库上下文。不能仅依赖前端隐藏按钮或 TypeScript 类型。
- 保留 `validatePath()` / `safePath()` 的路径边界和符号链接检查。处理删除、重命名和历史文件时，也要检查旧路径及父目录。
- 文件路径应按字面值处理，支持空格、中文、换行、前导连字符及 Git pathspec 特殊字符。解析相应 Git 输出时使用 NUL 分隔，不能按普通行切分文件名。
- **不要全局给 Git 命令添加 `--literal-pathspecs`。** 现有实现只用于适用的文件命令；全局应用到 Stash 会破坏其内部路径处理，可能导致保存后未跟踪文件没有清理。
- 提交仅包含勾选文件的全部工作区改动，保留其他文件的暂存内容；不要简化成全仓库 `git add .` 或普通全量提交。重命名须正确处理新旧路径。
- 提交或 Stash 前保存文件。若本地提交成功、随后 Push 失败，必须保留提交结果并单独报告推送失败，避免用户重复提交。
- Pull 默认仅快进，并检查上游与本地更改。推送须使用明确的远程和目标引用；预览目标与实际目标保持一致。
- 本地分支采用安全删除；删除远程分支保留原生确认和预期提交校验。不要自动升级为强制删除或强制推送。
- Rebase 前检查工作区及未结束的 Git 操作。合并、Rebase、Cherry-pick、Revert 冲突状态在标记文件已解决后仍须支持继续或中止。
- 保留现有回滚、删除、Rebase、Revert 和中止操作的原生确认；新增可能丢失用户数据的操作应遵循相同交互。
- 沿用本机 Git 配置、凭据助手和 SSH Agent。不要在源代码、界面状态、测试夹具或日志中保存凭据。
- Git 服务设有超时和输出大小限制；扩展大文件或网络功能时保留资源限制。当前内嵌 Diff 为 1 MB，原生文本 Diff 为 20 MB；二进制和超限文件应显示明确状态。

## 宿主与 Webview 的职责边界

Webview 通过消息协议请求操作；文件系统、Git CLI、VS Code API 和原生确认由宿主处理。

新增或修改请求时，同步检查以下位置：

1. 在 `src/shared/types.ts` 的 `Requests` 中声明参数和返回值。
2. 在 `src/extension.ts` 的 `METHODS` 中注册，在 `dispatch()` 中校验参数并分发；只有不修改仓库的请求才可归入 `READ_ONLY`，写操作保留工作区信任检查。
3. 在 `GitService` 或宿主相应层实现，写操作遵守串行执行与失败刷新规则。
4. 在 Webview 中通过 `request()` 调用，处理加载、禁用、成功、失败和取消状态。
5. 在 `preview.ts` 中补齐相关模拟行为，并为真实实现选择合适的测试。

- 浏览器预览与真实仓库操作必须分离，不能用模拟结果替代正式扩展的 Git 调用。
- 保留仓库切换校验及异步请求过期保护，防止旧仓库的响应覆盖当前界面或修改错误仓库。
- 面板 focus 命令可能早于 Webview 创建和消息就绪；保持现有等待与待发送动作机制，避免首次打开时丢失视图切换或 Push 弹窗。
- 保持 Webview CSP 和本地资源限制，不引入远程脚本、字体或不必要的宽泛权限。
- 原生 Diff 使用的虚拟文档需在标签页关闭时清理，并在打开期间保留内容。
- 持久化读取要兼容缺少新增字段的旧状态；刷新、隐藏和重新显示面板不能丢失草稿、视图及分栏设置。

## 界面开发规范

- 优先使用 `--vscode-*` 主题变量及现有 CSS 变量。避免写死主题颜色；主题样例只放在开发预览中。
- 图标通过 `icons.tsx` 复用 Codicons；保留本地字体打包、CSP 字体许可和第三方授权文件。
- 保持紧凑密度：当前文件行高 22px、提交图行高由 `COMMIT_ROW_HEIGHT` 统一定义。修改行高时同步图节点、边和列表布局。
- 避免用宽泛的 `span` 选择器布局文本，以免误作用于图标。为文本、图标和按钮使用明确的类名。
- 分栏应有合理最小宽度、鼠标拖动、键盘调整和默认值复位。窄面板保留可达的分支操作入口。
- 菜单和弹窗应限制在可见区域内，超出高度时内部滚动，长分支名和文件名不能挤掉操作按钮。
- 可交互元素提供准确的名称与语义；图标按钮有 `aria-label`，键盘能导航菜单，弹窗管理焦点并支持 Esc。
- 用户可见文案统一通过 `translate()` / `t()` 输出，不要硬编码中文或英文。英文文案作为 `src/shared/i18n.ts` 的键，中文放入 `zhCN`；清单文案同步更新 `package.nls.json` 与 `package.nls.zh-cn.json`。
- Webview 语言由宿主通过 `<body data-locale>` 注入；开发预览用 `?lang=zh-cn` / `?lang=en` 检查两种语言。宿主测试以 `--locale=en` 运行，涉及中文错误的断言通过给 `GitService` 传入 `'zh-cn'` 覆盖。
- UI 改动至少检查深色、浅色、高对比度主题，以及约 `1200×320`、`700×240` 的面板尺寸；不要只验证大窗口截图。

## 常用命令与验证范围

从仓库根目录执行；推荐使用 Node.js 22 和 npm。VS Code 最低版本以 `package.json` 的 `engines.vscode` 为准，不因开发机安装了新版就使用未经兼容检查的新 API。

| 命令                | 用途                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `npm ci`            | 按锁文件安装依赖；已有可用依赖时无需每次重装                       |
| `npm run check`     | 检查宿主和 Webview 两套 TypeScript 配置                            |
| `npm test`          | 使用真实临时 Git 仓库及本地 bare 远程运行算法和 Git 集成测试       |
| `npm run build`     | 生成 `dist/extension.cjs`、Webview 及本地字体资源                  |
| `npm run watch`     | 持续构建，配合 VS Code F5 扩展开发宿主                             |
| `npm run dev`       | 在 `http://127.0.0.1:5173` 预览示例数据，不验证真实 Git 或面板贡献 |
| `npm run test:host` | 在隔离配置中运行 VS Code 宿主测试；先执行 `npm run build`          |
| `npm run package`   | 类型检查、构建并打包 VSIX；首次打包先 `mkdir -p artifacts`         |

宿主测试默认使用 macOS 的 `/Applications/Visual Studio Code.app/Contents/MacOS/Code`，其他位置通过 `VSCODE_EXECUTABLE_PATH` 指定。不要改成使用用户的日常配置目录、个人扩展目录或真实业务仓库来运行测试。

按改动选择验证，不机械重复全部检查：

- Git、解析器、Diff 或提交图逻辑：运行类型检查和相关自动化测试；新增行为或修复回归应覆盖真实边界情况。
- 面板贡献、命令、消息分发、原生 Diff 或生命周期：类型检查、构建，并运行宿主测试。
- 布局、菜单、弹窗或持久化：类型检查、构建并实际交互检查；浏览器预览通过不代表宿主集成通过。
- 纯文档改动：核对路径、脚本和描述并检查 Markdown 格式，无需重跑 Git 集成测试。

测试只能操作临时仓库，覆盖用户可观察的结果，尤其关注未选暂存内容、特殊文件名、重命名、冲突及失败恢复。不要为简单样式变更堆叠只重复实现细节的测试。

## 代码风格、交付与维护

- TypeScript 保持严格类型，优先复用共享类型，不用宽泛的 `any` 或吞掉异常来绕过检查。
- 按现有职责划分修改代码；通用菜单、分栏、算法或复杂状态逻辑可提取为独立模块，避免继续扩张 `main.tsx`。
- 格式以 `.prettierrc.json` 为准：单引号、110 列、尾随逗号；仅格式化本次相关文件。
- 开始前检查 `git status`，保留用户已有改动。提交、推送、安装和发布按当前任务与已有授权执行，不因完成代码修改就自动扩展到发布流程。
- 有用户可见的功能或行为变化时更新 `README.md`、`CHANGELOG.md`。发版时同步 `package.json`、锁文件根包版本、打包路径和安装文档；不要仅为普通文档修改发版。
- 新增运行时依赖或资源时检查 esbuild 构建与 `.vscodeignore`；VSIX 需包含正式运行资源，不依赖开发机上的源文件、`node_modules` 或绝对路径。
- 保留 Codicons 授权说明和 `resources/codicons-LICENSE.txt`；不要把开发指南写成对 JetBrains 官方关联的声明。
- 最终交付说明实际改了什么、验证了什么、还有哪些限制。区分“已构建”“已打包”“已安装”和“已推送”，不能把未执行的步骤写成完成。
