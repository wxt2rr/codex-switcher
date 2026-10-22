# Desktop v0.1.75

- 修复 Windows 插件安装时报 `Plugin host request timed out` 的问题。
- Windows AppContainer 插件启动器现在支持长驻 RPC 插件，并通过 Job Object 在退出时清理子进程。
- 延长插件首次冷启动握手超时时间，避免 Windows ACL 和托管服务启动耗时导致误报超时。
- 优化插件安装进度弹框，移除重复状态和循环闪动进度条，改为稳定的阶段进度显示。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
