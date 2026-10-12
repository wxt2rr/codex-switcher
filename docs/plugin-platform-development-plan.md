# Codex Switcher 插件平台完整开发计划

## 1. 目标

将现有 Provider 插件运行时升级为完整的插件生态平台：外部开发者可以开发并分发插件，用户可以在桌面应用中发现、安装、授权、配置、启停、升级、回滚和诊断插件；插件可以提供服务商、账号认证、动态模型、配额、请求适配以及安全的 Gateway Middleware。

首个官方插件为独立的 `csw-our-free-model`，它通过稳定 JSON-RPC 合约接入，不能通过核心代码特殊分支实现；外部插件推荐直接使用公开 Plugin SDK。

## 2. 设计边界

```text
Plugin Package
  -> Manifest / Signature / Checksum
  -> Plugin Installation Store
  -> Sandboxed Plugin Host + JSON-RPC
  -> Provider Registry / Middleware Registry
  -> Account Store / Model Catalog / Route Groups
  -> Unified Gateway
  -> Codex / Claude Code / ZCode / WorkBuddy / other clients
```

- Provider 插件负责上游差异：认证、刷新、模型发现、配额、请求签名和特殊请求流。
- Middleware 插件负责统一网关上的请求、流式事件和响应处理。
- 核心负责协议转换、账号持久化、模型暴露、路由、失败转移和客户端适配。
- 插件不直接修改客户端配置，不读取非当前账号凭证，不启动替代核心 Gateway 的主服务。
- 插件设置使用宿主渲染的 Schema，不允许任意页面代码进入 Electron 主界面。

## 3. 兼容与版本

- 保持现有 `apiVersion: 1` Provider 插件可用。
- 新增 API v2：多 Provider 描述、Provider 自定义请求、Middleware、设置 Schema、诊断和能力协商。
- 插件通过 `apiVersion` 和 capability handshake 声明能力，宿主拒绝不支持的能力，不静默降级到不安全路径。
- Provider ID 使用命名空间，冲突时要求用户显式选择，不使用“后安装覆盖先安装”。

## 4. Provider API

基础方法（宿主内部的账号生命周期会映射到插件 RPC）：

```text
plugin.describe
provider.describe
provider.auth.methods
provider.auth.authorize
provider.auth.refresh
provider.auth.revoke
provider.models
provider.quota
provider.diagnose
```

公开 SDK 当前稳定提供 `plugin.describe`、`provider.describe`、`provider.models`、`provider.quota`、`provider.refresh`、`provider.revoke` 和可选的 `provider.request`；认证授权、签名和诊断由宿主生命周期统一编排，避免插件自行接触账号库。复杂上游可声明 `provider.request`，宿主向插件传递已经完成入口协议解析后的请求上下文，插件返回上游原生协议的响应/流；核心仍负责入口协议、统一错误、SSE、usage 和路由审计。

模型发现必须按账号隔离，并保留最后一次有效结果：429、5xx、超时和网络失败只标记刷新状态，不删除模型；明确的 404、MODEL_NOT_FOUND 或账号无权限才改变可暴露状态。

## 5. Middleware API

```text
middleware.onRequest
middleware.onEvent
middleware.onResponse
```

- 默认只接触脱敏后的请求、响应和协议上下文。
- 默认无网络、文件系统和 secrets 权限。
- 请求/响应钩子有明确超时，流事件钩子使用更短预算。
- 插件异常或超时默认保持原请求/响应，显式 `reject` 才拒绝请求。
- Middleware 执行顺序稳定、可查看、可停用，并写入路由 Trace。

## 6. 安全与供应链

- 官方插件和官方市场索引使用 Ed25519 签名。
- 安装包进行 SHA-256 完整性校验，使用版本目录和原子激活。
- npm 安装不执行 install scripts；Git 安装必须固定 ref 或提交。
- Provider 插件独立进程运行，继续使用 macOS sandbox、Linux bubblewrap、Windows AppContainer。
- `secrets` 权限必须单独声明、单独确认，宿主只传当前账号的临时凭证。
- 官方、已验证、社区、本地开发四级信任标记必须在 UI 中明确展示。
- 插件停用必须从 Provider Registry 注销，已经在使用的请求要有可解释的失败提示。

## 7. 桌面产品交互

新增一级导航“插件”，包含：

- 发现：官方、已验证、社区、本地开发，按类型、权限、服务商筛选。
- 已安装：启用、停用、更新、回滚、卸载、权限、日志、诊断。
- 开发者：本地目录、npm、Git、热重载和 RPC 检查。

插件详情展示：

- 图标、名称、版本、来源、信任等级；
- Provider / Middleware 类型；
- 权限列表及风险说明；
- 提供的服务商、账号认证方式和模型数量；
- 当前运行状态、最近错误、更新时间；
- 设置 Schema、日志和诊断结果。

服务商、账号、模型页面只显示来源和跳转关系：

```text
插件 -> 服务商 -> 账号 -> 模型 -> 路由组 -> 环境/客户端
```

不在模型页面重复实现插件安装，不在插件页面复制账号管理。

## 8. `csw-our-free-model`

- 独立 workspace package / 独立仓库，依赖 `@codex-switcher/plugin-sdk`。
- 插件包 ID：`csw-our-free-model`；Provider ID：`our-free-model`。两者分离，便于一个插件未来提供多个服务商。
- 公共模型池使用系统管理账号显示，不伪装成用户账号。
- EAC、OAuth、API Key、多账号渠道使用宿主统一账号模型。
- 模型清单、能力、协议和可用性按账号动态发现。
- 上游网络异常、429、5xx、超时保留旧模型并显示诊断状态。
- 支持 Responses、Chat Completions，以及由核心 Gateway 转换到其它客户端协议。
- 插件不另起主网关；特殊上游通过 `provider.request` 接入统一 Gateway。
- 图标随插件包或使用受信任的 data URI，禁止运行时无校验远程图标。
- 用户可查看上游来源、隐私声明、公开额度限制和账号渠道风险。

## 11. 当前实现与验证基线

本计划对应的实现已经覆盖以下完整链路，而不是只保留接口或页面：

- `packages/gateway/src/plugin`：Provider/Middleware Registry、JSON-RPC 宿主、权限、超时、并发上限、崩溃重启、沙箱启动、签名/哈希校验、版本目录、升级回滚和设置加密。
- 插件安装会在临时工作目录解析 `package.json` 运行时依赖，强制 `npm install --ignore-scripts`，不会执行第三方生命周期脚本；Git 源必须固定 Tag/Commit。
- `packages/plugin-sdk`：稳定 JSONL SDK、Provider 自定义请求/模型/配额/刷新/撤销、Middleware 请求/事件/响应钩子，以及可运行的 `examples/plugins/csw-demo`。
- `apps/desktop/electron`：插件生命周期、市场索引、安装源、诊断持久化、桌面桥接，以及网关 `/gateways`、`/pools`、`/routes` 的 Provider 请求接管。
- `apps/desktop/src/pages/plugins-page.tsx`：发现、安装确认、信任/权限展示、启停、更新、回滚、卸载、Schema 设置和运行诊断。
- `plugins/csw-our-free-model`：独立模型发现、缓存回退、配额、JSON/SSE 请求转发和插件级测试。

验证结果：`npm run gateway:test`（98/98）、`npm run plugin-sdk:build`、`npm run plugin-sdk:test`、`npm run plugin-sdk:example:test`、`npm run our-free-model:test`（4/4）、`npm run test:cross-platform`（核心 162/162、脚本 35/35）、桌面 Electron 全量测试（456 pass、1 intentional skip、0 fail）、`npm run desktop:build`、`npm run test:desktop-package-workflow`、`npm run lint` 和 `git diff --check` 均已通过。跨平台原生沙箱矩阵由 Gateway 单测覆盖；真实签名安装包和真实客户端联网 smoke 仍属于发布环境验证，不伪装成本地测试已覆盖。

## 9. 验收矩阵

| 领域 | 验收标准 |
| --- | --- |
| API | v1 插件保持可用，v2 Provider/Middleware 能力协商成功 |
| 安装 | npm/Git/本地安装、签名、哈希和恶意篡改均有明确结果 |
| 运行时 | 超时、超大帧、崩溃、自动重启和并发上限不影响其它请求 |
| 凭证 | 插件无法越权读取其它账号或宿主 Secret |
| 模型 | 多账号模型隔离、动态发现、旧结果保留和明确不可用状态正确 |
| 请求 | 文本、流式、工具、推理、图片、usage、错误和协议转换可验证 |
| Middleware | 顺序、超时、异常透传、显式拒绝和流事件处理正确 |
| UI | 发现、安装、权限确认、启停、更新、回滚、日志和诊断完整 |
| 官方插件 | `csw-our-free-model` 无凭证公共池、多账号和上游异常处理完整 |
| 客户端 | Codex、Claude Code、ZCode、WorkBuddy 和通用 OpenAI/Anthropic 客户端均能使用插件模型 |
| 发布 | 类型检查、全量测试、桌面构建、跨平台沙箱和安装包 smoke 全部通过 |

## 10. 完成标准

只有当任务卡中所有任务为 `done`，并且上述验收矩阵有实际测试证据时，目标才允许标记完成。只完成 Provider 主链路、只展示插件页面或只完成 `csw-our-free-model` 单模型均不算完成。
