# 网关 HTTP 传输与 WebSocket 误连修复

## Goal
- 让所有由 codex-switcher 写入 Codex 环境的本地路由地址使用明确的 Responses HTTP provider 配置。
- 禁止 Codex App 的 WebSocket/GET 握手被网关当作普通 Responses 请求转发到上游。
- 保留现有账号认证、模型目录、网关路由和直连服务商行为。

## Why Complex
- 同时涉及 Core 目标环境配置生成、Electron 网关 HTTP 入口、路由事件日志和跨模块回归测试。
- 需要兼容 API Key 与 ChatGPT 授权账号，以及 `/routes`、`/pools`、`/gateways` 三类本地入口。

## Scope
- 相关模块/类：`target-home`、`usage-router-service`、本地路由配置与诊断日志。
- 相关文件：
  - `packages/core/src/system/target-home.ts`
  - `packages/core/src/system/target-home.test.ts`
  - `apps/desktop/electron/usage-router-service.ts`
  - `apps/desktop/electron/usage-router-service.test.ts`
- 兼容要求：直连外部 Base URL 不增加自定义 provider；本地路由仍使用原有认证材料；不把上游密钥写入 `config.toml`。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 生成本地路由 HTTP-only provider 配置 | target-home、Core 配置测试 | Core target-home tests、TypeScript | done | `/routes`、`/pools`、`/gateways` 自动生成稳定 provider，固定 `wire_api=responses`、`supports_websockets=false`，兼容 API Key/ChatGPT |
| 2 | 拒绝网关 Responses 的 GET/WebSocket 握手并记录根因 | usage-router-service、事件日志 | 网关入口 405/日志回归测试 | done | HTTP GET 和真实 HTTP Upgrade 均返回明确 405，并记录 `gateway_request_rejected`、method、protocol、hasUpgrade、requestId |
| 3 | 补充 API Key/ChatGPT、gateway/pool/route 兼容回归 | Core/Electron tests | 目标测试集 | done | `target-home.test.ts` 14/14；`usage-router-service.test.ts` 25/25；覆盖 target-home、gateway、pool、route 既有链路 |
| 4 | 构建并验证发布运行时 | Core build、Electron build/test、diff check | 构建与测试证据 | done | Core build、Electron 类型检查、桌面生产构建通过；桌面测试 439 项中 438 项通过，1 项为显式环境变量控制的可选 Codex E2E 跳过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 不修改用户已有的无关工作区变更。
- 不把 WebSocket 转发伪装成 HTTP；当前网关协议契约明确为 Responses HTTP/SSE。
