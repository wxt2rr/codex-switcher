## Desktop v0.1.28

- Skill 市场支持切换 skills.sh、Vercel 官方和 Anthropic 官方来源。
- Vercel 与 Anthropic 来源通过 GitHub 仓库目录发现 `SKILL.md`，安装时保留 Skill 子路径、分支和 revision 信息。
- 不同市场来源使用独立缓存，支持手动刷新和网络不可用时回退到缓存列表。
- 将技能列表刷新按钮移动到来源下拉框右侧，页面右上角仅保留服务商目录同步入口。
- 市场安装会同步到全部 Codex 环境，并继续按已启用的服务商绑定进行目录同步。

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名。
