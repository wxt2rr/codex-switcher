## Windows MSIX 启动热修复

- 修复启动 Microsoft Store / MSIX Codex App 时，停止旧进程的 PowerShell 命令失败并中断整个启动流程的问题。
- 改用兼容 Windows PowerShell 5.1 的逐进程处理，包查询、进程路径读取和停止操作均独立容错。
- 仅停止 OpenAI MSIX 安装目录内的 App 进程，避免影响正在运行的 Codex CLI。
- 即使旧进程无法停止，也会继续执行账号配置投影和 App 激活，不再显示远程调用错误。

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名，首次启动时系统可能显示安全提示。
