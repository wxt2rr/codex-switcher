# Claude Code 授权与 Responses 工具结果修复

## Goal
- 补齐 Claude Code 授权来源检测，避免 OAuth、环境变量和 apiKeyHelper 与 API Key 并存。
- 修复 Anthropic `tool_result.is_error` 被错误发送到 Responses 上游的问题。

## Why Complex
- 改动跨 Electron 主进程授权检测、Claude Code 配置面板、Gateway 请求转换和测试。

## Scope
- 相关模块：Claude Code authorization inspection、connection panel、Anthropic → Responses request converter。
- 相关文件：`apps/desktop/electron/claude-code-connection.ts`、`apps/desktop/electron/bridge.ts`、`apps/desktop/src/desktop-model.ts`、`apps/desktop/src/components/claude-code-connection-panel.tsx`、`packages/gateway/src/conversion/request-converter.ts` 及测试。
- 兼容要求：不向渲染器或日志暴露凭证；Responses 请求不得包含其不支持的 `is_error`；保留内部错误语义和历史回滚能力。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 扩展授权来源检测与安全提示 | Claude Code connection、desktop model、bridge、panel | 授权矩阵测试、UI 静态测试、类型检查 | done | 新增 OAuth token 文件、apiKeyHelper、外部 API Key、WIF 检测；可管理配置使用历史备份后清理；定向测试通过 |
| 2 | 移除 Anthropic tool result 的 Responses 非法字段 | request converter、转换测试 | Anthropic → Responses 回归测试 | done | `is_error` 不再进入 Responses input，并记录 `responses_tool_error_flag_dropped`；Gateway 定向测试 42 通过 |
| 3 | 全链路验证 | 桌面测试、构建、差异检查 | `npm run desktop:test`、`npm run desktop:build`、`git diff --check` | done | 桌面测试 623 通过、1 跳过、0 失败；类型检查、生产构建和差异检查通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 只能在主进程读取和处理凭证原文，渲染器只接收来源、路径和脱敏信息。
- shell 环境变量不可由桌面进程静默删除，必须给出明确的 `unset` 指引。
