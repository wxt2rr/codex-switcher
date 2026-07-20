## Desktop v0.1.17

- 修复 App 多开窗口手动关闭后，后续切换账号仍按旧窗口数量重复打开的问题；现在会先核对实际存活窗口并归一保存数量。
- Chat Completions 兼容路由改为复用 Codex 内置 OpenAI Provider，仅覆盖本地 `openai_base_url`，避免动态 Provider 名称导致会话隔离。
- 自动清理旧的 `codex_switcher_*` Provider 配置，同时保留独立模型的自定义 Provider 能力。
- 同一环境内 CLI 与 App 统一使用一个活动账号；任一端切换账号后，两个选中状态和持久化指针会同步更新。
- 修复历史数据中同环境 CLI/App 指向不同账号的问题，并继续支持不同环境分别使用不同账号。

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名，首次启动时系统可能显示安全提示。
