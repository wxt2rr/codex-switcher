# 桌面 Codex GUI Node PATH 修复

## Goal
- 修复从下载的 macOS App 直接启动时，执行 `/opt/homebrew/bin/codex` 因 GUI PATH 缺少 Node 而失败的问题。
- 让 Codex CLI 的模型发现、登录、令牌刷新和其他桌面端执行路径使用一致且可诊断的运行环境。

## Why Complex
- 改动跨桌面命令发现、模型目录同步和 Electron 主进程执行路径，且需要覆盖打包应用的 GUI 启动场景。

## Scope
- 相关模块：Codex 工具路径解析、Codex CLI 运行环境、模型目录发现、Electron 主进程命令执行。
- 相关文件：`apps/desktop/electron/codex-tool-paths.ts`、`apps/desktop/electron/account-model-catalog.ts`、`apps/desktop/electron/bridge.ts`、对应测试和发布版本文件。
- 兼容要求：保留现有手动 Codex 路径、PATH 自动发现、Windows `.cmd` 执行和未签名 macOS 安装流程；不修改无关的未跟踪构建产物。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 定义并测试 GUI 启动下的 Codex 执行 PATH 合并策略 | `codex-tool-paths.ts`, tests | Codex 工具路径单测 | done | 新增 `buildCodexExecutionEnvironment`；覆盖绝对 CLI 目录、macOS Homebrew/用户 Node 目录和原 PATH 保留；工具路径单测通过 |
| 2 | 将模型发现及桌面端 Codex 命令统一接入该运行环境 | `account-model-catalog.ts`, `bridge.ts` | 桌面单测、类型检查 | done | 模型目录调用、CLI 登录、终端执行、令牌刷新已接入；真实受限 PATH 模型发现解析 8 个模型；桌面全量测试 452 通过、1 跳过；生产构建通过 |
| 3 | 打包验证、版本发布并验收下载版启动 | package scripts, release workflow | desktop build/test、GitHub Actions、清单校验 | done | 本地 arm64/x64 目录包通过 `package:verify`；`desktop-v0.1.45` 的 Windows 测试失败原因已定位为新增测试使用 POSIX 固定路径 |
| 4 | 修正跨平台回归测试并重新发布 | `codex-tool-paths.test.ts`, release version files | Windows desktop test、Actions、Release manifest | in_progress | 测试已改为按宿主平台构造路径；待升版、推送新标签并验收 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 只补齐命令运行环境，不改变模型、网关或账号业务逻辑。
- 不把开发机绝对路径打包进应用；绝对路径只作为运行时检测结果使用。
