# Desktop v0.1.76

- 修复 Windows Provider 插件初始化数据目录时报 `EPERM: operation not permitted, mkdir` 的问题。
- Windows AppContainer 启动器现在会为插件托管数据目录授予临时读写权限，并在插件退出后清理对应 ACL。
- 补充托管数据目录父级的遍历权限，兼容 Windows AppData 路径和旧安装目录。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
