# Gateway-请求诊断

## Goal
- 为 CKT-aicode 与原生 Plus 请求提供可验证的端到端诊断记录，使用同一个 requestId 对比入站请求、路由转换、上游原始 usage 和最终回传 usage。
- 默认不记录正文；仅在管理员临时开启后记录，自动按 TTL/请求数关闭，并对凭证和敏感请求头做不可逆脱敏。

## Why Complex
- 跨桌面 Electron 网关入口、账号池/直连代理、响应转换和独立诊断日志四个职责区域。
- 需要同时支持摘要与受限完整 capture，并保证 SSE、重试和异常路径不影响主请求。

## Scope
- 相关模块/类：usage-router-service 网关入口、proxyRequest、proxyAccountPoolRequest；新增 diagnostics controller。
- 相关文件：`apps/desktop/electron/usage-router-service.ts`、`apps/desktop/electron/gateway-diagnostics.ts` 及测试。
- 兼容要求：默认关闭；不改变现有路由、usage ledger、响应协议和凭证处理；诊断日志权限为 0600，正文有大小上限。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立诊断状态、脱敏、正文摘要/完整 capture、TTL/请求数限制、JSONL 轮转 | gateway-diagnostics.ts | `npx tsx --test apps/desktop/electron/gateway-diagnostics.test.ts`（2 passed） | done | 独立日志默认关闭；凭证字段替换为 `[REDACTED]`；body hash/大小/摘要/受限正文和上游 usage 均可关联 |
| 2 | 将 ingress/transform/upstream/final 四阶段接入网关直连和账号池 | usage-router-service.ts | 直连网关回归用例 + 类型检查 | done | 记录原始入站、每次上游尝试（含 capability/stream retry）、转换后请求和最终回传 usage；无响应/失败路径仍会落诊断记录 |
| 3 | 增加管理员配置与查询 API | usage-router-service.ts | API 单测、诊断网关端到端用例 | done | `GET/PUT/DELETE /admin/diagnostics` 与 `GET /admin/diagnostics/records`；查询会等待活动 capture 完成，避免响应结束后读到空记录 |
| 4 | 完成回归验证并更新诊断文档 | `.wxt`、测试 | `desktop:test`、`desktop:build` | done | `npm run desktop:build` 成功；`npm run desktop:test` 599 passed / 1 expected skipped；诊断+网关定向测试 47 passed；Electron 类型检查通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
