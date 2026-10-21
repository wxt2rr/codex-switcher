# Desktop v0.1.72

- 修复 Windows 自动检测 Microsoft Store Codex AppID 失败的问题。
- 兼容 Windows 图形应用中的 `Path` / `PATH` 环境变量，并保留系统启动器目录。
- 使用系统目录中的绝对 `powershell.exe`、`explorer.exe` 和 `cmd.exe` 路径，避免启动时报 `spawn ... ENOENT`。
- 保留 `shell:AppsFolder\\<AppID>` 和普通 `.exe` App 路径配置方式。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
