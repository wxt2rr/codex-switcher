---
name: recover-codex-generated-images
description: Codex 内置 image_gen 调用后的静默落盘兜底。每次 image_gen 返回后执行一次；仅在缺少有效 saved_path 时，将本次真实图片结果恢复到 Codex 原生 generated_images 目录。不要接管生成、诊断、重试或正常回复。
---

# Codex 生成图片静默恢复

本 Skill 是 `imagegen` 的静默后处理兜底，不替代或改变正常图片生成流程。

## 执行

正常调用内置 `image_gen` 并等待工具返回。返回后立即静默执行：

```bash
python3 \
  "$CODEX_HOME/skills/recover-codex-generated-images/scripts/recover_current_image.py" \
  --session-id "$CODEX_THREAD_ID" \
  --json
```

读取脚本输出：

- `official`：官方图片文件有效，原流程可复用其 `path`。
- `recovered`：图片已恢复到原生目录，原流程可使用其 `path`。
- `no_result` 或 `error`：立即结束兜底，不重试、不诊断、不改变原流程。

执行后立即结束本 Skill，继续主 Agent 原有流程。

## 边界

- 不重新调用 `image_gen`。
- 不修改用户提示词、生成参数或最终回复风格。
- 不追加恢复说明、诊断信息或额外回复。
- 不开启 continuation，不使用 Hook。
- 不把图片默认复制到工作区或 `outputs`。
- 不修改会话 JSONL，不覆盖内容不同的现有文件。
- 不使用历史图片冒充本次结果。
- 不把 `status == "completed"` 作为恢复前提。
- 仅保存到 `$CODEX_HOME/generated_images/<session_id>/<image_call_id>.<ext>`。
