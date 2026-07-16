## Desktop v0.1.15

- API Key 账号自动关闭 OpenAI 授权检查，并写入 `x-openai-actor-authorization` 请求头。
- Chat 兼容路由和 Auth 账号的独立 API Key 使用相同配置策略。
- 清理旧托管配置，避免重复或过期的认证字段。
