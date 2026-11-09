# Claude Code 配置冲突修复与历史回滚

## Goal
- 连接 Claude Code 时清理冲突的 `ANTHROPIC_AUTH_TOKEN`，确保本地 Agent Gateway 使用当前 `ANTHROPIC_API_KEY`。
- 为全局 `~/.claude/settings.json` 增加安全历史备份、查看、删除和一键回滚能力。
- 复用 Codex 环境历史的 JSON 快照、变更前备份、权限和保留策略约定，不影响 Codex 环境历史。

## Why Complex
- 跨 Gateway Agent adapter、Electron 主进程、IPC/preload、renderer bridge、Claude Code 面板和历史存储。
- 配置包含认证信息，必须只在主进程读写，历史文件需要受限权限并避免渲染器收到完整密钥。
- 回滚需要在覆盖当前配置前再次备份，且要保留 Claude Code 连接状态可诊断性。

## Scope
- 相关模块：Claude Code connection bridge、Agent adapter、Claude Code settings history、Desktop IPC、Claude Code connection panel。
- 相关文件：`apps/desktop/electron/claude-code-config-history.ts`、`apps/desktop/electron/bridge.ts`、`apps/desktop/electron/main.ts`、`apps/desktop/electron/preload.ts`、`apps/desktop/src/bridge.ts`、`apps/desktop/src/components/claude-code-connection-panel.tsx`、相关测试。
- 兼容要求：保留现有 `~/.claude/settings.json` 非受控字段；不把完整 API key/token 返回 Renderer；现有 Codex 环境历史行为不变。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 定义 Claude Code 历史快照模型、存储和安全读写 | electron history module | focused unit tests | done | 新增 `claude-code-config-history.ts`；快照写入 `history/agent-files/claude-code`，目录 0700、文件 0600；Renderer 预览会脱敏 key/token；2 个历史单元测试通过 |
| 2 | 连接/断开/回滚前自动备份并清理认证冲突 | Claude Code bridge, Agent adapter | connection/history tests | done | Claude profile 清理 `env.ANTHROPIC_AUTH_TOKEN`；连接、断开和回滚前写快照；连接时同步 Opus/Sonnet/Haiku/Fable/小模型/子代理模型字段，并清理会绕过本地网关的云端开关；adapter 冲突恢复测试和历史存储测试通过 |
| 3 | 接通 IPC 和 renderer bridge | main/preload/src bridge | bridge/build tests | done | 新增列表、回滚、删除 IPC；Bridge fallback、preload、Electron 类型检查通过 |
| 4 | 在 Claude Code 面板提供历史查看和一键回滚 | renderer panel | renderer tests/build | done | 面板新增“配置历史”、脱敏预览、单条回滚、批量删除；renderer 静态测试和生产构建通过 |
| 5 | 集成验证和更新文档 | all touched modules | desktop tests/build | done | Gateway 237/237、桌面全量 610 通过/1 跳过、历史与连接定向测试 9/9、Local Agent Bearer/x-api-key 兼容测试通过、production build、`git diff --check` 均通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 所有配置覆盖动作先备份当前内容；回滚动作也必须先备份当前内容。
- 历史快照可用于本机恢复，但完整内容不通过 IPC 返回给 Renderer；UI 只展示脱敏摘要。

## 兼容性审查结论
- CC Switch 明确区分 `ANTHROPIC_AUTH_TOKEN`（`Authorization: Bearer`）和 `ANTHROPIC_API_KEY`（`x-api-key`）；本地 Agent ingress 现在兼容两种请求头，并会在转发上游前移除 ingress token。
- 同类工具都会同步 Claude Code 的 tier/subagent 模型变量；本实现连接时让这些变量跟随选中的模型，并保留断开/回滚恢复能力。
- 官方订阅登录、独立会话启动、自定义 `CLAUDE_CONFIG_DIR`/WSL 目录和逐 tier 的独立模型映射仍属于后续增强，不影响当前 API Key + Global Profile Switch 范围。
