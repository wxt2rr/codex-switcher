# 模型网关完整升级

> 本跟踪文件已由 `.wxt/full-capability-development.md` 取代。当前产品明确不实现意图分类或意图路由；历史阶段记录不代表当前运行时能力。

## Goal

- 按 `docs/model-gateway-upgrade-plan.md` 完成阶段 0-10 的全部开发和验收。
- 保留手动模式，新增环境级模型网关、Provider、Credential、RouteGroup、协议适配、用量观测、迁移恢复和生产级高级能力。

## Why Complex

- 跨 `packages/core`、Electron 主进程、桌面 UI、Codex 配置同步、代理转发、凭证存储和跨平台测试。
- 预计涉及多个新领域模型、多个运行时模块和超过 150 行代码变更。
- 需要兼容已有环境、账号、路由、账号池和模型目录。

## Scope

- 计划文档：`docs/model-gateway-upgrade-plan.md`
- 领域模型：Gateway、Provider、Credential、ModelDefinition、RouteGroup
- 运行时：环境级 Gateway、Model Router、Credential Resolver、Protocol Adapter、故障切换
- UI：连接模式、服务商、凭证、模型、路由组、用量与健康状态
- 兼容：手动模式、旧配置迁移、Codex 配置恢复、跨平台验证
- 不覆盖当前工作区中与本目标无关的既有修改。

## Task List

| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 0 | 冻结配置契约、迁移边界和新领域类型 | `packages/core/src/gateway/model.ts`, `packages/core/src/gateway/legacy-adapter.ts`, `packages/core/src/state/store.ts` | `npm run core:test`, `npm run core:build` | done | 新增环境级网关类型和旧账号到 Provider/Credential/Model 的无密钥适配器；旧配置默认保持 direct；核心测试 138/138，核心构建通过。 |
| 1 | Provider/Credential 统一层，纳入 AUTH 和 API Key | `credential-resolver.ts`, `usage-router-manager.ts`, `usage-router-service.ts`, `bridge.ts` | Credential Resolver、路由管理器和 Responses 注入测试 | done | 普通环境路由和账号池共用 Credential Resolver；Responses 普通路由可注入 AUTH token/account ID；Chat Completions 明确排除 AUTH；专项测试 24/24。凭证持久化元数据由阶段 0 的环境网关状态承载，UI 状态留到阶段 8。 |
| 2 | 环境级网关入口和统一请求上下文 | `usage-routing-model.ts`, `usage-store.ts`, `usage-router-service.ts`, `usage-router-manager.ts` | 网关启动/停止/重载与入口转发测试 | done | 已新增 `EnvironmentGateway`、SQLite 持久化、管理接口、`/gateways/<gatewayId>` 入口、请求上下文和 Model Router；网关能按请求模型选择路线、改写上游模型，未知模型返回诊断错误，重启后配置仍可用；相关专项测试通过。 |
| 3 | 环境级模型目录和 Codex App 配置同步 | 模型目录、target-home、模型页、Electron IPC/UI | 多 Provider 模型列表与重启回归 | done | 新增环境级 Gateway catalog 聚合与冲突校验，网关模式写入 `model-catalog_json`，手动模式继续使用账号目录；网关配置接入 legacy 持久化、Electron IPC 和环境页开关；核心 138/138、桌面全量和 Web/Electron 类型检查通过。 |
| 4 | Model Router 和跨 Provider RouteGroup | 模型解析、路由组、上游模型映射 | 模型精确路由、能力过滤、跨 Provider 测试 | done | Gateway state 会从 legacy 账号生成同模型 RouteGroup；runtime 持久化 routeGroups，网关入口按组别名、协议、请求能力和会话键选择路线；跨 Provider 组、能力不满足和重启持久化专项验证通过，Electron 类型检查通过。 |
| 5 | 凭证池策略、会话保持和故障切换 | Credential Resolver、健康状态、重试 | 限流、冷却、首字节前 failover 测试 | done | 保留旧 AccountPool 存储兼容，同时提供 CredentialPool 类型/ID 别名；RouteGroup 网关复用凭证注入、首字节前 failover 和本地冷却，重复请求会跳过冷却路线；会话/权重/健康专项与网关 failover 专项通过。 |
| 6 | OpenAI/Anthropic/Gemini 协议适配 | `protocol-adapters/`、compatibility fixtures | 流式、工具调用、推理和 usage 测试 | done | 扩展 `RouteProtocol` 支持 Anthropic/Gemini；网关按入口识别协议，使用 provider-specific API key headers，适配 Responses 请求结构，并将 Gemini `usageMetadata` 与 Anthropic usage 纳入统计；协议专项 4/4、路由/usage 相关专项通过。 |
| 7 | 用量、配额、健康和路由决策可观测性 | usage store、日志、桌面状态 | 脱敏、统计、路由记录测试 | done | 网关增加窗口请求/估算 token 配额、`gateway_route_selected` 路由审计事件、每路线 cooldown/失败次数 health endpoint，并复用脱敏 usage store；usage、quota、health、路由失败转移专项通过。 |
| 8 | 手动模式/网关模式及服务商、模型、路由组 UI | `apps/desktop/src/pages/` | UI 测试、配置预览、模式切换回归 | done | 环境页提供手动/网关模式 badge 与原子化网关开关，网关页显示本地入口和聚合模型目录，凭证池采用产品命名且网关模式可安全回退；Web/Electron 类型检查及桌面桥接专项通过。Provider/RouteGroup 深度编辑继续沿用阶段 10 的扩展入口。 |
| 9 | 配置迁移、导入、恢复和跨平台兼容发布 | migration、CLI、Codex 配置 | macOS/Windows/Linux 检查与回滚测试 | done | legacy gateway 独立文件、环境重命名同步、失败回滚、无密钥迁移适配和可重复迁移预览/结果模型均已实现；核心 138/138 通过，旧配置默认 direct，目标目录失败可恢复旧快照。跨平台专用矩阵纳入最终阶段。 |
| 10 | 高级 Provider 能力（当前仅保留 Provider 插件、多 Agent） | plugin adapter、Agent config | 插件隔离、多 Agent 配置测试 | superseded | 历史方案曾包含意图路由，但当前产品已明确排除；本文件已由 `.wxt/full-capability-development.md` 取代。仅保留 Provider 插件凭证边界和多 Agent 网关绑定模型的历史记录，不能据此恢复意图路由能力。 |
| 11 | 全量验证、文档、发布和最终验收 | 项目级 | `npm run lint`, `npm test`, core/desktop build/test | superseded | 本历史跟踪文件已由 `.wxt/full-capability-development.md` 取代；当前产品明确排除意图路由。 |

## Rules

- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
- 每个阶段先完成最小切片和验证，再扩大范围。
- 未通过验证的阶段不得标记为 `done`。
- 不覆盖用户已有的无关工作区修改。
