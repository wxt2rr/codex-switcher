# 网关模型绑定与账号协议路由修复

## Goal

- 让网关模型路由严格执行“逻辑模型 → 绑定账号 → 账号配置的上游协议 → 三方服务”的链路。
- 同一个逻辑模型绑定多个账号时，分别按每个账号的 `Responses` 或 `Chat Completions` 配置创建可用路由，并保留协议转换能力。
- 修复网关请求未携带模型时误落到账号基础路由的问题，避免把模型请求发送到不匹配的账号/协议。
- 保留显式模型选择、路由组、账号池和关闭网关后的手动切换行为；不引入意图路由。

## Why Complex

- 模型绑定、账号运行时协议、路由实例和网关默认路由分别由不同模块维护，任一层使用旧协议都会导致三方接口收到错误格式。
- 同一模型可能绑定多个账号、多个协议，编译后的模型能力必须是绑定账号能力的稳定并集，但真正发请求时仍需回到具体账号的协议。
- Codex App 的 Responses 请求可能省略模型字段；网关必须有明确的默认逻辑模型，不能静默选择第一个账号基础路由。

## Scope

- 相关模块：`gateway-model-bindings`、`usage-router-manager`、`usage-router-service`、Electron bridge。
- 相关行为：模型绑定编译、账号协议传播、模型路由物化、网关默认路由、错误诊断和回归测试。
- 不在范围：意图/提示词路由、签名、公证、真实三方账号联调。

## Task List

| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立按账号保存的模型路由协议契约，并让基础账号路由使用账号最新协议 | `usage-router-manager`、`bridge` | 路由构造单测、Electron TypeScript 检查 | done | `RouteTarget.protocol` 优先使用绑定账号协议；基础路由优先使用 `account.protocol`；Electron TypeScript 检查通过 |
| 2 | 编译模型绑定时合并同模型的多账号协议，并把账号协议传给每个绑定 | `gateway-model-bindings`、`bridge` | 同模型多账号/多协议单测 | done | 新增 `protocolByAccount`；模型协议为绑定账号协议并集；模型绑定相关测试通过 |
| 3 | 修正网关默认路由和无模型请求行为，禁止静默落到普通账号基础路由 | `usage-router-manager`、`usage-router-service` | 无模型请求、默认逻辑模型回归测试 | done | 默认路由在存在模型绑定时选择模型路由；无模型 Responses 请求被补为绑定模型；网关路由测试通过 |
| 4 | 补充跨协议转换与错误诊断回归，确认 Responses/Chat Completions 请求都走正确上游 | `usage-router-service`、相关测试 | 目标测试集 | done | 已验证模型路由协议、Responses→上游协议转换、既有代理错误诊断回归；相关测试全部通过 |
| 5 | 完成构建级验证并复核工作区差异 | Electron/Core | TypeScript、相关测试、`git diff --check` | done | Electron TypeScript 通过；网关服务 36/36、管理器/模型路由 28/28、bridge 28/28 通过；`git diff --check` 通过 |

## Rules

- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 不通过增加意图识别来解决模型选择问题；选择依据只能是显式模型、路由组或明确配置的默认逻辑模型。
- 保留当前未提交工作区中的既有修复，不回滚与本任务无关的用户修改。
