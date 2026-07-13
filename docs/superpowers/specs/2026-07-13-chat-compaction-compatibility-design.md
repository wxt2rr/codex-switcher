# Chat Compaction Compatibility Design

## Goal

让自定义 Chat Completions 账号能够使用 Codex 原生的长会话文本压缩流程，同时正确处理从原生 Responses 会话切换过来的加密压缩历史。

## Non-goals

- 不在 codex-switcher 中实现第二套摘要存储或 Token 预算系统。
- 不把 OpenAI 加密 `compaction` 转换成普通文本。
- 不伪造 `/responses/compact` 的原生加密响应。

## Protocol Policy

Codex 根据 Provider 能力选择压缩路径：OpenAI/Azure 使用远程 `/responses/compact`，其他 Provider 使用普通 `/responses` 请求执行本地文本压缩。

Chat 兼容账号必须保持自定义 Provider 名称，不得被标记为 `OpenAI` 或 `Azure`。普通 `/responses` 继续由现有 Responses-to-Chat 转换器处理；Codex 生成的摘要请求因此使用当前自定义模型完成，Codex 负责替换历史和重新计算 Token。

原生 Responses 账号保持现有 `/responses/compact` 透传行为。Chat 账号不得伪造远程 compact 响应。

## User Setting

仅对 Chat Completions 兼容账号显示 `长会话处理策略`：

- `安全压缩`（默认）：Codex 本地文本压缩照常进行；发现无法转换的加密压缩历史时阻止请求并提示新建会话。
- `连续性优先`：Codex 本地文本压缩照常进行；发现加密压缩历史时移除不可转换项，使用可读取历史继续，并显示可能丢失早期上下文的警告。

策略变更不改写已有会话文件，只影响后续请求。原生 Responses 账号不显示此设置。

本期不提供“关闭 Codex 自动压缩”选项：Codex 的自动压缩阈值由客户端模型配置控制，路由层不能可靠地关闭它。若后续验证了对应配置的稳定语义，再单独增加该选项。

## Request Handling

转换器识别 `compaction`、`compaction_summary` 和相关压缩标记。普通 Chat 请求中的未知压缩项不得再触发通用 `Unsupported input item` 崩溃：安全策略返回可操作的兼容错误，连续策略过滤这些项后继续。

过滤或阻止必须记录脱敏诊断信息，不记录加密内容、完整提示词或 API key。工具调用及其结果的顺序必须保持不变。

## UI Feedback

Codex 原生压缩状态和摘要不作为普通 assistant 回复回显。路由只提供必要警告：

- 安全策略：`当前会话包含无法转换的压缩历史，请新建窗口继续。`
- 连续策略：`已使用可读取的历史继续，部分早期上下文可能丢失。`
- 压缩失败：`上下文整理失败，请重试或新建窗口。`

## Token Display

不自建进度计算。Codex 压缩完成后会依据替换后的历史重新估算 Token 并刷新 TokenCount。模型目录必须提供准确的 `context_window`、`max_context_window` 和 `effective_context_window_percent`，否则进度圈只能降级为不确定状态。

## Verification

必须覆盖：

1. Chat 模型手动 `/compact` 和达到阈值自动文本压缩。
2. 压缩后 Token 进度下降并继续对话。
3. 工具调用完成后压缩并继续工具循环。
4. 重启后恢复文本压缩会话。
5. 原生加密压缩会话切换到 Chat 账号时的安全策略和连续策略。
6. 原生 OpenAI `/responses/compact` 透传不受影响。
7. 压缩项过滤、警告、日志脱敏及 API key 不泄露。
