## Windows MSIX App 切换修复

- 优先从 OpenAI MSIX 包清单读取 `AppExecutionAlias`，通过别名启动时正确传递 `CODEX_HOME`、API Key 和独立窗口参数。
- 修复 Windows 启动器未透传 `--user-data-dir`，导致“新开窗口”和“覆盖当前窗口”行为相同的问题。
- 未注册执行别名时，自动回退到 AppsFolder 兼容模式：事务性投影所选账号配置和授权，启动失败时自动回滚。
- 切回默认环境时恢复原始默认配置，避免非默认账号残留在 `%USERPROFILE%\.codex`。
- 重启 MSIX App 时只停止 OpenAI 包安装目录内的进程，不影响正在运行的 Codex CLI。

## 界面与启动体验

- MSIX AppsFolder 模式仅展示实际支持的“重新启动”操作，不再显示无法生效的“新开窗口”。
- 应用启动阶段提前检测 Codex App 安装类型，进入账号页面后即可使用正确的启动策略。

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名，首次启动时系统可能显示安全提示。
