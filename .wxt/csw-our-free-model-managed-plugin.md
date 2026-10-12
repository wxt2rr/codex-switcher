# CSW Our Free Model 托管插件复刻 Magpie

## Goal
- 让 Codex Switcher 的 Our Free Model 插件复刻 `magpie-our-free-model` 的托管方式：插件自动启动本地回环服务，自动提供动态 Base URL、API Key、模型发现和管理控制台，不要求用户填写 Base URL/Models URL。

## Why Complex
- 预计跨插件进程、托管服务、网关 provider 适配器、桌面插件生命周期和测试多个模块，改动超过 150 行。

## Scope
- 相关模块/类：Our Free Model 插件入口与运行时、插件 manifest/settings、Provider 插件生命周期、网关 provider 请求适配。
- 相关文件：`plugins/csw-our-free-model/**`、`packages/gateway/src/plugin/**`、`apps/desktop/electron/provider-plugin-runtime.ts` 及相关测试。
- 兼容要求：保留普通远程 Provider 插件能力；旧版空配置或 `.invalid` 配置迁移为托管服务默认行为；插件停用、网关关闭时必须停止子服务。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立托管插件运行时与本地服务启动/停止接口 | plugin entry/runtime, vendor service | 插件单元测试、启动/关闭 smoke | complete | `managed-runtime.mjs` 启动 loopback 服务并读取 forward key，回收已确认死亡的 OFM 服务锁；`plugin.mjs` 在进程退出时关闭服务；OFM standalone 已随插件打包 |
| 2 | 将 provider 请求、模型发现、密钥和动态 endpoint 接入网关 | gateway plugin adapter/runtime | gateway plugin tests | complete | `provider.describe()` 返回运行时 endpoint；请求自动改写到本地服务并注入 key；真实 manager smoke 已通过 |
| 3 | 移除普通用户的 URL 配置并增加迁移/状态展示 | manifest/settings/desktop bridge | settings and desktop tests | complete | manifest 移除 settingsSchema，插件详情页增加本地管理控制台入口；托管服务商在账号页隐藏 Base URL、API Key、请求头并自动注入动态端点；旧设置被保留但不再参与运行；宿主为托管插件提供独立数据目录 |
| 4 | 更新文档、打包文件清单并完成验证 | plugin README/package/tests | targeted tests + build | complete | `npm run our-free-model:test` 5/5；Gateway 98/98；桌面插件/路由相关测试 43/43；`npm run gateway:build` 和 `npm run desktop:build` 通过；required macOS sandbox smoke、`git diff --check` 通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
