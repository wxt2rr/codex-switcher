# Desktop v0.1.78

- 修复 Windows AppContainer 插件访问 `AppData\Roaming\codex-switcher\provider-plugin-data` 时仍报 `EPERM: operation not permitted, mkdir` 的问题。
- Windows 沙箱启动器会为插件数据目录的父级路径补充遍历权限；系统或 CI 目录拒绝重复授权时保留已有权限，不再阻止插件启动。
- 保留插件目录和 Node 运行时的原有隔离策略，并补充父目录链权限契约测试。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
