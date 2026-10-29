# account-model-test-current-provider

## Goal
- 账号模型选择框中的测试，使用当前账号的服务商配置和协议，只借用候选模型的上游模型名；兼容没有 `models` 接口的中转站。

## Why Complex
- 测试按钮跨 UI 请求、Electron bridge 的账号绑定投影和 Usage Router 的 Responses 请求格式；需要同时覆盖网关预览与直接路由。

## Scope
- 相关模块：账号模型测试、当前账号模型投影、Usage Router 请求。
- 相关文件：`apps/desktop/electron/bridge.ts`、`apps/desktop/electron/usage-router-manager.ts` 及测试。
- 兼容要求：模型来源可以是 Codex bundled/其它账号发现结果，但服务商、凭据、Base URL、协议和代理必须来自当前账号；不调用当前候选模型的原始服务商。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 固化当前账号服务商投影和上游模型名规则 | bridge、model catalog | bridge/model catalog tests | done | `buildModelRequestPreview` 按当前账号计算 provider identity；已有回归测试确认 `ckt-aicode` 通过自定义 Base URL 映射为 `custom-openai:aicode.ckt.cn`，候选模型仅提供上游模型名 |
| 2 | 修正测试请求体，兼容 Codex AUTH Responses 要求 | Usage Router | manager request test | done | `input` 已改为 Responses 消息数组，覆盖网关预览、直连 Responses 和兼容性探针；预览测试断言发送数组而非字符串 |
| 3 | 运行定向测试、桌面构建和回归检查 | repo | desktop/gateway tests、diff check | done | 桌面构建通过；桌面 527 项测试通过（1 skipped）；Gateway 138 项测试通过；当前账号 provider 投影和 Responses 测试数组回归通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
