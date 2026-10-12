# Plugin Platform - Complete Provider and Middleware Ecosystem

## Goal

- 在现有 Provider 插件运行时之上，交付可供外部开发者使用的完整插件平台。
- 支持 Provider 插件、Gateway Middleware 插件、插件 SDK、插件市场、权限/信任/沙箱、安装升级回滚、原生插件管理 UI。
- 交付独立的官方 `csw-our-free-model` 插件，并接入账号、模型、服务商、路由和所有已支持客户端。
- 不以 MVP、只通主链路或只完成接口定义作为完成标准。

## Why Complex

- 跨 `packages/gateway`、`packages/core`、`apps/desktop/electron`、`apps/desktop/src` 和独立插件包多个子系统。
- 预计涉及超过 4 个模块和 150 行代码，并包含运行时协议、持久化、UI、网络、沙箱和发布测试。
- 需要保持现有 Provider 插件 API v1、账号模型、模型目录、环境路由和未跟踪用户文件兼容。

## Scope

- 相关模块：Plugin Host、Provider Registry、Model Discovery、Account/Model Catalog、Gateway Middleware、Desktop Bridge、Desktop UI、官方插件包。
- 相关文件：`packages/gateway/src/plugin/**`、`packages/gateway/src/provider/**`、`apps/desktop/electron/provider-plugin-runtime.ts`、`apps/desktop/electron/main.ts`、`apps/desktop/electron/preload.ts`、`apps/desktop/src/bridge.ts`、`apps/desktop/src/react-app.tsx`、新增插件 SDK/官方插件目录及其测试。
- 兼容要求：Provider 插件 API v1 继续可激活；现有账号、模型和环境行为不能回归；用户现有未跟踪文件不修改、不删除。
- 非目标：不直接复制 Magpie/DSH 源码；不允许插件绕过宿主直接修改客户端配置；不把 Skills 系统和 Provider/Middleware 运行时混成同一套权限模型。

## Task List

| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立插件平台契约、SDK 基础类型和 API v1/v2 兼容层 | `packages/gateway/src/plugin/**`, 新增 SDK | gateway 单测、类型检查 | done | `npm run gateway:build` 通过；现有 v1 清单仍可激活；SDK 已提供 Provider/Middleware 类型与 JSONL RPC 服务端，`npm run plugin-sdk:build` 与 `npm run plugin-sdk:test` 通过 |
| 2 | 扩展 Provider 运行时：多 Provider、账号模型发现缓存、诊断、自定义请求/流式能力 | `packages/gateway/src/plugin/**`, `packages/gateway/src/provider/**` | 契约、权限、模型、流式和失败分类测试 | done | Provider 自定义请求已接入宿主；模型来源保留；`npm run gateway:test` 98/98 通过 |
| 3 | 实现 Gateway Middleware Registry、请求/事件/响应钩子和隔离策略 | `packages/gateway/src/plugin/**`, gateway runtime | Middleware 顺序、超时、异常、协议测试 | done | Registry、独立运行时、Electron Gateway/Pool 请求与响应流已接入；Gateway 测试通过 |
| 4 | 完善插件安装供应链：官方/已验证/社区/本地信任、权限、签名、更新、回滚和诊断 | `packages/gateway/src/plugin/**`, `apps/desktop/electron/provider-plugin-runtime.ts` | 安装/升级/回滚/篡改/崩溃/重启测试 | done | SHA-256、签名复核、权限、沙箱、固定 Git ref、依赖安装禁脚本、升级/回滚、诊断持久化和市场更新入口已实现并有测试 |
| 5 | 建立 `@codex-switcher/plugin-sdk` 和插件开发模板/本地测试工具 | `packages/plugin-sdk/**`, `examples/plugins/**`, scripts | SDK 构建、示例插件真实 RPC 启动 | done | SDK README、Provider/Middleware API、`csw-demo` 模板与真实 JSONL 测试已完成 |
| 6 | 增加桌面插件市场和已安装插件管理页，接入权限确认、设置 Schema、日志和诊断 | `apps/desktop/src/pages/plugins-page.tsx`, bridge、preload、main、shell、i18n | Desktop 单测、构建、页面行为测试 | done | 插件市场/安装确认/启停/更新/回滚/卸载/设置/诊断 UI 和 IPC 已完成 |
| 7 | 实现独立官方 `csw-our-free-model` Provider 插件 | `plugins/csw-our-free-model/**` 或独立 workspace package | 动态模型、无凭证公共池、多账号、流式、错误保留、协议和安全测试 | done | 模型发现缓存回退、配额、JSON/SSE 请求处理和插件测试已完成 |
| 8 | 接入服务商/账号/模型/环境/路由/客户端联动与图标展示 | Provider catalog、Account/Model pages、Gateway bindings、client adapters | 端到端数据链路和 UI 回归测试 | done | Provider Registry、账号模型发现、来源保留、路由 Provider 解析及现有客户端适配链路已接入 |
| 9 | 完成跨平台、发布、文档、迁移和完整验收 | docs、CI、package/build scripts | `npm run check`、全量测试、构建、打包 smoke | done | lint、core/gateway/desktop 全量测试、SDK/官方插件测试、desktop production build、desktop package workflow、`git diff --check` 均通过；桌面 457 项为 456 pass/1 intentional skip，Gateway 98/98 |

## Rules

- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`，并运行该项验证。
- 新增任务先补表，再继续实现。
- 每项必须覆盖成功路径、权限拒绝、超时/崩溃、升级回滚和数据兼容边界。
- 发现现有方案假设不成立时，暂停当前切片，更新本任务卡后再继续。
