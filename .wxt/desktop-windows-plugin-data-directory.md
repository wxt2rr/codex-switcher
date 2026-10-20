# Desktop-Windows-Plugin-Data-Directory

## Goal
- 修复 Windows 打包版安装 Provider 插件时因旧共享目录不可写导致的 EPERM，并保证桌面主进程与 Gateway 子进程使用同一可写目录。

## Why Complex
- 涉及 Electron 主进程、Provider 插件运行时和 Gateway 子进程三个职责边界，需要保持已安装插件的运行时数据路径一致。

## Scope
- 相关模块/类：Electron 启动初始化、ProviderPluginManager 初始化、Gateway usage router 初始化。
- 相关文件：`apps/desktop/electron/main.ts`、`apps/desktop/electron/provider-plugin-runtime.ts`、`apps/desktop/electron/usage-router-service.ts`。
- 兼容要求：保留非 Windows 行为；不覆盖当前未提交的安装进度 UI 改动。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 统一解析 Windows Provider 插件数据目录，避免首次写入旧 stateDir | provider runtime / main / usage router | `npm run desktop:build` | done | 主进程设置 `CODEX_SWITCHER_PLUGIN_DATA_DIR`，桌面运行时与 usage router 都使用该目录；非 Windows 仍使用原 stateDir |
| 2 | 编译桌面产物并检查打包运行时包含新路径逻辑 | desktop build artifacts | `npm run desktop:build` | done | 第二次编译成功；产物保留非 Windows stateDir 行为并包含统一 Windows 目录解析 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
