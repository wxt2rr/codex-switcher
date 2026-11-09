# Claude Code - CC Switch/Magpie parity

## Goal
- 补齐当前 Claude Code API Key / Global Profile 链路中会导致配置失效或漂移的通用能力：尊重 `CLAUDE_CONFIG_DIR`，并在连接状态中识别配置漂移、支持重新应用当前来源。
- 明确对照 CC Switch 与 Magpie 后的范围边界：不引入 Claude 官方订阅、聚合模式或独立会话启动器。

## Why Complex
- 改动跨 Electron bridge、Claude Code 连接状态、Gateway Agent adapter 与 renderer 面板。
- 需要兼容现有默认 `~/.claude/settings.json`、历史快照和已有连接记录。

## Scope
- 相关模块/类：Claude Code connection/history、Electron bridge、Agent adapter、Claude Code connection panel。
- 相关文件：`apps/desktop/electron/claude-code-connection.ts`、`apps/desktop/electron/bridge.ts`、`packages/gateway/src/agent/adapter.ts`、对应测试与面板。
- 兼容要求：默认目录行为不变；历史快照仍可回滚；密钥不返回 renderer；不改变已明确的 API Key-only 范围。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 引入有效 Claude 配置目录解析，支持 `CLAUDE_CONFIG_DIR` 与默认目录，统一连接、历史、适配器路径 | Claude connection / bridge / adapter | 定向单测、桌面类型检查 | done | `claude-code-connection.test.ts` 通过；Electron/Web tsc 通过 |
| 2 | 让连接状态暴露有效漂移原因，并提供安全的重新应用入口 | bridge / panel | 定向单测、组件测试 | done | 新增 `reapplyClaudeCode` IPC；来源缺失显示 `unwired`；网关重新启用/本机 Agent 重新启用时自动尝试重应用；Claude 面板定向测试通过 |
| 3 | 扩展账号协议为 Anthropic Messages，贯通 API Key 账号与 Claude Code 来源解析 | core state / legacy adapter / desktop bridge / account editor / target routing | Core、Electron、Web 类型检查；Anthropic 定向单测 | done | `core:build`、Electron/Web tsc 通过；Core Anthropic/target-home 测试 176 pass；Claude/同步定向测试 13 pass |
| 4 | 对照结论与范围边界落档，补回归验证 | docs / tests | `npm run test:desktop --workspace ./apps/desktop`、build、diff check | done | Desktop 616 tests: 615 passed, 1 skipped, 0 failed；`desktop:build` 通过；`git diff --check` 通过 |

## Follow-up Task List

| 5 | 补齐 Anthropic 认证字段优先级与本机网关 Auto Mode 兼容开关 | Electron bridge / Gateway Agent adapter / Claude profile | Gateway 定向单测、桌面定向测试、类型检查 | done | Agent 定向测试通过；bridge smoke 覆盖 `ANTHROPIC_AUTH_TOKEN` 优先级及官方/非官方 endpoint 判定；Electron/Web/Gateway tsc 通过；网关/非官方兼容端点写入 `CLAUDE_CODE_AUTO_MODE_SERVER=0`，恢复快照还原用户原值 |
| 6 | 收紧 `CLAUDE_CONFIG_DIR` 变化时的连接与历史回滚路径 | Claude connection / bridge / history tests | 连接路径变化测试、桌面全量测试 | done | 连接记录保留原始绝对路径；目录变化标记 `configPathChanged` 并视为未接线；断开按原路径恢复；跨目录历史回滚拒绝静默覆盖；路径单测通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现

## 对照结论

### 已补齐
- Global Profile Switch：统一写入 Claude Code CLI 的 `settings.json`，支持连接、断开、重新应用和配置漂移诊断。
- 环境来源：复用当前环境的本机 Agent Gateway，使用 Anthropic Messages 入口和本机 Agent token。
- API Key 来源：账号支持 `ANTHROPIC_BASE_URL` 对应的 Anthropic Messages 协议，连接时写入 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY` 和可选模型。
- 配置目录与历史：尊重 `CLAUDE_CONFIG_DIR`，配置快照支持查看、删除和回滚。
- 网关兼容：本机 Agent Gateway 和非官方 Anthropic-compatible endpoint 自动关闭 Claude Code 的服务端 Auto Mode 检查；官方 `api.anthropic.com` API Key 保留用户原值。
- 认证兼容：账号读取优先级为 `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → 旧 `OPENAI_API_KEY` / token 字段。
- 安全边界：renderer 只拿到脱敏预览，密钥仍由主进程读取和写入。

### 明确不纳入本期
- Claude 官方订阅/OAuth、CC Switch Aggregation、Magpie 独立启动器。
- Claude 会话管理、MCP/Skills/Prompt 同步，以及多 Tier 独立模型映射 UI。

### 仍可作为后续增强
- 连接 Claude Code 前的真实 `/v1/messages` 探测与更细粒度错误诊断。
- Claude Code CLI 进程重启/托盘通知，以及项目级 profile（本期只做 Global Profile）。
- Claude Code 的上下文窗口、Auto Compact、Tool Search 等高级模型能力映射；当前模型选择仍以已有 Gateway 模型路由为准。
