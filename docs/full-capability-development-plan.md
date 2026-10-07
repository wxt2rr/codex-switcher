# Codex Switcher 全能力对齐开发计划

> 版本：v1.0
> 日期：2026-10-06
> 目标：在保留 Codex Switcher 手动切换能力的前提下，完整实现本项目需要的 Provider、Agent、Gateway、Protocol、RouteGroup、Quota、Plugin、Usage、Profile 和发布能力。本计划不再把任何纳入范围的能力标记为“首版非阻塞”。意图分类/意图路由是明确排除项，Gateway 不分析 Prompt，也不会根据 Prompt 自动选择路由组。

## 1. 目标和完成定义

最终产品同时支持两种模式：

```text
手动模式：Agent → 指定账号/Provider
网关模式：Agent → Environment Gateway → Model Router → RouteGroup → Provider → Credential
```

必须完成：

1. 关闭网关时，现有环境/账号手动切换行为完全兼容。
2. 开启网关后，一个 Agent 只需要连接统一本地 Gateway。
3. AUTH、OAuth、API Key、插件登录、本地服务可以作为统一 Credential。
4. 请求按照显式逻辑模型/路由组、Provider、能力、Agent、健康度、策略和配额进行路由。
5. OpenAI Responses、Chat Completions、Anthropic Messages、Gemini 之间可以双向转换。
6. RouteGroup 支持嵌套、策略、Affinity、规则和首字节前故障转移。
7. 每个 Agent 可以独立选择模型、Provider、路由组和推理设置，并可恢复原始配置。
8. Provider 可以登录、刷新凭证、发现模型、读取配额和注入请求认证。
9. Provider 插件具备独立进程运行、权限边界、流式背压、超时、崩溃恢复和版本管理。
10. 用量、缓存、费用、配额、Reset、TTFT、失败原因和路由决策可追踪。
11. 桌面 UI、CLI、TUI、Profile、托盘服务和自动更新具备完整工作流。
12. 所有计划阶段完成并通过自动化、集成、跨平台和发布验收后，才允许目标标记完成。

## 2. 模型网关架构基线

本计划以模型供应链、Provider、Agent 和本地 Gateway 的分层能力为行为参考，不复制任何外部实现，而是用当前项目的 TypeScript/Core/Electron 架构实现等价能力。

| 架构层 | 参考内容 | Codex Switcher 对应目标 |
| --- | --- | --- |
| `internal/provider` | Provider、Account、Key、模型、协议、Quota、Routing、Affinity | `packages/core/src/gateway/provider*`、Electron Provider Adapter |
| `internal/agent` | Agent 字段、配置读写、Apply、Unwire、Join、Drift、stash/applied | `packages/core/src/agent`、Electron Agent Adapter |
| `internal/gateway` | IR、协议转换、RouteGroup、Rules、Fallback、Affinity | `packages/gateway` |
| `internal/plugin` | Plugin Host、RPC、插件市场、Provider 插件 | `packages/gateway-plugin`、Electron 插件管理 |
| `internal/catalog` | 内置/在线模型目录、能力、价格、上下文 | `packages/core/src/catalog` |
| `internal/usage` | 请求账本、Token、缓存、费用、Agent/Provider 维度 | `packages/gateway/src/usage` |
| `internal/edit` | JSON/JSONC/TOML/YAML 保留结构的原子编辑 | `packages/core/src/config-edit` |

参考边界：仅采用通用模型网关的分层能力，不在产品文案、日志或运行时输出中暴露外部项目名称。

## 3. 目标架构

```text
packages/core
├── gateway/              # 持久化领域模型、迁移、Provider/Credential/Model/RouteGroup
├── agent/                # Agent Adapter 契约和配置快照
├── catalog/              # 模型能力、价格、Provider 模型发现结果
└── config-edit/          # JSON/JSONC/TOML/YAML 保留结构写入

packages/gateway
├── request/              # GatewayRequestContext、RequestIR、ResponseEventIR
├── protocol/             # OpenAI/Anthropic/Gemini 双向适配器
├── routing/              # RouteGroup、规则、策略、Affinity、Fallback
├── provider/             # Provider Adapter、Credential Resolver、Quota Adapter
├── usage/                # Usage Ledger、成本、配额、路由 Trace
└── runtime/              # 无 Electron 依赖的 Gateway Runtime

packages/gateway-plugin
├── host/                 # 独立进程、JSONL RPC、背压、超时和崩溃隔离
├── registry/             # 插件注册表、版本、来源和权限
└── providers/            # Provider 插件适配器

apps/desktop
├── electron/             # HTTP Listener、SQLite、插件生命周期和系统集成
├── src/pages/providers   # Provider/Account/Credential
├── src/pages/agents      # Agent 连接、模型和恢复
├── src/pages/routes      # RouteGroup、规则、实时 Trace
├── src/pages/usage       # 用量、配额和费用
└── src/pages/profiles    # Profile 保存/应用/恢复
```

核心原则：

- Agent 是 Gateway 客户端配置，不是 Gateway 核心对象。
- Provider 是服务来源，Credential 是可轮换认证实例，Account 是 Credential 的身份元数据。
- Model 是逻辑模型，UpstreamModel 是供应商模型，二者不能混用。
- Model Router 只决定逻辑候选，Credential Resolver 决定具体账号，Protocol Adapter 决定线协议。
- Electron 只负责系统能力和 HTTP/SQLite 适配，纯路由和协议逻辑必须可独立测试。
- 手动模式和网关模式共存，网关关闭时不得要求用户迁移到新模式。

## 4. 阶段计划

### P0：源码对齐、契约冻结和内核拆分

目标：把当前实现从 Electron 单体路由服务拆成可验证的 Gateway 内核。

工作项：

- 创建 `packages/gateway`，迁移 Request Context、Model Router、Protocol、Fallback、Health 的纯逻辑。
- 创建 `GatewayRequestIR`、`GatewayResponseEventIR`、`ResolvedRoute`、`DecisionTrace`。
- 将当前 `usage-router-service.ts` 缩减为 HTTP Listener 和 Runtime Adapter。
- 将 `EnvironmentGateway`、Provider、Credential、Model、RouteGroup 升级到 schema v2。
- 设计密钥只存 `secretRef`，Core 状态和日志不得存明文。
- 写 v1 → v2 迁移、回滚和双读兼容。

验收：

- 旧手动模式测试全部通过。
- Gateway v1 与 Gateway v2 可以切换。
- 新内核不依赖 Electron、DOM 或桌面 IPC。
- `npm run core:test`、Gateway 单测和 TypeScript 检查通过。

### P1：完整 Agent Adapter 和配置恢复

目标：实现完整的 Agent 配置模型，而不是只保存 Agent 绑定元数据。

统一接口：

```ts
interface AgentAdapter {
  id: string;
  detect(): Promise<boolean>;
  readConfig(): Promise<AgentConfigSnapshot>;
  applyGateway(input: AgentGatewayConfig): Promise<void>;
  restoreOriginal(): Promise<void>;
  syncModels(models: ModelDefinition[]): Promise<void>;
  detectDrift(): Promise<AgentDrift | null>;
  listFields(): AgentFieldDefinition[];
}
```

必须实现的 Agent Adapter：

- Claude Code
- Codex CLI/App
- Gemini CLI
- OpenCode
- MiMo Code
- Pi
- Goose
- Cursor CLI
- Copilot CLI
- VS Code/Copilot 宿主
- Crush
- DeepSeek Harness
- Command Code
- fx
- omp
- OmO
- Devin
- Hermes Agent
- Mister Morph
- Kimi Code
- Muse Code
- Empryo
- MiniMax Code
- Droid
- Grok Build
- ZCode
- OpenHanako
- AtomCode
- Alma

每个 Adapter 必须覆盖：

- 配置检测和路径发现；
- 模型字段和 Provider 字段；
- 推理强度和特殊字段；
- 子 Agent/备用模型字段；
- 原始值 stash；
- Gateway 管理字段 applied；
- Drift 检测；
- 原子写入；
- 注释、顺序、缩进和未知字段保留；
- `listFields()` 字段契约，以及各 Agent 显式声明的 reasoning、fallback model、sub-agent model 字段；未声明路径不得猜测写入；
- 关闭网关后完整恢复；
- 已运行会话的重启提示。

验收：

- 每个 Adapter 至少有 config fixture、apply、restore、drift、external-edit 五组测试。
- 所有 Agent 均可独立选择逻辑模型和路由组。
- 任意 Agent 恢复原生配置后不再经过 Gateway。

### P2：协议 IR 和完整双向转换

目标：实现完整的跨协议能力，而不是只识别协议或改写 Header。

支持协议：

- OpenAI Responses
- OpenAI Chat Completions
- Anthropic Messages
- Google Gemini

转换矩阵必须全部覆盖：

```text
Responses ↔ Responses
Responses ↔ Chat
Responses ↔ Anthropic
Responses ↔ Gemini
Chat ↔ Anthropic
Chat ↔ Gemini
Anthropic ↔ Gemini
```

转换内容：

- 文本和多轮消息；
- 流式事件；
- Tool call/result；
- 推理和 thinking；
- 图片和多模态输入；
- Prompt cache；
- Usage、Reasoning Usage、费用计数；
- Finish/Stop reason；
- Request/Response ID；
- 错误和重试语义；
- 模型能力不兼容时的明确拒绝。

验收：

- 每个方向有 golden fixture 和流式事件序列测试。
- 工具调用和推理内容不能丢失或错位。
- 已发送首字节后不得隐式更换供应商。
- 转换失败能返回 Agent 可理解的协议错误。

### P3：Provider Adapter、订阅登录、模型发现和配额

目标：从静态 Provider 配置升级为完整 Provider 生命周期。

统一接口：

```ts
interface ProviderAdapter {
  id: string;
  protocols(): Protocol[];
  login(input: LoginInput): Promise<CredentialRef>;
  refresh(credential: CredentialRef): Promise<CredentialStatus>;
  revoke(credential: CredentialRef): Promise<void>;
  listModels(input: ModelDiscoveryInput): Promise<ModelDefinition[]>;
  fetchQuota(credential: CredentialRef): Promise<QuotaSnapshot>;
  signRequest(input: SignRequest): Promise<SignedRequest>;
  classifyError(error: UpstreamError): FailureClass;
}
```

必须完成的 Provider/来源：

- OpenAI、Anthropic、Google Gemini；
- DeepSeek、Kimi、GLM、Qwen、MiniMax、Mistral、Groq、xAI；
- OpenRouter、Ollama、LM Studio、本地 OpenAI 兼容服务；
- ChatGPT/Codex 订阅；
- Claude Pro/Max/Team 订阅；
- Copilot、Cursor、Grok、Devin 等订阅型来源；
- 任意自定义 OpenAI/Anthropic/Gemini URL。

必须实现：

- API Key、OAuth、订阅 Token、插件登录；
- 多账号和多 Key；
- Token 自动刷新；
- 模型动态发现和手动覆盖；
- 模型能力、上下文、图片、推理、工具元数据；
- Provider/Account/Key 级别模型过滤；
- Provider/Account/Key 级别代理和 Header；
- Quota、Balance、Reset、Plan、Usage；
- Provider 关闭、恢复、删除和迁移。

验收：

- 同一 Provider 的多个账号可同时存在。
- 一个订阅登录可以被多个 Agent 使用。
- Provider 模型变化可以增量刷新并保持用户覆盖。
- 任何密钥、Token、OAuth 返回值都不进入普通状态、日志或测试输出。

### P4：RouteGroup v2、嵌套组、规则和智能调度

目标：完整实现模型网关路由组语义。

路由策略：

- `smart`：按额度、Reset、失败历史和健康状态；
- `order`：按顺序；
- `rotate`：轮流；
- `usage`：剩余额度/近期使用量；
- `pace`：按 Reset 前可用额度速度；
- `weight`：权重轮询。

会话策略：

- `auto`；
- `session`；
- `turn`；
- `off`。

路由组功能：

- Provider/Model/Credential 混合成员；
- 自动同名模型成组；
- 手动建组；
- `group/<id>` 嵌套组；
- 最大嵌套 8 层；
- 直接和间接循环检测；
- 子组独立策略；
- 外层组故障转移；
- fallback 模型链。

规则条件：

- Token 数；
- 图片；
- 推理开关和推理强度；
- Agent；
- Context compact；
- 时间；
- 指定模型/Provider；
- 不包含基于 Prompt 的自动意图分类或意图路由；用户必须显式选择逻辑模型/路由组。

故障模型：

- 余额不足；
- 配额耗尽；
- Retry-After 限流；
- 认证失败；
- 协议/能力不兼容；
- 上游 5xx；
- Proxy 错误；
- 上下文过长；
- 首字节超时；
- 工具/推理字段拒绝。

验收：

- 每种策略都有确定性选择测试。
- 同一轮工具调用保持同一候选。
- 首字节前有限重试，首字节后不重试。
- 冷却时间严格遵守 Retry-After 或配额 Reset。
- 路由 Trace 能说明每个候选为何被选中或跳过。

### P5：产品范围确认——移除意图路由（已完成）

本阶段不是待开发能力，而是明确的产品约束：不实现意图分类、关键词路由、分类模型、分类 Provider、分类超时/回退、分类用量或 Prompt 分析。

验收：

- Gateway Runtime 不接收或保存 intent rule/state。
- Gateway HTTP 服务只使用请求中显式提供的 model/route group，以及协议、能力、健康度、配额和策略进行选择。
- 旧配置中的 `intent_rules_json` 即使存在也不会读取、执行或写回；新配置不再创建该能力。
- 相关实现、测试、UI/CLI 字段和公共导出均已删除。

### P6：Provider 插件运行时和插件市场

目标：完成生产级 Provider 插件能力，不停留在接口定义。

工作项：

- 独立 Plugin Host 进程；
- JSONL/RPC 协议；
- RPC 请求超时；
- 流式背压和内存预算；
- 单调用、单插件、全局并发限制；
- 插件崩溃隔离和自动重启；
- Provider 登录/刷新/注销/模型/配额/签名 API；
- Provider Plugin Runtime：通过 `provider.describe` 握手读取显式 Provider 契约，注册到共享 ProviderRegistry，并支持安全停用和 Host 关闭；
- 可信来源、版本、权限和能力声明；
- 插件市场 Registry；
- npm/Git/本地安装；
- 插件禁用、回滚和删除；
- 插件日志脱敏。
- Windows AppContainer launcher must use the current `userenv.dll` AppContainer SID API and `KernelBase.dll` capability SID API through fail-closed runtime lookups, so the helper remains buildable with both the hosted MSVC toolchain and cross-checking MinGW toolchains without weakening the isolation policy.

隔离实现必须是 fail-closed：macOS 使用 `sandbox-exec`，Linux 使用 `bubblewrap`，Windows 使用随桌面包提供的 AppContainer launcher；启动器缺失或能力配置无法映射时，`required` 模式必须拒绝启动，不得静默退回普通 Node 子进程。

验收：

- 恶意/异常插件无法读取核心 Secret。
- 插件挂起、崩溃、发送超大帧时 Gateway 仍能服务其他请求。
- 插件升级失败自动回滚。
- 插件 Provider 可以正常参与模型路由、额度和 usage。
- Windows smoke must cover both default-deny behavior and an explicit filesystem capability grant: only the plugin directory may become writable; Home reads and network remain denied.

### P7：Usage、Quota、Cost、Trace 和运营 UI

目标：达到生产级可运营水平。

Usage Ledger 必须记录：

- Request、Environment、Agent、Session；
- Logical Model、Served Model、Provider、Credential、Account；
- 输入/输出/推理/缓存 Token；
- Price、Cost、Price Tier；
- TTFT、总延迟、重试次数；
- 协议入口和上游协议；
- 失败类型、Retry-After、最终候选；
- RouteGroup、显式 Rule；
- 可选脱敏请求归档。

UI 必须提供：

- Provider 管理页；
- Agent 管理页；
- Credential/Account 页；
- Model Catalog 页；
- RouteGroup 和规则页；
- Quota/Balance/Reset 页；
- Usage 趋势和费用页；
- 实时 Route Trace；
- Health/Cooldown/Fallback 状态；
- 原始配置恢复和 Drift 修复。

### P8：CLI、TUI、Profile、托盘和自动更新

必须完成命令：

```bash
codex-switcher provider add|ls|login|logout|refresh|models|quota
codex-switcher agent ls|connect|disconnect|use|default|doctor
codex-switcher group ls|add|set|rm|rule add|rule rm
codex-switcher model ls|inspect
codex-switcher usage [today|7d|30d|all]
codex-switcher profile save|ls|use|rm
codex-switcher gateway start|stop|status|serve
```

必须完成：

- TUI 与桌面功能一致；
- TUI Gateway 页面必须展示显式 Provider/Credential/Model/RouteGroup/Agent/Profile/Usage 状态，并支持手动/Gateway 模式切换及本地 Gateway 生命周期操作；
- 菜单栏/托盘常驻；
- 登录启动；
- Gateway 独立运行模式；
- 端口冲突恢复；
- 后台更新；
- 更新失败回滚；
- 未签名安装包的发布和自动更新校验路径；签名、公证不属于本次交付前置条件；
- Windows/Linux 打包流程。

### P9：兼容迁移、数据恢复和多平台发布

工作项：

- 当前 Codex Switcher 旧环境/账号/路由迁移；
- Provider/Agent 配置导入；
- Codex/Claude Code/OpenCode 配置导入；
- 迁移预览；
- 自动备份；
- 原子写入；
- 失败回滚；
- 手动模式一键恢复；
- 环境重命名和删除清理；
- macOS、Windows、Linux 路径和权限差异；
- WSL/远程 Agent 路径处理。

本次交付边界：签名、公证、真实 Intel Mac 安装、真实第三方 Provider/模型调用由使用者自行验证，不作为本仓库开发完成条件。仓库负责实现和验证对应的代码、自动化测试、未签名打包、安装 smoke、回滚 smoke 以及 CI 产物校验。

### P10：全量测试、真实 Provider 验证和最终交付

必须建立：

- 每个 Agent 的配置 fixture；
- 每个协议方向的 request/stream/response fixture；
- Provider Adapter contract tests；
- Plugin Host 恶意/崩溃/超时测试；
- RouteGroup 嵌套和循环测试；
- Quota/Reset/Retry-After 时间测试；
- 手动模式回归测试；
- Gateway 模式端到端测试；
- 多 Agent 同时请求测试；
- macOS/Windows/Linux CI 运行验证；
- 本机 macOS arm64 业务启动、安装和回滚 smoke；
- 未签名打包、升级清单校验、升级和回滚测试。

真实 Windows/Linux/Intel Mac 安装、签名/公证和真实第三方 Provider 调用由使用者自行执行，不作为本次自动化交付门槛。

桌面验收入口 `npm run desktop:test` 必须递归发现并串行执行 `apps/desktop/electron` 与 `apps/desktop/src` 下全部 `*.test.ts`，不能依赖维护者手工维护的测试文件清单；只有显式标注且需要外部 Codex 安装的 E2E 才允许作为可见 skip。

Core/Gateway 的 workspace 测试入口也必须由 Node 跨平台递归发现 `*.test.ts` 并固定串行执行，不能依赖 Unix-only 的 `find`、命令替换或 shell glob 展开；Windows、Linux、macOS CI 必须执行同一套完整测试文件。

根级脚本测试入口同样固定 `--test-concurrency=1`：部分 CLI/兼容性 fixture 会临时替换进程级环境变量，禁止并发执行导致跨平台 runner 间歇性出现 `spawn npx/bash/node ENOENT`。该约束只影响测试隔离，不改变产品运行时并发能力。

## 5. 阶段依赖和交付顺序

```text
P0 内核拆分
 ├── P1 Agent Adapter
 ├── P2 Protocol IR
 └── P3 Provider Adapter
       └── P4 RouteGroup v2
             ├── P5 Explicit scope removal
             └── P6 Plugin Runtime
                   └── P7 Usage/UI
                         └── P8 CLI/Profile/Tray
                               └── P9 Migration/Release
                                     └── P10 Full Acceptance
```

每次只允许一个阶段为 `in_progress`。阶段必须有自动化证据才能标记 `done`。任何阶段失败时，先修复当前阶段，不得跳到下一阶段伪造完成度。

## 6. 回滚策略

- Gateway v2 不可用：自动恢复 Gateway v1 或手动模式。
- Agent 配置写入失败：恢复原始文件快照。
- Provider Adapter 刷新失败：保留旧凭证，不清空可用状态。
- RouteGroup 配置无效：拒绝保存，不影响旧配置。
- Plugin 崩溃或升级失败：禁用插件并恢复上一版本。
- 模型目录失败：继续使用最后一次有效目录。
- 数据迁移失败：恢复迁移前备份。
- 自动更新失败：保留当前可启动版本。

## 7. 完成验收标准

只有以下全部满足，才能结束本目标：

1. 所有 P0-P10 阶段均为 `done`。
2. 计划中列出的全部 Agent Adapter 均有真实配置读写和恢复测试。
3. 所有协议转换矩阵均有流式、工具、推理、图片和 usage 测试。
4. 所有 Provider/订阅类型均有登录、刷新、模型和配额契约测试。
5. RouteGroup 的全部策略、嵌套、显式模型/能力规则、Affinity 和故障类型均有测试，且不存在 Prompt 意图路由。
6. Provider 插件可以独立运行、失败恢复并参与真实路由。
7. Desktop、CLI、TUI、Profile、托盘和自动更新功能完整可用。
8. 手动模式可以随时恢复并保持旧行为。
9. `npm test`、Core/Gateway/Desktop 测试、类型检查、构建和未签名打包全部通过。
10. macOS/Windows/Linux CI 证据、本机 macOS arm64 安装与回滚证据完整；签名、公证、真实 Intel Mac 和真实第三方调用由使用者自行验收。
11. 无纳入范围的“首版不做”“后续再做”“不阻塞”遗留项目；意图路由因产品决策明确不属于范围。
12. 所有变更和证据记录在 `.wxt/full-capability-development.md`。
