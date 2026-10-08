## Desktop v0.1.37

- 修复 Gateway 模型目录缺少 Codex 必需字段，导致 Codex App 无法加载配置的问题。
- Gateway 模型目录现在会统一生成完整的模型元数据，并在启动、恢复 Gateway 和启动 Codex App 时自动同步。
- 增加 Gateway 模型目录字段完整性测试，保持现有未签名跨平台自动打包发布流程不变。

> 当前安装包未进行 Apple 公证或 Windows 代码签名。
