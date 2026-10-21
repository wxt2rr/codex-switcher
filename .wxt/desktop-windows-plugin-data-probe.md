# Desktop-Windows-Plugin-Data-Probe

## Goal
- 修复 Windows 机器对 AppData 目录拒绝写入时 Provider 插件仍安装失败的问题。

## Why Complex
- 需要在桌面主进程和独立 Gateway 子进程中选择同一可写目录，并兼容已有的插件数据目录回退机制。

## Scope
- 相关模块/类：Provider 插件数据目录解析、Windows Electron 启动环境、Gateway usage router。
- 相关文件：`apps/desktop/electron/provider-plugin-runtime.ts`、`apps/desktop/electron/usage-router-service.ts`、`apps/desktop/package.json`、`package-lock.json`、发布说明。
- 兼容要求：非 Windows 继续使用原 stateDir；Windows 优先持久化应用目录，必要时回退到 LocalAppData，再回退到系统临时目录。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 增加 Windows 可写目录探测并统一进程环境 | provider runtime / usage router | `npm run desktop:build` | done | v0.1.69 在 AppData\Roaming 仍收到 EPERM；新逻辑探测应用目录、LocalAppData 和 temp，并共享最终路径 |
| 2 | 升级版本并发布 Windows 修复版本 | package metadata / release workflow | GitHub Actions desktop-package | in_progress | 准备发布 `desktop-v0.1.70` |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
