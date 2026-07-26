## Desktop v0.1.22

- 账号创建新增独立的 Sub2API 与 CPA 导入模式，可直接粘贴各自官方 Codex 凭据 JSON 创建账号。
- Sub2API 支持嵌套或扁平 token、camelCase / snake_case、JSON 数组、逐行内容及原始 access token；CPA 支持官方扁平 Codex JSON 与数组。
- 导入内容会在本地转换为 Codex 官方 `auth.json` 结构，`refresh_token` 和 `account_id` 正确写入 `tokens`。
- 两种导入模式固定使用 Codex 官方默认路由，不再要求填写 Base URL，也不会显示兼容路由配置。
- 批量导入会先完成整批校验，再按账号名称自动生成稳定的序号后缀；错误与日志不会回显原始凭据。

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名。
