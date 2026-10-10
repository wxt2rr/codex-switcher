# Desktop v0.1.43

- 修复账号切换服务商后，运行时 provider 与持久化网关 credential 不一致，导致模型发现直接报无可用凭证的问题。
- 模型发现前自动同步账号的 provider、credential、协议和网关路由元数据，支持 OpenAI、Qwen、DeepSeek、Kimi、GLM 及自定义服务商等 provider 切换场景。
- provider 切换成功后自动迁移当前账号的模型绑定、上游模型、优先级和权重，避免发现成功但实际路由仍指向旧服务商。
- 模型发现失败时不再写入半修复的活动网关，保留此前可用路由。
- 增强模型发现日志，记录运行时 provider、网关 credential 是否存在、发现前 provider 以及 provider 不一致标记，便于直接定位根因。

本版本安装包由 GitHub Actions 按 `desktop-v*` 标签构建，未进行 Apple 公证或 Windows 代码签名。
