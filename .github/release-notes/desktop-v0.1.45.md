# Desktop v0.1.45

- 修复从 Finder、Dock 或下载目录直接启动 macOS App 时，Codex CLI 因 GUI PATH 缺少 Node 而导致数据加载失败的问题。
- 模型目录发现、CLI 登录、终端启动和令牌刷新统一补齐 Codex 所在目录及常见 Node 安装目录。
- 保留终端启动时已有 PATH 优先级，并继续支持手动 Codex 路径、Homebrew、用户级 Node、Volta、fnm、pnpm 和 Windows npm 目录。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
