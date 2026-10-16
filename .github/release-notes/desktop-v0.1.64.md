# Desktop v0.1.64

- 修复 Provider 插件在 Windows AppContainer 中无法启动的问题，补齐 AppContainer 所需的非敏感系统路径和跨盘当前目录环境变量。
- 保持插件进程的最小环境隔离，API Key、Token 等主机敏感变量不会传递给插件。
- 完善兼容路由的 provider/model 映射，统一保存并恢复服务商和上游模型信息，避免带服务商前缀的 Codex 模型名直接发送给上游。
- 增加通用 Hosted Tool 能力识别、观察和不兼容能力过滤，避免不同服务商能力差异导致请求直接失败。
- 补充模型映射、Provider 插件 Windows 环境和网关能力路由测试。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
