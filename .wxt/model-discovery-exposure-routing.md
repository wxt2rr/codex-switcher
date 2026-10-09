# 模型发现与暴露路由完整实现

## Goal

在账号完成 API Key、OAuth、订阅授权或本地服务配置后，按账号自动发现真实可用模型；由用户选择需要暴露给 Codex App 的模型；保留模型页面作为手工模型补充、模型目录汇总、路由绑定和诊断入口；完整同步手动模式和网关模式下的模型目录与路由。

本任务是完整功能实现，不拆分 MVP，不保留“核心链路已完成、边缘能力后续再做”的未实现项。

## Why Complex

- 跨桌面前端、Electron Bridge、Provider Adapter、模型目录、网关路由、Codex 配置同步和测试多个子系统。
- 需要新增账号级模型发现快照、用户暴露选择、手工模型兼容和刷新失效状态。
- 需要兼容现有 `custom-model-catalogs.json`、既有账号绑定、网关路由和 Codex 模型目录。
- 需要覆盖 API Key、OAuth/订阅、本地服务、无模型列表接口、模型发现失败、同模型多账号和手工模型冲突。

## Product Contract

### 页面职责

1. 服务商页面只维护静态 Provider 定义、图标、协议、认证方式、模型发现能力和已有账号入口。
2. 账号页面是唯一的账号连接入口，负责环境、凭据、请求协议、代理和授权。
3. 添加账号成功后自动进入模型发现与暴露选择流程；账号保存不因模型发现暂时失败而回滚。
4. 模型页面保留，但调整为模型目录与路由管理页面：
   - 汇总账号发现模型和已暴露模型；
   - 管理多账号绑定、上游模型名、优先级、权重、启停；
   - 提供手工模型和完整 Codex 元数据编辑；
   - 提供刷新、重试、失效和无可用路由诊断。

### 模型来源

模型选择器必须合并展示：

- 当前账号服务商返回的模型；
- Provider 预设模型和本地服务可推断模型；
- 模型页面保存的手工模型；
- 当前账号已经选择过但本次发现暂时失败或已下线的历史模型。

每个模型显示来源、服务商图标、账号、上游模型 ID、协议、能力和当前状态。

### 暴露规则

- 新发现模型默认进入“待选择”，不静默暴露给 Codex App。
- 用户选择后才进入账号的暴露模型集合。
- 同一 Provider、同一上游模型 ID 在多个账号中自动合并为一个对外模型，并生成多个路由成员。
- 不同 Provider 的同名模型默认不自动合并；需要通过显式逻辑模型或路由配置合并。
- 手工模型可独立暴露，也可绑定到一个或多个账号并指定上游模型 ID。
- 只有存在至少一个有效账号路由的模型才能发布到网关模式的 Codex 模型目录。
- 手动模式下，模型暴露影响当前账号的模型目录，不改变账号直接切换语义。

### 刷新和失败规则

- 账号创建后立即发现模型。
- 账号页和模型页都提供手动刷新/重试。
- 发现失败不删除上次成功的快照，标记 `stale` 并保留可用的历史选择。
- 服务商返回新模型时进入待选择，不自动改变用户暴露集合。
- 服务商不再返回已选择模型时标记 `unavailable`，不直接删除绑定，允许用户修复或禁用。
- 无 `/models` 接口时使用 Provider 预设或手工配置，并明确标记为未验证来源。
- 所有错误写入结构化模型发现/目录同步日志，不记录凭据和完整请求内容。

## Data Contract

### AccountModelSnapshot

新增账号级模型快照，至少包含：

- `accountKey`
- `providerId`
- `upstreamModelId`
- `displayName`
- `iconKey`
- `protocols`
- `capabilities`
- `source`: `discovery | preset | manual | cached`
- `status`: `available | stale | unavailable | discovery_failed`
- `firstSeenAt`
- `lastSeenAt`
- `lastError`

不得保存 API Key、OAuth Token 或其他秘密。

### ModelExposure

新增用户选择状态，至少包含：

- `accountKey`
- `providerModelKey`
- `exposedModelId`
- `enabled`
- `upstreamModelId`
- `priority`
- `weight`
- `selectedAt`
- `source`: `discovered | manual | legacy`

### 兼容策略

- 现有 `CustomModelRecord` 继续作为手工模型兼容入口。
- 现有 `accountBindings` 和 `accountBindingOptions` 继续可读写。
- 持久化文件升级时提供版本迁移，不删除旧字段，不要求用户重新绑定模型。
- 历史绑定缺少发现快照时按 `legacy` 状态展示，并允许直接修复。

## Implementation Tasks

| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立账号模型快照和暴露选择的数据结构、持久化、版本迁移及旧绑定兼容 | `apps/desktop/electron/model-catalog-store.ts`, bridge 类型 | 单元测试覆盖读写、迁移、去重、失效保留、秘密字段过滤 | done | `npx tsx --test electron/model-catalog-store.test.ts`：9 passed, 0 failed |
| 2 | 完善 Provider Adapter 的按账号模型发现、预设回退、允许模型过滤、协议和能力归一化 | `packages/gateway/src/provider/adapters.ts`, plugin adapter | Gateway adapter tests 覆盖 API Key、订阅、本地、无列表接口和失败回退 | done | `npx tsx --test electron/gateway-model-discovery.test.ts`：5 passed, 0 failed；新增按账号隔离发现接口，保留预设回退、账号允许列表、协议与能力归一化 |
| 3 | 将账号保存成功后的模型发现接入 API Key、OAuth/订阅、外部凭据导入和本地账号流程 | `apps/desktop/electron/bridge.ts`, `apps/desktop/src/react-app.tsx` | 账号保存后自动触发发现；发现失败不回滚；刷新状态可读 | done | `bridge-core-ops.test.ts` 账号保存/导入回归 31 passed；启动刷新入口已接入 |
| 4 | 暴露桌面 Bridge API：发现、读取快照、保存选择、刷新、重试、读取状态和诊断 | `apps/desktop/src/bridge.ts`, preload, Electron bridge | Bridge contract tests 和错误结构测试 | done | `bridge.test.ts` 2 passed；发现、全量刷新、保存绑定均已接入 preload/main |
| 5 | 实现模型选择器：展示服务商实时模型、预设模型、历史模型和手工模型，并支持多选保存 | `apps/desktop/src/pages/accounts-page.tsx`, 新增模型选择组件 | 页面测试覆盖加载、筛选、多选、全选、失败重试、空列表和保存状态 | done | `account-model-exposure-panel.test.ts` 通过；账号页新增模型入口和保存/刷新/重试流程 |
| 6 | 重构模型页面为模型目录与路由管理：汇总暴露模型、来源、图标、能力、状态和账号数量 | `apps/desktop/src/pages/models-page.tsx` 及相关组件 | 页面测试覆盖聚合、筛选、环境切换、状态展示和空状态 | done | 模型页已支持目录搜索、来源/状态/账号数、Provider 图标和全量刷新 |
| 7 | 完善手工模型补充：表单字段、JSON 高级编辑、模型冲突检测、协议/能力校验和账号绑定 | 模型页面、`model-editor`、模型目录 Store | 手工模型测试覆盖无列表 Provider、冲突、非法能力和绑定校验 | done | Store 覆盖重复 slug、协议/上下文校验；模型页保留表单/完整 JSON/账号绑定/启用开关 |
| 8 | 将发现模型、手工模型和历史模型合并为 Codex 完整模型目录 | `apps/desktop/electron/account-model-catalog.ts`, catalog builder | 覆盖手动模式、网关模式、内置模型、去重、完整必填字段和原子写入 | done | `account-model-catalog.test.ts` 12 passed；发现模型、手工模型、旧预设去重及失效过滤已覆盖 |
| 9 | 将暴露选择编译为网关模型、路由成员和多账号故障转移 | `apps/desktop/electron/gateway-model-bindings.ts`, gateway model catalog | 覆盖同 Provider 多账号、不同上游 ID、优先级、权重、停用和无路由诊断 | done | `gateway-model-bindings.test.ts` 7 passed；同模型多账号、上游 ID、优先级/权重、停用和 unavailable 均覆盖 |
| 10 | 增加模型刷新生命周期：启动刷新、手动刷新、缓存、stale/unavailable、删除账号清理和账号重新授权 | Electron bridge、Store、gateway sync | 生命周期测试覆盖新增、下线、失败、恢复和删除账号 | done | Store 生命周期测试通过；启动全量刷新、手动刷新、令牌刷新、登出 stale、删除清理已接入 |
| 11 | 增加模型发现、选择、路由和 Codex 同步结构化日志 | `apps/desktop/electron` logging modules | 日志可定位根因且不包含 Token、Key、请求正文和敏感 Header | done | `account_model_discovery` 和既有 `model_catalog_sync` 结构化事件写入 switcher.log，错误做凭据脱敏 |
| 12 | 修复现有模型页环境筛选依赖、启用开关和账号兼容性显示 | `models-page.tsx`、provider icon/diagnostic components | 页面测试和类型检查通过 | done | 环境筛选依赖已修复，账号绑定启用开关和模型来源/状态显示已加入；Web 类型检查通过 |
| 13 | 更新中英文/日文文案、空状态、错误提示、帮助说明和 Provider 图标展示 | `apps/desktop/src/i18n.ts`, provider icon components | 文案一致性测试和构建通过 | done | 选择器空状态/错误/帮助文案已加入，Provider 图标覆盖内置别名和订阅服务；Web 类型检查通过 |
| 14 | 完成跨模块测试、桌面构建、旧数据迁移验证和本地打包前检查 | 全项目 | `npm run desktop:test`, `npm run desktop:build`, 相关 core/gateway tests, `git diff --check` | done | `desktop:test`：436 项，435 passed、1 skipped、0 failed；`desktop:build` 成功；`core:test` 161 passed；`gateway:test` 80 passed；`git diff --check` 通过 |

## Verification Matrix

### Account discovery

- API Key Provider 返回 `/models`：只展示该账号真实返回和预设补充模型。
- 订阅/OAuth Provider：使用账号自己的 Adapter 和授权上下文发现模型。
- 本地 Provider：无凭据也能发现或使用预设。
- Provider 没有模型列表接口：账号仍能保存，模型选择器显示手工配置入口。
- 发现失败：账号成功保存，界面给出重试和手工配置，不清空旧模型。

### Exposure and catalog

- 用户未选择的模型不进入 Codex App 模型目录。
- 用户选择的实时模型和手工模型都进入模型目录。
- 同一 Provider/模型被多个账号选择时，Codex 只看到一个模型，网关拥有多个路由成员。
- 不同 Provider 的同名模型默认保持独立。
- 模型目录包含 Codex 所需完整字段，原子写入并更新 `model_catalog_json`。

### Routing

- 每个暴露模型至少有一个启用且协议兼容的路由。
- 上游模型 ID 可与对外模型 ID 不同。
- 优先级、权重、失败转移和停用状态生效。
- 无有效路由时阻止发布并给出账号、Provider、协议和上游模型原因。

### Lifecycle

- 新模型进入待选择，不改变既有用户选择。
- 已选择模型发现失败保留并标记 stale。
- 已下线模型标记 unavailable，不静默删除。
- 删除账号会清理无成员路由，但不误删其他账号的模型。
- 旧版模型目录和旧账号绑定可以迁移并继续工作。

## Rules

- 同时只能有一个任务处于 `in_progress`。
- 每完成一个任务立即更新本文件的 `Status` 和 `Evidence`。
- 新增范围必须先补充任务表，再修改生产代码。
- 不修改或清理与本任务无关的现有用户改动。
- 不在日志、持久化模型元数据或 UI 诊断中写入凭据、Token、API Key 或完整请求正文。
- 只有有实际验证证据的任务才能标记为 `done`。
