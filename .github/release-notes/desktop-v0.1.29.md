## Desktop v0.1.29

- Added startup migration across all configured environments for the Codex 0.149 authentication change.
- Removed legacy root-level API-key auth fields while preserving provider names, explicit provider authentication, and `auth.json` data.
- Safely repairs matching provider-level authentication settings and leaves ambiguous configurations unchanged.

## 安装包

- macOS：Apple Silicon DMG / ZIP
- Windows：x64 NSIS 安装程序

> 当前安装包未进行 Apple 公证或 Windows 代码签名。
