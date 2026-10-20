# Desktop v0.1.69

- 修复 Windows 安装 Provider 插件时因 `~/.codex-switcher/provider-plugin-data` 不可写导致的 `EPERM` 错误。
- Windows 桌面进程与 Gateway 子进程统一使用独立的应用数据目录保存插件运行数据，避免安装与运行时路径不一致。
- 增加插件安装中的步骤进度、成功结果和失败详情反馈，安装过程不再表现为无响应。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
