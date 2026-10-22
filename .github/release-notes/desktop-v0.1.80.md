# Desktop v0.1.80

- 修复 Windows 安装后启动异常时只显示白屏的问题。
- 增加渲染入口的多路径解析，兼容不同 NSIS 安装目录和 `app.asar` 布局。
- 捕获主进程、preload 和渲染进程启动错误，并写入 `startup.log`；无法加载界面时展示可读的错误页。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
