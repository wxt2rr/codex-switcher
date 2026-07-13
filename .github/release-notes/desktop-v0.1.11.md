## Windows 兼容性

- 支持自动检测 Microsoft Store / MSIX 安装的 ChatGPT 与 Codex App。
- 找不到独立 EXE 时，通过 `Get-StartApps` 解析 AppID，并使用 Windows Shell 启动应用。
- 设置页面支持识别和保存 `shell:AppsFolder\...` 形式的应用目标。
- 严格校验 AppID，避免无效 Shell 目标进入启动流程。

## 路由修复

- 修复开启环境路由后只更新账号运行配置、未同步 `config.toml` 的问题。
- 开启路由时立即将当前账号的 `openai_base_url` 更新为本地路由地址。
- 关闭路由时恢复原始 Base URL；路由端口变化后同步刷新配置文件。
- 配置文件写入失败时回滚账号运行配置，避免路由状态与环境文件不一致。

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名，首次启动时系统可能显示安全提示。
