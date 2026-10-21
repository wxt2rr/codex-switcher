# desktop-Windows App 自动检测与启动路径

## Goal
- 修复 Windows 上 Codex MSIX AppID 自动检测失败，以及检测成功后启动时报 `spawn explorer.exe ENOENT` 的问题。
- 兼容 Electron 在 Windows 中的 `Path`/`PATH` 环境变量差异，不要求用户手动修改系统 PATH。

## Why Complex
- 改动跨 Core 的 App 启动、Desktop 的工具路径探测和 Electron 桥接运行环境。
- 需要同时覆盖自动检测、AppID 启动、普通 exe 启动和 CLI 验证。

## Scope
- 相关模块/类：Codex App 启动规格、Windows 工具路径探测、桌面有效运行环境。
- 相关文件：`packages/core/src/platform/codex-app.ts`、`packages/core/src/platform/codex-app.test.ts`、`apps/desktop/electron/codex-tool-paths.ts`、`apps/desktop/electron/codex-tool-paths.test.ts`。
- 兼容要求：保留现有 AppID 格式和普通 exe 启动方式；macOS/Linux 行为不变。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 统一 Windows 环境变量并补齐系统工具路径 | `apps/desktop/electron/codex-tool-paths.ts` | 工具路径单测 | complete | `npx tsx --test electron/codex-tool-paths.test.ts`：18 passed |
| 2 | 使用 Windows 系统启动器绝对路径启动 AppID / exe | `packages/core/src/platform/codex-app.ts` | Core App 启动单测 | complete | `npx tsx --test src/platform/codex-app.test.ts`：18 passed |
| 3 | 更新版本说明和桌面版本 | `apps/desktop/package.json`, `package-lock.json`, `.github/release-notes/` | 构建检查 | complete | `apps/desktop` 版本更新为 0.1.72，新增发布说明 |
| 4 | 运行完整验证、提交推送并发布 | GitHub Actions | CI 全平台打包和 Release 资产 | todo |  |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
