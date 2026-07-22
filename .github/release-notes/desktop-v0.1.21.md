## Desktop v0.1.21

- 修复 macOS Dock 环境标识在切换 Space、进入全屏、Dock 自动隐藏及左右布局时漂移、闪现或映射到错误应用的问题。
- Dock 环境标识现在严格匹配 Codex / ChatGPT 应用项，并在 Space 手势开始时隐藏、切换完成后按实际 Dock 几何恢复。
- 修复 Codex App 环境标识开关在已授予辅助功能权限后仍保持关闭的问题；授权流程会清理当前应用的失效权限条目并限时自动复查。
- macOS 本地未签名构建现在生成完整的 ad-hoc 资源封印，发布前会执行严格签名校验，避免应用被 Gatekeeper 识别为损坏包。

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名。macOS 本地更新可能需要重新授予辅助功能权限。
