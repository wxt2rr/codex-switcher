# 桌面更新-GitHub下载安装闭环

## Goal
- 让已发布的桌面应用可以从 GitHub Release 检查新版本、下载对应平台安装包、校验完整性，并按平台提供安装/重启动作。
- 无签名环境下不虚报 macOS 静默自动安装；保留下载后人工确认路径。

## Why Complex
- 跨 Electron 主进程、更新控制器、GitHub Release 元数据、平台安装器、回滚和设置页，预计修改超过 4 个模块且超过 150 行。

## Scope
- 相关模块/类：桌面更新控制器、GitHub 更新清单客户端、平台更新助手、主进程 IPC、设置页、发布工作流。
- 相关文件：`apps/desktop/electron/auto-update.ts`、`apps/desktop/electron/main.ts`、`apps/desktop/electron/update-*`、`apps/desktop/src/bridge.ts`、`apps/desktop/src/react-app.tsx`、`apps/desktop/src/pages/operations-page.tsx`、`.github/workflows/desktop-package.yml`、桌面测试。
- 兼容要求：保留已有 `CODEX_SWITCHER_UPDATE_FEED_URL` 测试入口、已有更新清单签名校验和回滚机制；不触碰现有未跟踪构建产物。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 锁定更新清单、平台能力和安装状态契约 | `update-security.ts`, `auto-update.ts` | `npx tsx --test apps/desktop/electron/auto-update.test.ts` | done | 新增 `DesktopUpdateIndex`、平台资产、下载中/安装中/手动安装状态；9 项既有自动更新测试全部通过 |
| 2 | 实现 GitHub Release 清单获取、版本比较、下载进度和校验 | `github-update.ts`, `update-security.ts`, `auto-update.ts` | 下载/校验/错误单测 | done | `github-update.test.ts` 3 项通过；支持 `latest.json`、平台筛选、SHA-256 校验 |
| 3 | 实现平台安装策略与外部 updater helper | `electron/update-*`, `main.ts` | macOS/Windows/Linux 策略单测和打包检查 | done | `update-installer.test.ts` 3 项通过；Windows NSIS/Linux AppImage 自动安装，macOS 无签名手动安装 |
| 4 | 接入 IPC、设置页状态、手动检查/安装/重启交互 | `bridge.ts`, `react-app.tsx`, `operations-page.tsx` | UI 源码测试、构建 | done | IPC 保持兼容；设置页展示下载进度/安装模式；Electron/Web 类型检查和桌面构建通过 |
| 5 | 修复发布工作流，发布 GitHub update manifest 和资产 | `.github/workflows/desktop-package.yml`, scripts | workflow 静态测试、清单验证 | done | `create-update-index.test.mjs`、`desktop-package-workflow.test.ts` 通过；始终生成 HTTPS+SHA256 `latest.json` |
| 6 | 完成回滚、启动健康检查和端到端验收 | 更新模块、桌面测试 | `npm run desktop:test`, `npm run desktop:build` | done | 旧 feed/签名 manifest/回滚保持兼容；桌面测试 450 通过、1 跳过；跨平台测试 162+93+35 通过；桌面构建通过；`git diff --check` 通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- macOS 未签名时只允许“下载并打开安装包/手动安装”能力，不承诺静默覆盖安装。
- Windows NSIS 不继续使用 Electron 内置 Squirrel updater 作为正式路径；安装动作通过独立安装器进程完成。
- Linux 不宣称 Electron 内置自动更新；AppImage 与 deb 使用不同策略。
- 更新包必须先通过清单签名和 SHA-256 校验，再允许安装。
