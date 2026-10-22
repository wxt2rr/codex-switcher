# Desktop v0.1.77

- 修复 Windows AppContainer 插件访问 `AppData\Roaming\codex-switcher\provider-plugin-data` 时仍报 `EPERM: operation not permitted, mkdir` 的问题。
- Windows 沙箱启动器现在会为插件数据目录到盘符根目录之间的所有父级目录授予临时遍历权限，插件退出后自动恢复 ACL。
- 保留插件目录和 Node 运行时的原有隔离策略，并补充父目录链权限契约测试。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
