# gateway-chat-developer-role-compatibility

## Goal
- 修复 Codex Responses 请求转换到 Chat Completions 上游时，将 `developer` 角色错误发送给只支持 `system/user/assistant/tool/function` 的服务商。
- 复用现有兼容路由的 `instructionRole` 语义：`auto`/`system` 默认降级为 `system`，显式 `developer` 才保留 `developer`。

## Why Complex
- 改动跨共享 Gateway 转换包、桌面运行时调用层和网关集成测试，需同时保证模型测试、正式请求、流式链路和显式 developer 配置兼容。

## Scope
- 相关模块/类：共享请求转换器、桌面 Gateway 路由请求转换调用、协议转换测试。
- 相关文件：
  - `packages/gateway/src/conversion/types.ts`
  - `packages/gateway/src/conversion/request-converter.ts`
  - `packages/gateway/src/conversion/request-converter.test.ts`
  - `apps/desktop/electron/usage-router-service.ts`
  - `apps/desktop/electron/usage-router-service.test.ts`
- 兼容要求：Responses/Anthropic/Gemini 目标协议行为不变；显式 `instructionRole: developer` 仍允许支持该角色的 Chat Completions 服务商；默认 auto 不向 Chat Completions 上游发送 developer。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 扩展共享转换选项并按 instructionRole 编码 Chat 消息 | `types.ts`, `request-converter.ts` | Gateway request converter tests | complete | `npm run test --workspace ./packages/gateway` 通过，新增默认降级与显式 developer 回归测试 |
| 2 | 将路由 instructionRole 传入桌面共享转换调用 | `usage-router-service.ts`, `protocol-adapters.ts` | Desktop service integration test | complete | `env -u CODEX_SWITCHER_DESKTOP_RESOURCES_PATH npm run test:pools --workspace ./apps/desktop` 41/41 通过 |
| 3 | 增加默认降级与显式 developer 的回归测试 | request/service/codec tests | targeted tests | complete | Gateway converter、codec 和真实 Responses→Chat 网关场景均覆盖；显式 developer 在 converter 测试中验证 |
| 4 | 构建并检查未提交变更 | workspace | `gateway:test`, `desktop:build`, `desktop:test`, `git diff --check` | complete | Gateway 112/112；桌面全量 479 通过、1 跳过；桌面构建通过；差异检查通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
