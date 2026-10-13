# Desktop v0.1.62

- 新增按 Codex 对话 ID 定点修复能力，可跨环境扫描并定位指定会话。
- 修复前展示历史/current provider、model、网关状态和可修复性；同一对话匹配多个环境时要求手动选择。
- 修复只更新指定会话的 provider 元数据，不修改消息正文；自动备份 JSONL、SQLite 及 WAL/SHM 文件。
- Codex 正在运行时拒绝写入，修复完成后展示修改文件和备份位置。
- 保留原有“同步对话列表”的全量同步逻辑不变。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
