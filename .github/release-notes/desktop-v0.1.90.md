## 网关与账号路由修复

- 修复无订阅凭据的 `default/default` 账号被编译为 Codex 内置模型路由的问题。
- 缺少路由凭据时不再透传入口服务商的 API Key，并返回明确的错误信息。
- 本机 Agent 的 Responses 和 Chat Completions 请求统一转发为 `store=false`，兼容要求关闭存储的 OpenAI-compatible 上游。
- 增加相关网关、账号凭据和本机 Agent 回归测试。

## 桌面体验与稳定性

- 保留并发布现有的下拉框、更新流程、账号模型选择和页面视觉统一优化。
- 同步包含桌面更新回滚、插件页面和请求详情相关修复。
