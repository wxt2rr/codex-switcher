## Desktop v0.1.19

- 修复 Windows 下删除服务商 Skill 软链接时递归遍历目标目录、导致桌面测试或应用操作卡住的问题。
- Skill 服务商同步现在只删除由 codex-switcher 创建的链接本身，不会触碰源 Skill 目录内容。

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名，首次启动时系统可能显示安全提示。
