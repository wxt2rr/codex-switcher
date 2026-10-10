# Desktop v0.1.44

- 增加 GitHub Release 自动更新：应用启动后自动检查并下载对应平台安装包，也可以在设置页手动检查。
- 下载完成后校验 SHA-256；Windows NSIS 和 Linux AppImage 支持等待旧进程退出后自动安装并重启。
- 未签名 macOS 保持手动安装路径，下载后打开 DMG/ZIP，不伪装成静默自动更新。
- 发布工作流自动生成 `latest.json` 更新索引；可选使用 Ed25519 签名，未配置签名密钥时仍使用 HTTPS + SHA-256 校验。
- 更新失败会保留错误状态，旧版更新源、签名清单和回滚机制继续兼容。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
