# Claude Code 自动同步代理

## Goal
- Claude Code 插件连接账号时，自动读取 Switcher 当前代理并写入 Claude Code 的 `settings.json`。
- 代理关闭或切换时，清理上一轮由 Switcher 管理的代理字段，同时保留配置快照与回滚能力。

## Why Complex
- 改动跨桌面连接流程、Agent 配置适配器契约和单元测试，且需要兼容已有绑定快照。

## Scope
- 相关模块/类：Claude Code 连接流程、通用 Agent adapter binding、Claude Code 配置纯函数。
- 相关文件：`apps/desktop/electron/bridge.ts`、`apps/desktop/electron/claude-code-connection.ts`、`packages/gateway/src/agent/contracts.ts`、`packages/gateway/src/agent/adapter.ts` 及对应测试。
- 兼容要求：只把 HTTP/HTTPS 代理写入 Claude Code；SOCKS 代理不写入；关闭代理时移除 Switcher 管理的三个代理字段；不改变其它 Agent 的现有行为。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 增加 Claude Code 代理配置纯函数与 adapter 的动态清理能力 | `claude-code-connection.ts`, `contracts.ts`, `adapter.ts` | 单元测试覆盖 HTTP/HTTPS、SOCKS、关闭代理和清理路径 | done | `npx tsx --test packages/gateway/src/agent/adapter.test.ts apps/desktop/electron/claude-code-connection.test.ts`：21 项全部通过 |
| 2 | 在 Claude Code 连接/重连流程读取 Switcher 代理并应用 | `bridge.ts` | desktop 测试、配置历史行为检查 | done | `connectClaudeCode()`/`reapplyClaudeCode()` 通过共享流程读取代理并传给 adapter；代理开关变化会触发已连接 Claude 重应用；仅清理由 Switcher 上次写入的代理 |
| 3 | 构建并运行完整相关验证 | desktop/gateway build/test | 测试与构建通过 | done | `npm run desktop:test`：632 项（631 pass/1 skip）；最终相关单测通过；`npm run desktop:build`：通过；`git diff --check`：通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
