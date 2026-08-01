## Desktop v0.1.24

- 账号创建改为先选择服务商：OpenAI 保留现有登录、API Key、Sub2API、CPA 四种模式；DeepSeek 使用独立的 API Key 创建流程。
- DeepSeek 服务商固定使用官方 Base URL `https://api.deepseek.com`，创建账号时不再显示或允许修改 Base URL。
- DeepSeek 账号创建成功后会自动绑定默认模型 `deepseek-v4-flash` 和 `deepseek-v4-pro`。
- 内置模型列表新增 DeepSeek 官方模型预设，会填充到 `models.json`，不会覆盖用户已有的同名模型配置。
- 独立模型模式会识别 DeepSeek 官方 Base URL，并为 DeepSeek 账号自动使用对应默认模型配置。

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名。
