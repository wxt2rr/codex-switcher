# Desktop v0.1.59

- 统一 Codex 自定义直连和网关路由使用的 provider 标识为 `codex_switcher_router`，避免同一环境产生两套对话历史。
- 新增环境页“同步对话列表”操作，可将当前环境中旧 provider 的 Codex 对话元数据迁移到统一 provider，并在迁移前创建可恢复备份。
- 同步操作会更新会话 JSONL 和 `state_5.sqlite` 中的 provider 元数据，不改动消息内容；运行中的 Codex 实例会被安全拦截，避免并发写入。

本版本安装包仍未进行 Apple 公证或 Windows 代码签名。
