## Gateway compatibility

- 修复 Anima Agent 通过本机 Gateway 的 Chat Completions 请求转发到 Responses 上游时丢失 `store=false` 的问题。
- 协议转换完成后统一重新应用本机 Agent 的存储兼容策略，覆盖普通路由、账号池和工具降级重试路径。
- 增加 Chat Completions → Responses 的回归测试，确保上游收到 `store: false`。
