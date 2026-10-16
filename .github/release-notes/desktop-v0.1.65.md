# Desktop v0.1.65

- 修复 Windows AppContainer 下 ESM Provider 插件启动时报 `EPERM: operation not permitted, lstat 'C:\\'` 的问题。
- Windows 插件启动器对整个 ESM 模块图启用 `--preserve-symlinks`，继续保持插件目录隔离，不放开磁盘根目录权限。
- Windows AppContainer 冒烟测试增加真实 ESM import 覆盖，防止模块解析回归。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
