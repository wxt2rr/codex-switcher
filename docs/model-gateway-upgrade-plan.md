# Codex Switcher 模型网关升级开发计划

> 本文为前期历史方案，现由 [全能力对齐开发计划](full-capability-development-plan.md) 取代。历史章节中的意图分类/意图路由不属于当前产品能力，也不应继续实现；请以新计划中的显式模型/路由组选择为准。

> 状态：已确定的执行方案
>
> 目标：在保留现有“环境/账号手动切换”能力的前提下，将 Codex Switcher 升级为面向模型、服务商和凭证的本地模型网关，并逐步补齐生产级模型供应链能力。
>
> 适用范围：`apps/desktop` Electron 主进程、桌面 UI、`packages/core` 配置/目标目录、CLI 兼容层、测试与文档。

## 1. 最终产品形态

Codex Switcher 最终提供两种明确的工作模式。

### 1.1 手动模式

```text
工作环境 → 当前凭证 → 上游服务商
```

这是现有行为的兼容模式：

- 一个环境可以选择一个当前凭证；
- 切换凭证会更新该环境的 Codex 配置；
- 请求不经过模型网关；
- 不需要配置服务商路由、路由组或凭证池；
- 适合单账号、低复杂度和需要完全保持原生行为的用户。

### 1.2 网关模式

```text
工作环境
  ↓
环境级本地网关
  ↓
模型 / 路由组
  ↓
服务商 + 上游模型
  ↓
凭证
  ↓
上游 API
```

网关模式的目标体验：

- 同一环境同时使用 ChatGPT 订阅、API Key、本地模型和自定义兼容接口；
- Codex App 看到的是环境级模型目录，而不是某一个账号私有的模型目录；
- 用户切换模型时不再需要切换账号；
- AUTH 账号和 API Key 都经过同一个本地网关；
- 多个凭证可以组成凭证池；
- 多个模型、服务商和凭证可以组成路由组；
- 同一会话可以保持在同一个凭证上，限流、额度不足或网络失败时自动故障转移。

## 2. 产品命名与领域概念

用户界面不再突出“路由开关”和“账号池开关”，而是使用以下概念。

| 旧概念 | 新概念 | 说明 |
| --- | --- | --- |
| 路由开关 | 网关模式 | 是否由本地统一网关接管当前环境的请求 |
| 账号 | 凭证 | AUTH 订阅、API Key、OAuth、插件登录、本地服务均可作为凭证来源 |
| 账号池 | 凭证池 | 多个同类或兼容凭证之间的选择与故障切换 |
| 路由 | 路由组 | 将多个模型、服务商和凭证组合成一个逻辑模型入口 |
| 环境 | 工作环境 | Codex 配置、会话、模型目录和运行上下文的隔离单元 |
| 上游地址 | 服务商端点 | Provider 的 Responses、Chat、Anthropic、Gemini 等端点 |

### 2.1 为什么不直接把“账号池”改名为“路由组”

模型网关的路由组不只是多个账号，也可以包含多个模型和多个服务商。因此：

- 第一阶段将现有账号池准确升级为“凭证池”；
- 当路由组能够真正包含模型候选和跨服务商候选后，再对外称为“路由组”；
- 内部旧字段 `accountPool`、`route` 暂时保留兼容别名，不在一次升级中强制迁移所有历史数据。

## 3. 当前基线与事实

以下是实施前已经确认的当前结构，后续改动以此为基线。

- 环境和账号是现有核心抽象，账号包含 AUTH/API Key 运行配置。
- `RouteTarget` 当前以账号为中心，包含 `routeId`、`envName`、`accountName`、上游地址和协议信息，见 [usage-routing-model.ts](/Users/wangxt/myspace/codex-switcher/apps/desktop/electron/usage-routing-model.ts)。
- 账号池当前支持粘性会话、权重轮询和基础故障切换，但选择对象仍然是账号成员，模型只是会话键的一部分，见 [account-pool-routing.ts](/Users/wangxt/myspace/codex-switcher/apps/desktop/electron/account-pool-routing.ts:146)。
- 普通环境路由目前过滤 AUTH 账号；账号池的 Responses 路径已经支持 AUTH 与 API Key 混合，见 [usage-router-manager.ts](/Users/wangxt/myspace/codex-switcher/apps/desktop/electron/usage-router-manager.ts:557) 和 [usage-router-manager.test.ts](/Users/wangxt/myspace/codex-switcher/apps/desktop/electron/usage-router-manager.test.ts:249)。
- 模型目录已经存在，但当前主要以账号绑定和活动目标为范围，见 [model-catalog-store.ts](/Users/wangxt/myspace/codex-switcher/apps/desktop/electron/model-catalog-store.ts:18)。
- 当前 UI 分别暴露路由和账号池控制，后续需要收敛为“手动模式/网关模式”的产品概念，底层可继续保留兼容字段。

这些事实决定了本次不是简单删除 AUTH 过滤，而是把现有账号转发能力提炼成统一的 Credential Resolver，并在其上增加模型和服务商路由。

## 4. 设计结论

采用一个环境级网关、两层选择器、一个兼容模式。

```text
请求模型
  ↓
Model Router：根据模型 ID、路由组和规则选择 Provider/Model 候选
  ↓
Credential Resolver：从凭证池选择 AUTH/API Key/OAuth/本地凭证
  ↓
Protocol Adapter：将请求转换为目标协议并注入凭证
  ↓
Provider Transport：发送、重试、记录用量和健康状态
```

### 4.1 一条环境级网关入口

在网关模式下，Codex 配置只指向环境级网关入口，例如：

```text
/gateways/<environmentId>
```

现有 `/routes/<routeId>` 和 `/pools/<poolId>` 可以继续作为内部转发节点或兼容入口，但不再直接暴露为用户的主要模型配置目标。这样可以避免 Codex 配置随着账号切换而频繁重写。

### 4.2 模型路由和凭证选择分离

模型路由负责回答：

> 这次请求应该使用哪个服务商和哪个上游模型？

凭证选择负责回答：

> 使用这个服务商/模型候选下的哪个 AUTH 账号、API Key 或其他凭证？

不能把“模型选择”和“账号轮询”混成一个 `selectPoolMember()`，否则无法支持跨服务商同模型、同模型不同协议和模型级回退。

### 4.3 AUTH 不再被普通网关过滤

AUTH 账号在网关模式下必须作为标准凭证参与解析：

- AUTH：注入 access token 和对应的 `chatgpt-account-id`；
- API Key：注入对应的 API Key；
- OAuth/插件凭证：由 Provider Credential Adapter 负责产生短期访问凭证；
- 不支持当前协议的凭证：在候选过滤阶段被排除，并展示明确原因。

过滤条件应该是“协议、模型能力、Provider 兼容性和凭证健康状态”，而不是简单的 `authMode !== "auth"`。

## 5. 目标数据模型

新增网关域模型，同时保留旧模型作为兼容输入。

### 5.1 GatewayConfig

```ts
type GatewayMode = "direct" | "gateway";

interface GatewayConfig {
  version: 1;
  environmentId: string;
  mode: GatewayMode;
  gatewayId: string;
  defaultRouteGroupId?: string;
  providerIds: string[];
  credentialIds: string[];
  routeGroupIds: string[];
  catalogVersion: number;
}
```

### 5.2 Provider

```ts
interface Provider {
  id: string;
  displayName: string;
  kind: "openai" | "chatgpt" | "anthropic" | "gemini" | "custom" | "local";
  endpoints: {
    responses?: string;
    chatCompletions?: string;
    anthropicMessages?: string;
    gemini?: string;
  };
  modelDiscovery: "manual" | "models_endpoint" | "preset" | "plugin";
  enabled: boolean;
}
```

### 5.3 Credential

```ts
interface Credential {
  id: string;
  providerId: string;
  displayName: string;
  kind: "auth" | "api_key" | "oauth" | "plugin" | "local";
  secretRef: string;
  accountId?: string;
  supportedProtocols: Array<"responses" | "chat_completions" | "anthropic" | "gemini">;
  status: "active" | "cooldown" | "invalid" | "expired" | "disabled";
  weight?: number;
  priority?: number;
}
```

密钥和 access token 不直接写入普通路由配置，继续复用现有安全存储/账号存储机制；路由配置只保存 `secretRef` 和必要的非敏感元数据。

### 5.4 ModelDefinition

```ts
interface ModelDefinition {
  id: string;
  providerId: string;
  upstreamModelId: string;
  displayName: string;
  protocols: Array<"responses" | "chat_completions" | "anthropic" | "gemini">;
  capabilities: {
    reasoning?: boolean;
    tools?: boolean;
    vision?: boolean;
    streaming?: boolean;
  };
  enabled: boolean;
}
```

### 5.5 RouteGroup

```ts
interface RouteGroup {
  id: string;
  displayName: string;
  exposedModelId: string;
  members: Array<{
    providerId: string;
    modelId: string;
    credentialSelector: {
      credentialIds?: string[];
      providerId?: string;
    };
    priority: number;
    weight: number;
  }>;
  strategy: "smart" | "order" | "rotate" | "usage" | "pace" | "weighted_round_robin";
  sessionPolicy: "auto" | "session" | "turn" | "off";
  fallbackEnabled: boolean;
  rules?: RouteRule[];
}
```

### 5.6 路由规则

第一版只支持确定性规则：

- 请求模型精确匹配；
- Provider/Model 命名空间匹配；
- 协议能力匹配；
- 上下文长度匹配；
- 是否支持工具、图片、推理等能力匹配。

不支持基于 Prompt 的意图分类或意图路由；该能力已从产品范围永久移除。

## 6. 分阶段开发计划

每个阶段都必须先完成单元测试/集成测试，再进入下一阶段。复杂任务的执行状态应同步到 `.wxt/model-gateway-upgrade.md`。

### 阶段 0：基线、契约和迁移边界

目标：冻结现有行为，定义新旧配置的转换边界。

工作项：

1. 盘点环境、账号、运行时配置、模型目录、路由和账号池的持久化入口。
2. 定义 `GatewayConfig`、`Provider`、`Credential`、`ModelDefinition`、`RouteGroup` 的 TypeScript 类型。
3. 定义旧配置到新配置的只读适配器，不立即修改旧数据格式。
4. 明确 `direct` 和 `gateway` 两种模式的状态迁移矩阵。
5. 增加配置版本号、未知字段保留策略和失败回滚策略。

主要范围：

- `packages/core/src/state/store.ts`
- `apps/desktop/electron/usage-routing-model.ts`
- 新增 `apps/desktop/electron/model-gateway-model.ts`
- 新增迁移和序列化测试

验收：

- 旧配置可以读取；
- 新配置可以读写；
- 未开启网关的环境行为与升级前一致；
- 迁移失败不会覆盖原始配置；
- 所有敏感字段不会进入普通网关配置。

回滚点：只启用读取适配器，关闭新配置写入即可回退。

### 阶段 1：Provider 和 Credential 统一层

目标：把 AUTH、API Key 和自定义 Provider 凭证统一成可解析的凭证对象。

工作项：

1. 从现有账号运行时配置抽取 Provider 信息。
2. 抽取 AUTH access token、account ID、API Key，并生成 `Credential`。
3. 实现 `CredentialResolver`。
4. 实现 `ProviderCredentialAdapter`，负责不同凭证类型的请求头、account ID 和 token 生命周期。
5. 将 AUTH 普通路由从“过滤”改为“能力检查后纳入候选”。
6. 保留 Chat Completions 对不兼容 AUTH 的明确拒绝逻辑；不能静默转发失败。

主要范围：

- `apps/desktop/electron/bridge.ts`
- `apps/desktop/electron/usage-router-manager.ts`
- `apps/desktop/electron/usage-router-service.ts`
- 新增 `credential-resolver.ts`
- 新增 `provider-credential-adapters.ts`

验收：

- Responses 网关可以选择 AUTH；
- Responses 网关可以选择 API Key；
- AUTH 与 API Key 可以在同一凭证池中；
- AUTH 请求带正确的 access token 和 account ID；
- API Key 请求不会携带不属于它的 ChatGPT account ID；
- 无效、过期、冷却中的凭证不会被选中；
- 现有账号池测试全部保持通过。

回滚点：保留旧的 `getEnvironmentRouteAccounts()` 作为 fallback，网关解析失败时不修改现有直接切换逻辑。

### 阶段 2：环境级网关入口

目标：让 Codex 在网关模式下只连接一个环境级入口。

工作项：

1. 新增环境级 Gateway Runtime。
2. 建立 `/gateways/<environmentId>` 入口。
3. 保留 `/routes/<routeId>` 和 `/pools/<poolId>` 作为内部兼容节点。
4. 为每个请求建立统一的 `GatewayRequestContext`。
5. 从请求中提取环境、协议、模型、会话、请求 ID 和能力信息。
6. 取消“每个环境只能依赖一个账号路由”的隐含假设。
7. 支持网关启动、停止、重载和端口冲突恢复。

主要范围：

- `apps/desktop/electron/usage-router-service.ts`
- `apps/desktop/electron/usage-router-manager.ts`
- 新增 `model-gateway-service.ts`
- 新增 gateway runtime 状态测试

验收：

- 网关模式下环境只需一个 Base URL；
- 多个账号不会导致 Codex 配置不断改写 Base URL；
- 网关停止时能给出可识别的本地错误；
- 重新加载配置不会中断已有连接之外的其他环境；
- 旧 `/routes` 和 `/pools` 行为仍可兼容。

回滚点：网关入口不可用时，允许用户一键回到手动模式，恢复最后一次直接配置。

### 阶段 3：模型目录和 Codex App 配置同步

目标：让 Codex App 看见网关模式下的全部可用模型。

工作项：

1. 建立环境级聚合模型目录。
2. 将 Provider、Model、RouteGroup 转换成 Codex 可识别的模型项。
3. 支持 `provider/model` 和 `group/<id>` 命名空间，避免同名模型冲突。
4. 保存逻辑模型 ID 与上游模型 ID 的映射。
5. 只将启用且至少有一个健康候选的模型写入配置。
6. 处理模型能力、上下文长度、推理参数、工具和多模态元数据。
7. 修复当前只按活动账号同步模型目录的问题。
8. 在网关配置变化、凭证变化、模型变化和环境切换时触发目录重建。
9. 写入失败时保留上一次有效模型目录，并展示错误原因。

主要范围：

- `apps/desktop/electron/model-catalog-store.ts`
- `apps/desktop/electron/account-model-catalog.ts`
- `apps/desktop/electron/bridge.ts`
- `packages/core/src/system/target-home.ts`
- `apps/desktop/src/pages/models-page.tsx`

验收：

- 同一环境可同时看到 ChatGPT、DeepSeek、Claude 和自定义模型；
- 切换模型不需要切换账号；
- 模型显示名称、模型 ID 和上游映射稳定；
- 删除某个凭证不会误删仍由其他候选提供的模型；
- 没有可用候选的模型不会出现在列表中；
- Codex 重启后仍能读取正确目录。

回滚点：保留最后一次可用 `model_catalog_json`，新目录生成失败时继续使用旧目录。

### 阶段 4：Model Router 和路由组

目标：实现真正按模型和服务商进行路由，而不是只在账号之间轮询。

工作项：

1. 实现模型精确匹配和逻辑模型到上游模型的映射。
2. 实现 Provider/Model 候选过滤。
3. 实现 RouteGroup 成员排序和优先级。
4. 让一个路由组包含多个服务商的同类模型。
5. 支持同一个模型逻辑 ID 对应不同上游模型 ID。
6. 明确模型能力不足时的拒绝原因。
7. 请求中模型不存在时返回可诊断错误，不进行危险的模糊匹配。
8. 将 `selectPoolMember()` 拆为 Model Router 和 Credential Resolver 两个阶段。

推荐的默认匹配顺序：

```text
精确 routeGroup ID
  → 精确 exposedModelId
  → provider/model 命名空间
  → 已声明的别名
  → 无匹配时拒绝
```

验收：

- 请求 `deepseek-chat` 不会被误发到 ChatGPT；
- 请求 `group/fast-coding` 能在多个候选服务商间路由；
- 上游请求的 model 字段被正确改写为 `upstreamModelId`；
- 路由组成员不可用时只尝试协议和能力兼容的备用成员；
- 请求日志能显示逻辑模型、上游模型和最终服务商。

回滚点：关闭路由组后，所有模型回退为单 Provider/单 Credential 直连网关。

### 阶段 5：凭证池策略、会话保持和故障切换

目标：把现有基础账号池升级为可配置凭证池。

第一批策略：

- `order`：按优先级顺序使用；
- `rotate`：请求或轮次轮换；
- `weighted_round_robin`：兼容现有策略；
- `smart`：健康状态、优先级、权重综合选择；
- `usage`：优先选择剩余额度或使用量更合适的凭证；
- `pace`：按额度重置时间安排使用。

会话策略：

- `auto`：默认，一轮内保持，跨轮按缓存和健康情况决定；
- `session`：整个会话保持；
- `turn`：仅保持当前轮；
- `off`：每个请求重新选择。

工作项：

1. 将成功凭证绑定到会话上下文。
2. 解析 Retry-After、额度错误和可重试的 5xx。
3. 建立按凭证、Provider、模型的 cooldown 状态。
4. 在首字节返回前进行有限次数的故障转移。
5. 防止非幂等或已经开始输出的请求被重复发送。
6. 记录每次重试原因和最终接管成员。
7. 保持现有粘性会话行为的兼容默认值。

验收：

- 被限流的凭证在 Retry-After 期间不会被反复击打；
- 网络失败可以切到下一候选；
- 已开始流式输出后不会再次偷偷切换；
- 同一会话默认保持在原凭证；
- 手动模式不受新策略影响。

回滚点：将策略固定为 `order`，禁用高级用量排序，但保留基本故障切换。

### 阶段 6：协议适配和模型能力兼容

目标：从当前 OpenAI Responses/Chat 兼容转发扩展到统一协议适配层。

第一阶段支持：

- OpenAI Responses；
- OpenAI Chat Completions。

第二阶段支持：

- Anthropic Messages；
- Google Gemini。

工作项：

1. 定义统一内部请求/响应模型。
2. 将协议解析、模型路由、凭证注入和传输拆开。
3. 实现流式响应、工具调用、推理内容、图片输入和 usage 映射。
4. 处理协议能力不对称时的明确拒绝和降级。
5. 为每种协议建立固定 fixture。
6. 避免把一个协议的私有字段未经验证透传到另一个协议。

主要范围：

- `apps/desktop/electron/usage-router-service.ts`
- 新增 `protocol-adapters/`
- `docs/compatibility/`
- 对应协议 fixture 和集成测试

验收：

- Responses、Chat、Anthropic、Gemini 的普通文本流式请求可完成；
- 工具调用可以完整往返；
- 推理参数不会错误地覆盖不支持的上游；
- usage 统计字段映射稳定；
- 不支持的能力会给出可读错误，而不是损坏响应。

回滚点：协议适配器按 Provider 开关，任一新协议失败不影响 Responses/Chat。

### 阶段 7：用量、配额、健康和可观测性

目标：达到可运营的网关状态可视性。

工作项：

1. 记录请求 ID、环境、Agent、逻辑模型、上游模型、Provider、Credential、状态和延迟。
2. 记录输入 token、输出 token、缓存命中和估算费用。
3. 支持 Provider 返回的余额、配额和重置时间。
4. 对凭证建立健康状态和冷却状态。
5. 增加路由决策记录：为什么选中、为什么跳过、为什么故障转移。
6. 在 UI 增加最近请求、错误率、当前候选和冷却信息。
7. 日志默认脱敏，不记录完整 prompt、token 和 API Key。

验收：

- 用户能按环境、模型、服务商和凭证查看请求统计；
- 失败请求可以追溯到候选筛选和重试原因；
- 日志中不会出现 access token、API Key 或完整请求正文；
- 关闭统计功能后不影响核心请求转发。

回滚点：关闭费用和正文级统计，只保留最小路由健康日志。

### 阶段 8：UI 和配置交互重构

目标：让用户以统一的模型供应链方式使用，但不增加不必要的认知负担。

#### 环境页

增加“连接模式”：

- 手动模式；
- 模型网关模式。

手动模式显示：

- 当前凭证；
- 当前上游；
- 切换凭证；
- 恢复原生配置。

网关模式显示：

- 网关状态和入口；
- 默认模型/路由组；
- 当前 Provider 和 Credential；
- 最近一次路由决策；
- 凭证池和故障切换状态。

#### 服务商页

新增或扩展服务商管理：

- 服务商名称、协议和端点；
- 添加订阅或 API Key；
- 自定义兼容 URL；
- 模型发现和手动模型添加；
- 测试连接；
- 启用/禁用服务商。

#### 模型页

模型项显示：

- 逻辑模型名称；
- Provider 来源；
- 上游模型 ID；
- 能力标签；
- 是否属于路由组；
- 可用凭证数量；
- 当前健康状态。

#### 路由组页

允许用户：

- 创建逻辑模型入口；
- 添加多个 Provider/Model 成员；
- 绑定凭证或凭证池；
- 选择策略和会话保持；
- 设置备用成员；
- 查看路由测试结果。

验收：

- 新用户只配置一个服务商时不需要理解路由组；
- 旧用户进入手动模式时不被迫迁移；
- 开启网关时系统能预览将写入 Codex 的模型列表；
- 关闭网关时可以恢复最后一次手动配置；
- 网关配置错误有明确的修复入口。

### 阶段 9：配置迁移、导入、恢复和兼容发布

目标：确保升级不会破坏已有环境、账号和模型目录。

迁移规则：

1. 旧环境默认迁移为 `direct` 手动模式。
2. 旧账号映射为 Credential；原账号名称和 ID 保留。
3. 旧普通路由映射为单成员 RouteGroup 或固定网关候选。
4. 旧账号池映射为同 Provider 的 Credential Pool。
5. 已有自定义模型保留，不自动覆盖其显示名和能力参数。
6. 新网关模型目录写入失败时不覆盖旧目录。
7. 迁移必须可重复执行，不得重复创建 Provider、Credential 或 RouteGroup。
8. 迁移过程写入版本、结果和错误摘要。

需要提供：

- 迁移预览；
- 备份；
- 一键回退到手动模式；
- 恢复原始 Codex 配置；
- 旧字段兼容读取至少一个大版本周期。

验收：

- 从当前版本升级后可以打开所有环境；
- 现有手动切换测试全部通过；
- 迁移后用户可以继续使用旧账号；
- 网关模式失败不影响手动模式恢复；
- Windows、macOS 和 Linux 路径行为一致。

### 阶段 10：高级 Provider 能力对齐

目标：在基础网关稳定后，补齐生产级 Provider 高级能力。

#### 10.1 供应商导入和配置恢复

- 从 Codex 配置导入自定义 Provider；
- 导入 Claude Code/OpenAI 兼容配置；
- 只复制用户明确选择的 Provider；
- 支持恢复 Agent/Codex 原生配置；
- 保留未被网关管理的字段和注释。

#### 10.2 明确排除：意图路由

本历史章节不再对应实现阶段。当前网关不分析 Prompt、不调用分类模型、不保存意图规则，也不根据自然语言内容选择路由；用户必须显式选择模型或路由组。

#### 10.3 Provider 插件

- Provider 插件负责登录和刷新订阅凭证；
- 插件输出统一 Credential 接口；
- 路由、用量和故障切换由核心网关统一处理；
- 插件不能直接绕过权限和敏感信息存储策略。

#### 10.4 多 Agent 扩展

当前项目优先服务 Codex。多 Agent 支持不应阻塞基础版本，但架构需要保留：

- Agent 作为网关客户端配置，而不是网关核心对象；
- 每个 Agent 可选择不同的逻辑模型/路由组；
- 保存和恢复每个 Agent 的原始配置；
- 未来可扩展 Claude Code、Gemini CLI、OpenCode 等。

## 7. 关键接口建议

### 7.1 解析请求

```ts
resolveGatewayRequest(context: GatewayRequestContext): Promise<ResolvedRoute>
```

返回：

```ts
interface ResolvedRoute {
  logicalModelId: string;
  providerId: string;
  upstreamModelId: string;
  credentialId: string;
  protocolAdapter: string;
  sessionBindingKey: string;
  decisionTrace: string[];
}
```

### 7.2 选择凭证

```ts
selectCredential(input: {
  providerId: string;
  modelId: string;
  protocol: RequestProtocol;
  sessionKey?: string;
  routeGroupId?: string;
}): Promise<CredentialSelection>
```

### 7.3 网关配置同步

```ts
syncEnvironmentGatewayCatalog(environmentId: string): Promise<ModelCatalogSyncResult>
```

该接口必须是环境级的，不再只同步当前账号的模型目录。

## 8. 兼容和安全原则

### 8.1 兼容原则

- 旧环境默认仍是手动模式；
- 旧账号和 CLI 命令继续可用；
- 旧 `/routes`、`/pools` 内部接口保留兼容期；
- 新功能通过能力探测和版本号启用；
- 网关启动失败不应导致用户无法进入环境或恢复手动模式。

### 8.2 安全原则

- API Key、access token、refresh token 永不写入普通日志；
- 网关配置只保存 secret reference；
- AUTH 请求必须绑定正确的 ChatGPT account ID；
- 自定义 Provider 连接需要校验 URL 和本地回环/内网访问风险；
- 路由决策日志默认不保存完整 prompt；
- 迁移备份需要明确保存位置和可删除方式。

### 8.3 请求重试原则

- 首字节之前允许有限故障切换；
- 已经开始流式响应后不切换上游；
- 非幂等请求不做无条件重试；
- 额度、认证、协议不兼容等永久错误不重复重试；
- 每次重试必须记录原因和候选变化。

## 9. 验证矩阵

### 单元测试

- GatewayConfig 序列化、版本迁移和未知字段保留；
- AUTH/API Key Credential Resolver；
- Provider/Model 精确匹配；
- RouteGroup 成员排序；
- 模型改写；
- 会话保持；
- Retry-After 和 cooldown；
- 模型目录聚合与去重；
- 协议能力过滤。

### 集成测试

- 单环境单 Provider 单 Credential；
- 单环境多 Provider；
- 同一模型跨 Provider；
- AUTH + API Key 混合 Responses；
- 多个 API Key 故障切换；
- 模型不存在；
- 上游限流；
- 上游返回 401/403/429/5xx；
- 流式输出开始后的失败；
- 网关关闭和端口冲突；
- 网关配置重载；
- 手动模式和网关模式来回切换。

### UI/配置验证

- Codex App 可以看到网关聚合模型；
- 切换模型不改变当前凭证；
- 手动切换凭证不破坏网关配置；
- 关闭网关后恢复原生 Base URL；
- 自定义模型重启后仍存在；
- 错误状态和恢复按钮清晰可见。

### 跨平台验证

- macOS：AUTH、API Key、网关端口和 Codex App 配置；
- Windows：路径、进程、端口、配置锁和自动恢复；
- Linux：配置目录、后台进程和 CLI 兼容。

### 发布前命令

```bash
npm run lint
npm run core:test
npm run core:build
npm run desktop:test
npm run desktop:build
npm test
```

如果新增协议或 Provider fixture，还要执行对应的协议集成测试和跨平台手动清单。

## 10. 里程碑与交付顺序

### M0：契约冻结

完成阶段 0。可以读取旧配置，能够生成新配置草案，但默认不改变用户行为。

### M1：统一凭证网关

完成阶段 1-2。AUTH 和 API Key 可以通过同一个环境网关转发，仍以单模型/单 Provider 为主。

### M2：模型目录和模型路由

完成阶段 3-4。同一环境能够看到并选择多个 Provider 的模型，模型请求不会被错误发给其他 Provider。

### M3：生产级凭证池

完成阶段 5。支持会话保持、限流冷却、有限重试和故障切换。

### M4：可运营网关

完成阶段 6-7。协议适配、用量、配额、健康和路由记录可用。

### M5：产品体验和兼容发布

完成阶段 8-9。用户可以直观选择手动模式或网关模式，旧用户无感升级并可以回退。

### M6：高级 Provider 能力

完成阶段 10。按优先级实现导入恢复、Provider 插件和多 Agent 扩展；意图路由不在产品范围内。

## 11. 明确不在第一版阻塞范围内的内容

- 不立即支持所有第三方 Agent；
- 不实现自动意图分类或意图路由；这是永久产品边界，不是延期项；
- 不立即实现完整的 Provider 插件市场；
- 不强制重命名所有旧持久化字段；
- 不在网关升级中重写整个账号管理系统；
- 不把所有供应商的配额和费用强行推断成统一精确值；
- 不允许模型路由绕过现有账号权限和安全存储。

## 12. 最终验收标准

以下条件全部满足，才认为本次升级完成：

1. 关闭网关时，现有手动切换账号行为保持不变。
2. 开启网关后，一个环境只需要一个统一网关入口。
3. 同一环境可以同时使用 AUTH、API Key 和自定义 Provider。
4. AUTH 不因身份类型被普通网关无条件过滤。
5. Codex App 可以看到环境级聚合模型目录。
6. 请求会按照逻辑模型和路由组选择 Provider/Model，而不是只按账号轮询。
7. 凭证池可以独立于模型路由工作，并支持会话保持和基础故障切换。
8. 上游模型 ID 可以和 Codex 暴露的逻辑模型 ID 分离。
9. 网关失败、迁移失败和配置同步失败时可以恢复手动模式。
10. AUTH、API Key、模型路由、限流、流式输出和配置迁移均有自动化测试。
11. 生产构建、核心测试、桌面测试和跨平台检查全部通过。
12. 文档能够解释手动模式、网关模式、服务商、凭证、凭证池和路由组的区别。

## 13. 当前实施规则

- 一次只推进一个阶段中的一个最小切片。
- 每个切片完成后立即运行对应验证。
- 不在本任务中覆盖现有用户未提交的修改。
- 如果新事实改变了数据模型或兼容边界，先更新本计划和执行清单，再继续编码。
- 任何涉及生产代码的阶段，都必须同步维护 `.wxt/model-gateway-upgrade.md` 的状态和验证证据。
