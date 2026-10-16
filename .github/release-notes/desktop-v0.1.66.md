# Desktop v0.1.66

- 修复 Windows 用户安装托管 Provider 插件时，创建 `provider-plugin-data` 目录出现 `EPERM` 的问题。
- 共享状态目录不可写时，自动使用 `%LOCALAPPDATA%\\codex-switcher\\provider-plugin-data`，保持插件数据持久化并兼容受限用户目录。
- 桌面宿主和用量路由服务统一使用同一套 Windows 插件数据目录回退规则。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
