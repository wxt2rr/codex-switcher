# Desktop v0.1.74

- 修复 Windows Microsoft Store Codex App 请求时无法继承 `OPENAI_API_KEY` 环境变量的问题。
- 网关和 Responses 直连路由不再要求 Codex App 注入无用的 `OPENAI_API_KEY` 环境变量。
- Windows 直连 Chat 兼容路由改用配置内的本地路由令牌，确保 Explorer 激活的 App 也能完成鉴权。
- 保留 Windows App 的自定义模型目录同步修复。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
