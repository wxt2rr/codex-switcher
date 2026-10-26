# Desktop v0.1.82

- 修复首次切换账号时 Codex 异步退出清理与 profile 删除竞态导致的 `EACCES` 启动失败。
- 旧 profile 清理失败时先隔离目录并继续启动新窗口，后台再完成删除。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
