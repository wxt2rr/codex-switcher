# Desktop v0.1.41

- 增加 macOS 菜单栏图标和 Dock 图标显示设置，至少保留一个应用入口。
- 修复打包后的 Electron 主进程加载 Core ESM 模块导致应用启动失败的问题。
- 增加打包产物检查，确保主进程不再静态加载不兼容的 ESM 文件。

当前安装包未进行 Apple 公证或 Windows 代码签名。
