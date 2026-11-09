# Claude Code 凭证检测与 metadata 兼容修复

## Goal
- 自动检测 Claude Code 相关授权状态与配置冲突。
- 冲突时让用户明确选择是否先备份并删除 Claude.ai 授权状态，再继续 API Key/环境网关配置。
- 修复 Anthropic ingress 转 Responses upstream 时错误透传 `metadata` 导致 400 的问题。

## Why Complex
- 跨桌面主进程 Claude Code 配置、配置历史、Agent adapter、Gateway 转换器和渲染器交互，涉及多个独立职责模块。

## Scope
- 相关模块/类：Claude Code connection bridge、配置历史、Claude agent profile/adapter、Gateway request converter、Claude Code 配置面板。
- 相关文件：`apps/desktop/electron/bridge.ts`、`apps/desktop/electron/claude-code-config-history.ts`、`packages/gateway/src/agent/*`、`packages/gateway/src/conversion/request-converter.ts` 及对应测试、`apps/desktop/src/components/claude-code-connection-panel.tsx`。
- 兼容要求：不向渲染器暴露 token；删除前创建可回滚备份；仅在目标 Responses 不支持时过滤 Anthropic `metadata`，不影响原生 Anthropic 请求。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立 Claude 授权状态检测与冲突备份/删除数据模型 | bridge、config history、agent connection helpers | 单元测试覆盖 OAuth、环境变量、配置目录和备份 | done | 新增授权检测、冲突类型、OAuth/settings 备份清理与安全恢复路径；凭证值不进入 inspection 返回值 |
| 2 | 在连接面板增加冲突提示和用户确认流程 | ClaudeCodeConnectionPanel、bridge/preload 类型 | 定向 UI 静态测试与类型检查 | done | 面板展示检测到的授权地址/冲突路径；确认后才传 `cleanupAuthorization`；45 个定向测试通过 |
| 3 | 修复 Anthropic → Responses 的 metadata 透传 | request converter、转换测试 | Gateway 转换单元测试与桌面全量测试 | done | Anthropic ingress 到 Responses upstream 时丢弃 provider metadata 并记录诊断；转换测试通过 |
| 4 | 集成验证与回写 | 全链路 | `npm run desktop:test`、`npm run desktop:build`、`git diff --check` | done | 桌面全量测试 621 通过、1 跳过、0 失败；生产构建通过；差异检查通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 删除 Claude.ai 授权状态前必须先备份，且必须由用户在面板中确认。
- 任何日志、诊断和渲染器返回值不得包含 token 原文。
- 不修改与本需求无关的现有改动。
