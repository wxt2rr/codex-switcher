# Desktop v0.1.73

- 修复 Windows Microsoft Store Codex App 投影时未生成自定义模型目录的问题。
- 直连模式和网关模式都会把模型目录同步到实际使用的 `%USERPROFILE%\\.codex` 投影目录。
- 确保 `model_catalog_json` 指向投影目录中的最新模型文件。
- macOS 和普通 Windows `.exe` 启动流程继续复用原有模型目录同步逻辑。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
