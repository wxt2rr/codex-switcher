## Desktop v0.1.25

- 新增小米 MiMo 服务商入口：添加账号时可直接选择 MiMo，使用 API Key 创建账号。
- MiMo 服务商固定使用官方 Responses Base URL `https://api.xiaomimimo.com/v1`，创建账号时不允许手动修改。
- MiMo 账号创建成功后会自动绑定默认模型 `mimo-v2.5-pro` 和 `mimo-v2.5`。
- 内置模型目录新增 MiMo 官方模型预设，切换账号时会生成只包含 MiMo 默认模型的 `models.json`。
- 支持识别 MiMo Token Plan 地址 `https://token-plan-cn.xiaomimimo.com/v1` 并匹配 MiMo 模型目录。
- 修复模型列表账号数量显示不准的问题：已删除账号或旧环境残留绑定不再计入模型绑定数量。
- 保持 DeepSeek 服务商和现有 OpenAI 登录/API Key/导入逻辑不变。

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名。
