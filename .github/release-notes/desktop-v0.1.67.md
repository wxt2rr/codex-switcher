# Desktop v0.1.67

- 修复 Windows 打包应用安装 `CSW Our Free Model` 插件时，因 AppContainer 沙箱拒绝创建 `provider-plugin-data` 目录而失败的问题。
- 托管插件数据改用 Electron 应用专属可写目录，并让桌面宿主与网关路由子进程复用同一路径。
- 增加 Windows 插件数据目录回退规则的回归测试。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
