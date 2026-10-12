# desktop-auto-update-notification

## Goal
- 将桌面应用自动更新检查频率调整为每小时一次。
- 检测到已下载的新版本后，在右下角显示可操作的小弹框，支持立即更新和跳过当前版本。

## Why Complex
- 跨 Electron 更新调度、更新状态桥接、React 全局状态和桌面壳层四个职责。

## Scope
- 相关模块/类：桌面更新调度、自动更新状态、React App、DesktopShell。
- 相关文件：`apps/desktop/electron/main.ts`、`apps/desktop/src/react-app.tsx`、`apps/desktop/src/components/desktop-shell.tsx`，必要时新增更新提示组件。
- 兼容要求：保留设置页现有检查与安装入口；跳过只记录当前版本，不影响后续版本提示；预览模式不显示更新提示。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 将 Electron 自动检查周期改为 1 小时，并让 React 在所有页面同步更新状态 | `main.ts`, `react-app.tsx` | TypeScript/桌面构建 | done | 主进程间隔改为 `60 * 60 * 1000`；React 全局每 5 秒读取更新状态。 |
| 2 | 增加右下角新版本提示，支持立即更新、跳过当前版本和关闭 | `desktop-shell.tsx`, `react-app.tsx` | TypeScript/桌面构建 | done | 新增右下角提示；立即更新复用现有安装入口；跳过版本持久化到 localStorage。 |
| 3 | 回写清单并检查工作区差异 | `.wxt/desktop-auto-update-notification.md` | `git diff --check`、桌面构建 | done | `git diff --check` 通过；`npm run desktop:build` 通过。 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
