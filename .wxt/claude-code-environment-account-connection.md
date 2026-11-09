# Claude Code Environment/Account Connection

## Goal
- 将 Claude Code 作为现有 Environment / Account 体系的消费端接入。
- 支持两种全局连接来源：Environment 的本地 Agent Gateway，或 Environment 下兼容 Anthropic 的 API Key 账号。
- 复用现有 Agent adapter、Gateway 状态、账号 Secret 和桌面端设计 Token。

## Why Complex
- 跨 packages/core、packages/gateway、apps/desktop/electron、apps/desktop/src 和插件生命周期。
- 同时涉及连接契约、Secret 边界、配置快照回滚、Bridge API、Plugins/Environments UI。
- 必须兼容工作树中已有的环境网关和 Agent binding 改动。

## Scope
- 相关模块/类：Environment / Account source resolver、Claude Code Agent adapter、Electron Bridge、Claude Code 插件生命周期、Plugins page、Environments page。
- 相关文件：packages/gateway/src/plugin/*、packages/gateway/src/agent/*、packages/core/src/gateway/*、apps/desktop/electron/*、apps/desktop/src/pages/plugins-page.tsx、apps/desktop/src/pages/environments-page.tsx、apps/desktop/src/desktop-model.ts、apps/desktop/src/bridge.ts。
- 兼容要求：不覆盖现有未提交改动；不支持 Claude 订阅、OAuth、Per-shell、Bedrock 或 Gateway 代理模式；保留已有 Environment gateway/agentBindings 行为。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 锁定 Claude Code connection/source 契约和安全解析规则 | core/gateway contracts, desktop model | Typecheck/unit tests | done | `apps/desktop/electron/claude-code-connection.ts` adds masked source/connection contracts; `apps/desktop/src/desktop-model.ts` mirrors renderer-safe fields; `npm run core:build` and `npm run gateway:build` pass |
| 2 | 增加主进程 source discovery、preview、global connect/disconnect/diagnose Bridge | apps/desktop/electron, preload, renderer bridge | Electron/bridge tests | done | `bridge.ts`, `main.ts`, `preload.ts` wire source discovery and global connect lifecycle; desktop production build passes after fixing adapter drift check; renderer fallback/test stubs cover the new IPC surface |
| 3 | 扩展 Agent/plugin lifecycle，使 Claude Code 插件能声明 agent 能力 | packages/gateway/src/plugin, plugin runtime | plugin tests | done | `PluginKind` 支持 `agent`；新增 host-owned `PluginAgentRuntimeManager`；ProviderPluginManager 可安装/激活/停用 agent-only plugin；manager test 通过 |
| 4 | 实现 Plugins 页面 Claude Code 连接 SidePanel | apps/desktop/src/pages/plugins-page.tsx, shared components | renderer typecheck/tests | done | 新增 `ClaudeCodeConnectionPanel`，支持 source/model 选择、连接/切换/断开/诊断，API key 只显示 masked preview；Plugins 页提供配置入口；desktop production build 通过 |
| 5 | 在 Environments 页面加入当前环境快捷接入 | apps/desktop/src/pages/environments-page.tsx | renderer tests/manual smoke | done | 每个环境卡新增“接入 Claude Code”，打开同一 SidePanel 并预选当前环境；App 注入 DesktopBridge；desktop production build 通过 |
| 6 | 集成验证、更新本 todo、记录残余风险 | all touched modules | focused tests/build | done | `npm run gateway:test` 236/236 passed；`npm run test:desktop --workspace ./apps/desktop` 604 passed / 1 skipped / 0 failed；`npm run build --workspace ./apps/desktop` passed；builder/bridge/connection focused tests passed |
| 7 | 修正插件市场的安装状态与升级入口 | apps/desktop/src/pages/plugins-page.tsx | renderer test/build | done | 市场按插件 ID 关联已安装版本：同版本/旧版本显示“已安装”，新版本显示“升级”，未安装仍显示“安装”；新增 `plugins-page.test.ts` 覆盖状态判断与禁用规则；desktop production build 通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
- Secret 不通过 Renderer 返回完整值；连接操作在 Electron 主进程完成。
- `settings.json` 只管理 Claude Code 受控字段，并在变更前创建可恢复快照。
