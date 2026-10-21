# Desktop v0.1.71

- 修复 Windows 对 `AppData\\Roaming` 或 `LocalAppData` 没有写权限时，Provider 插件仍然安装失败的问题。
- 安装 Provider 插件前探测真实可写目录，按应用数据目录、LocalAppData、系统临时目录顺序选择，并让桌面进程与 Gateway 子进程共享最终路径。
- 固定 Linux 发布任务使用 Ubuntu 24.04，避免 Ubuntu 26 的 bubblewrap 网络命名空间限制阻塞发布校验。
- 保留 v0.1.69 的 Windows 插件独立数据目录和安装进度反馈。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
