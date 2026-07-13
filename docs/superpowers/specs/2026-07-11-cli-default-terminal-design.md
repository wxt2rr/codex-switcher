# CLI 默认终端设计

## 目标

在系统设置中扫描并选择 CLI 默认打开的软件，支持 macOS 与 Windows。下拉框只展示当前设备可用终端，不提供“自动选择”。

## 终端与优先级

- macOS：iTerm、Terminal、Warp、Ghostty。
- Windows：Windows Terminal、PowerShell 7、Windows PowerShell、Command Prompt。
- 未保存选择、保存项失效或被卸载时，按上述顺序选择第一个可用项并立即持久化。
- macOS Terminal 与 Windows PowerShell/Command Prompt 作为系统兜底项。

## 设置交互

- 系统页新增“CLI 默认终端”单行设置。
- 使用下拉框展示检测到的软件，选择后自动保存并实时生效。
- 提供“重新扫描”按钮；扫描后保留仍有效的选择，否则执行优先级回退。
- 下拉框使用点击展开，不使用 hover 自动展开。

## 启动行为

- iTerm、Terminal 保留当前窗口和新窗口能力。
- Warp、Ghostty 可靠启动新窗口；当前窗口请求降级为新窗口。
- Windows 终端统一打开新窗口；当前窗口请求降级为新窗口。
- Windows Terminal 内部 shell 优先 PowerShell 7，其次 Windows PowerShell，最后 Command Prompt。

## 数据与错误

- 在 `~/.codex-switcher/desktop-settings.json` 保存 `cliTerminalId`。
- 扫描结果由 Electron 主进程生成，renderer 不直接访问文件系统。
- 保存失败时 UI 恢复旧选择并显示错误。
