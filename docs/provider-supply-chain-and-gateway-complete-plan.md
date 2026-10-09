# Provider 供应链与统一网关完整开发方案

状态：实施中

本方案是当前项目的完整交付方案。所有阶段、所有清单项和所有验收条件均为必做项，不设置 MVP 截断，不以“主链路可用”代替完整交付。

## 1. 目标

将当前项目升级为统一的 Provider 供应链和模型请求路由层：

- API / 云服务商、订阅服务、本地服务和自定义兼容接口使用统一 Provider Registry。
- 账号是 Provider 的凭据实例，模型是 Provider 暴露的能力，路由是模型和账号的组合。
- 支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Google Gemini 四类协议。
- 同一模型可绑定多个账号，同一模型也可由多个 Provider 提供。
- 网关模式使用模型路由、账号池、故障转移和会话保持。
- 非网关模式继续保留现有的手动账号切换。
- Provider、账号、模型和路由成员均显示本地打包的图标。
- Codex 模型目录只暴露真实可用且已经编译出路由的模型。
- 不实现意图识别、提示词分类或基于用户意图的路由。

## 2. 现状依据

当前项目已经具备以下可复用能力：

- `packages/core/src/gateway/model.ts`：网关 Provider、Credential、Model、RouteGroup 和协议类型。
- `packages/gateway/src/provider/adapters.ts`：Provider Adapter、账号认证、模型发现、配额和错误分类接口。
- `packages/gateway/src/provider/registry.ts`：Provider Adapter 注册表。
- `apps/desktop/electron/model-catalog-store.ts`：模型记录和账号多对多绑定。
- `apps/desktop/electron/gateway-model-discovery.ts`：按 Provider 和账号发现模型。
- `apps/desktop/electron/provider-plugin-runtime.ts`：Provider 插件运行时。
- `apps/desktop/electron/gateway-model-bindings.ts`：环境、模型、账号和路由成员编译。
- `apps/desktop/src/pages/accounts-page.tsx`：现有账号配置入口。
- `apps/desktop/src/pages/models-page.tsx`：现有模型编辑和账号绑定入口。

当前缺口：

- Provider ID 和账号页面仍然硬编码，覆盖范围不足。
- Provider 元数据、认证方式、协议、模型发现策略和图标没有统一数据源。
- 通用网关模型目录和 Codex 专用模型目录边界不够清晰。
- 模型身份没有统一使用 `providerId + upstreamModelId`。
- 订阅账号没有与 API Key 账号使用相同的 ProviderAccount 抽象。
- Provider 图标资源和图标回退机制不存在。

## 3. 产品分类与技术边界

产品界面展示三类入口：

1. API / 云服务商
2. 订阅服务
3. 本地与自定义兼容接口

协议不是 Provider 分类，而是 Provider 的能力维度：

- `responses`
- `chat_completions`
- `anthropic`
- `gemini`

必须保持以下请求链路：

```text
Codex / CLI / App
  -> 本地网关
  -> 解析协议和 model
  -> Model Registry
  -> RouteGroup / ModelBinding
  -> AccountPool
  -> Provider Adapter
  -> 上游协议请求
  -> 响应转换
```

明确不包含：

- 意图路由
- 提示词分类路由
- 自动猜测用户目的的模型选择
- 将 Provider API Key 写入 Codex 配置文件
- 远程下载 Provider 图标
- 恢复设置页中已经删除的 Provider 运行时和网关运营面板

## 4. Provider 清单

### 4.1 API / 云服务商

必须支持：

Anthropic、OpenAI、Google Gemini、DeepSeek、Kimi / Moonshot、Zhipu GLM、MiniMax、StepFun、Qwen、百度千帆、腾讯云、华为云 MaaS、火山引擎 Ark、Mistral、Groq、xAI、OpenRouter、Together、Fireworks、SiliconFlow、NVIDIA NIM、ModelScope。

### 4.2 订阅服务

必须支持：

Claude、ChatGPT / Codex、GitHub Copilot、Gemini、Grok、Cursor、Devin。

订阅 Provider 与同厂商 API Provider 使用不同的稳定 ID。例如：

```text
openai-api           != chatgpt-subscription
anthropic-api       != claude-subscription
google-gemini-api   != gemini-subscription
xai-api             != grok-subscription
```

### 4.3 本地与自定义

必须支持：

- Ollama
- LM Studio
- 任意 OpenAI 兼容接口
- 任意 Anthropic 兼容接口

## 5. 统一数据契约

### 5.1 ProviderDefinition

Provider 定义是唯一的供应商元数据来源：

```ts
interface ProviderDefinition {
  id: string;
  displayName: string;
  category: "api" | "subscription" | "local" | "custom";
  iconKey: string;
  authMethods: Array<"api_key" | "oauth" | "subscription" | "none" | "plugin">;
  supportedProtocols: Array<"responses" | "chat_completions" | "anthropic" | "gemini">;
  adapterId: string;
  discoveryMode: "remote" | "preset" | "local" | "plugin" | "manual";
  endpoints: ProviderEndpoint[];
  capabilities: {
    modelDiscovery: boolean;
    quota: boolean;
    tokenRefresh: boolean;
    accountPool: boolean;
    protocolConversion: boolean;
  };
}
```

### 5.2 ProviderAccount

```ts
interface ProviderAccount {
  id: string;
  providerId: string;
  displayName: string;
  authMethod: string;
  secretRef: string;
  status: "active" | "expired" | "invalid" | "cooldown" | "disabled";
  supportedProtocols: GatewayProtocol[];
  allowedModelIds?: string[];
  proxyUrl?: string;
}
```

真实密钥、OAuth Token 和订阅凭据只能通过现有安全存储或 Provider 自己的凭据位置解析，网关状态只保存 `secretRef`。

### 5.3 ProviderModel

```ts
interface ProviderModel {
  id: string;
  providerId: string;
  upstreamModelId: string;
  exposedModelId: string;
  displayName: string;
  iconKey: string;
  supportedProtocols: GatewayProtocol[];
  capabilities: {
    reasoning: boolean;
    tools: boolean;
    vision: boolean;
    streaming: boolean;
  };
}
```

模型内部唯一身份为：

```text
providerId + upstreamModelId
```

模型对 Agent 暴露时使用：

```text
provider/model
```

同一个 Provider 下的多个账号不复制模型记录，而是绑定多个 ProviderAccount。

## 6. Adapter 结构

不能为每个供应商重复实现完整请求栈，采用“Provider 预设 + 协议 Adapter + 特殊认证 Adapter”：

### 6.1 协议 Adapter

- OpenAI Compatible
- OpenAI Responses
- Anthropic Messages
- Google Gemini

### 6.2 Provider 预设

每个预设只提供差异化配置：

- 默认 Base URL
- 默认模型发现地址
- 默认认证头
- 默认协议
- 特殊请求头
- 模型能力补充
- 配额地址
- 图标

### 6.3 订阅 Adapter

订阅 Provider 必须支持：

- 登录和授权
- 账号发现
- Token 刷新
- 模型发现
- 配额或额度状态
- 请求签名
- 失败分类
- 多账号故障转移

不能将订阅账号伪装成普通 API Key。

## 7. 模型发现与目录同步

模型发现优先级：

1. Provider 账号真实模型接口
2. 本地 Provider 的模型接口
3. Provider 预设模型
4. 已明确输入的手动模型
5. 外部模型元数据补充能力字段

必须区分两类目录：

```text
Provider Model Registry
  -> Gateway Model Catalog
  -> Codex model_catalog_json
```

通用目录包含 Provider、上游模型 ID、协议和能力；Codex 目录额外必须生成：

- `supported_reasoning_levels`
- `default_reasoning_level`
- `input_modalities`
- `supports_parallel_tool_calls`
- `supports_reasoning_summaries`
- `context_window`
- `visibility`
- `supported_in_api`

任何 Codex 模型条目都不能缺失必需字段。没有可用账号、协议不兼容或路由无法编译的模型不得写入 Codex 目录。

## 8. 路由和账号池

### 8.1 同一模型的多个账号

```text
provider/model
  -> account A
  -> account B
  -> account C
```

通过账号池策略选择：

- smart
- order
- rotate
- usage
- pace
- weight

### 8.2 多 Provider 的同名模型

不自动进行意图判断，只允许用户创建或确认显式路由组：

```text
group/daily-coding
  -> deepseek/deepseek-chat
  -> openrouter/deepseek-chat
  -> chatgpt/gpt-5.6-luna
```

### 8.3 路由编译约束

路由成员必须同时满足：

- Provider 存在且启用
- 模型存在且启用
- 账号存在且可用
- 账号允许该模型
- 账号支持入口协议或存在协议转换
- 上游模型 ID 非空
- 目标 Provider Adapter 已注册

不满足条件时，路由编译失败并输出 Provider、模型、账号和协议的具体原因。

## 9. 桌面端产品设计

### 9.1 Provider 页面

新增独立 Provider 页面，不放入设置页：

- API / 云服务商
- 订阅服务
- 本地与自定义

Provider 卡片显示：

- Provider 图标
- 名称和分类
- 支持协议
- 账号数量
- 模型数量
- 登录或连接状态
- 刷新模型
- 添加账号

### 9.2 账号页面

添加账号时先选择 Provider，再选择认证方式。账号卡片显示：

- Provider 图标
- Provider 名称
- 账号名称
- 认证类型
- 支持模型数量
- 当前健康状态
- 所属环境

### 9.3 模型页面

将现有模型页面升级为“模型与路由”：

- 全部模型
- 路由组

模型条目显示 Provider 图标、Provider 名称、模型名称、协议能力和可用账号数。

绑定账号时按环境分组，只展示能够提供该模型的账号，并允许设置优先级、权重、上游模型 ID 和启用状态。

### 9.4 图标系统

新增本地 `ProviderIcon` 组件和图标注册表：

- 图标随应用打包
- 不从网络加载
- 支持浅色和深色主题
- 支持 20 / 24 / 32 像素
- 未知 Provider 使用通用图标或首字母回退
- 图标具备无障碍文本

## 10. 兼容与迁移

保留现有手动模式、环境、账号、模型绑定和路由配置。

旧 Provider ID 使用别名迁移：

```text
kimi -> moonshot
glm / zai -> zhipu
chatgpt / codex-subscription -> chatgpt-subscription
```

旧模型记录自动补齐：

- providerId
- upstreamModelId
- exposedModelId
- supportedProtocols
- capabilities
- iconKey

迁移必须幂等、可重复执行，并在失败时保留原始文件备份。

## 11. 必须完成的实施阶段

| 阶段 | 必须交付 | 验证要求 |
| --- | --- | --- |
| 1 | Provider、Account、Model、Protocol 统一契约 | core 类型检查、序列化和排除意图字段测试 |
| 2 | 全部 Provider Registry 和别名迁移 | 清单覆盖测试、旧配置迁移测试 |
| 3 | OpenAI、Responses、Anthropic、Gemini 协议 Adapter | 四类协议请求/流式/工具/推理测试 |
| 4 | 全部 API / 云 Provider 预设和模型发现 | 每个 Provider 的地址、认证、模型发现 mock 测试 |
| 5 | Ollama、LM Studio、OpenAI 兼容、Anthropic 兼容接口 | 本地和自定义接口集成测试 |
| 6 | ChatGPT、Claude、Copilot、Gemini、Grok、Cursor、Devin 订阅 Adapter | 登录、刷新、模型发现、失败和账号池测试 |
| 7 | Provider Model Registry 与 Codex 目录同步 | 必需字段、无模型不暴露、原子写入测试 |
| 8 | 模型绑定、账号池、显式路由组和会话保持 | 同模型多账号、跨 Provider、多协议路由测试 |
| 9 | Provider 页面、账号页面、模型页面和图标系统 | 页面交互、图标回退、筛选和绑定测试 |
| 10 | 配置迁移、日志和诊断 | 旧版本数据迁移、根因日志和错误码测试 |
| 11 | Intel macOS / Apple Silicon macOS 构建 | 本地构建、安装包内容和启动检查 |
| 12 | GitHub Actions 自动打包发布 | 三平台工作流、Release 资产和版本检查 |

所有阶段必须完成后，目标才允许标记完成。

## 12. 验收矩阵

必须验证：

- 22 个 API / 云 Provider 都可以添加、发现模型并进入路由。
- 7 个订阅 Provider 都有独立认证和账号状态处理。
- Ollama、LM Studio、OpenAI 兼容和 Anthropic 兼容接口可用。
- 四类协议均能完成请求、流式响应、工具调用和推理字段转换。
- 同模型多账号能够按策略切换和故障转移。
- 同名模型跨 Provider 能加入显式路由组。
- Codex App 只能看到实际存在路由的模型。
- Codex 模型目录不会缺少必需字段。
- Provider、账号、模型和路由成员均有图标。
- 手动模式仍能直接切换账号。
- 网关关闭时停止当前网关服务并恢复直接配置。
- 日志能够定位环境、Provider、模型、协议、账号、路由和上游错误。
- 日志和项目文件不写入外部产品名称或外部产品文案。

## 13. 风险与回退

- 新目录格式使用版本号和幂等迁移；旧文件迁移失败时保留备份。
- Provider Adapter 失败时不生成可用模型，不影响旧手动账号切换。
- 网关路由编译失败时阻止启动，并保留上一份有效路由快照。
- 图标缺失时回退通用图标，不阻塞 Provider 使用。
- 订阅凭据只读取已有安全存储或 Provider 自己的凭据位置，不复制明文密钥。
- 未签名安装包不纳入签名验证要求，但必须验证打包产物可启动。

## 14. 完成定义

只有同时满足以下条件，整个开发目标才算完成：

1. 所有实施阶段状态为 done。
2. 所有 Provider 清单覆盖测试通过。
3. 所有协议和路由验证通过。
4. 所有 UI、迁移、图标和目录同步验证通过。
5. Intel macOS 和 Apple Silicon macOS 构建成功。
6. GitHub Actions 发布成功。
7. 工作区无本次功能遗漏的未提交生产改动。
8. 发布版本、变更日志和文件中不出现外部产品名称或外部产品文案。
