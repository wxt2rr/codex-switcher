# models-model-editor-form

## Goal
- 让模型编辑器的表单与 JSON 目录字段保持同步。
- 为 Codex 模型目录提供可复用的枚举多选控件，并让 JSON 配置模型默认包含文本和图片输入能力。

## Why Complex
- 同时涉及模型目录默认值/规范化、模型编辑器数据同步、表单控件和网关能力编译四个职责区域。
- 需要兼容已有模型记录和 JSON 中的未知字段，避免切换编辑模式时丢失配置。

## Scope
- 相关模块/类：模型目录规范化、桌面模型编辑页、模型编辑辅助函数、网关能力映射。
- 相关文件：`apps/desktop/src/model-editor.ts`、`apps/desktop/src/pages/models-page.tsx`、必要的表单组件与 `apps/desktop/electron/model-catalog-store.ts`。
- 兼容要求：保留 JSON 编辑模式；表单修改只更新已声明字段，未知字段继续保留；已有明确的文本-only 模型不强制伪装成视觉模型，手动 JSON 模型缺省时默认 text/image。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 梳理目录字段、枚举和表单同步边界 | model-editor, models-page, model-catalog-store | 代码阅读 | done | 已确认现有表单只有 slug/display_name；JSON 目录字段来自 Codex catalog schema |
| 2 | 扩充模型编辑数据模型与默认值，提供枚举/数组规范化 | `apps/desktop/src/model-editor.ts`、目录规范化 | TypeScript/desktop build | done | 已补齐 Codex 目录字段、枚举、缺省值；空 input_modalities 自动回落到 text/image |
| 3 | 实现完整表单与 JSON 双向同步、多选数组控件 | `apps/desktop/src/pages/models-page.tsx`、表单组件 | TypeScript/desktop build | done | 表单覆盖稳定目录字段；协议、输入类型、推理级别等数组使用枚举多选；未知字段由对象展开保留 |
| 4 | 确认手动 JSON 模型缺省视觉能力并保持网关编译一致 | `apps/desktop/electron/model-catalog-store.ts`、`gateway-model-bindings.ts` | TypeScript/desktop build | done | 手动/JSON 模型缺少或空 input_modalities 时写入 text/image；网关继续依据 image 编译 vision |
| 5 | 汇总改动与残余限制 | 本变更 | git diff/build evidence | done | `npm run desktop:build` 成功；仅构建过程生成的已跟踪声明文件改回原状态，工作树只保留本功能改动 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 不修改生成的 `env-gateways` 文件作为长期配置来源。
