## 修复 Codex App 启动循环

- 修复启动阶段反复刷新模型目录并重启 Codex App 的问题。
- 修复 Windows runner 下 macOS App 内置 CLI 路径解析失败的问题。
- 修复 Windows 换行配置导致桌面桥接 smoke test 误报失败的问题。

本版本继续保留“模型配置变更后由用户确认，再刷新正在运行的 Codex App”的行为。
