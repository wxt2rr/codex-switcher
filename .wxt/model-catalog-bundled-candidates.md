# model-catalog-bundled-candidates

## Goal
- 将 Codex App 自带的 bundled model catalog 纳入全局模型目录和账号模型选择框；选择第三方服务商账号时，按当前账号/服务商生成绑定，不把官方模型路由误用到第三方服务商。

## Why Complex
- 跨 Electron 模型目录、账号模型选择 UI、Codex 配置同步和测试多个模块，预计修改超过 4 个模块。

## Scope
- 相关模块/类：Codex bundled catalog loader、model catalog store/bridge、账号模型曝光面板、账号目录同步。
- 相关文件：`apps/desktop/electron/account-model-catalog.ts`、`apps/desktop/electron/model-catalog-store.ts`、`apps/desktop/electron/bridge.ts`、`apps/desktop/src/components/account-model-exposure-panel.tsx` 及对应测试。
- 兼容要求：保留现有环境/账号隔离、现有服务商发现结果和已保存绑定；bundled 模型默认只作为候选，不自动绑定。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 定义 bundled 模型目录的稳定来源和导入/去重规则 | model catalog store、account model catalog、bridge | `account-model-catalog.test.ts`：provider-neutral 清洗通过 | done | `normalizeBundledModelEntry` 删除旧服务商元数据并标记 `model_source=bundled`；`listCustomModels` 自动同步当前安装的 App bundled catalog |
| 2 | 将 bundled 模型作为所有账号选择框的候选，但保留账号发现优先级 | account-model-exposure-utils/panel | `account-model-exposure-panel.test.ts`：默认账号可见且不泄漏其它账号模型 | done | bundled 无 provider key，会进入全账号候选；UI 标注 Codex 内置并显示自动同步提示 |
| 3 | 保存第三方绑定时生成当前服务商模型身份，官方账号保持内置模型身份 | bridge、model catalog store、gateway catalog | `model-catalog-store.test.ts`、`gateway-model-bindings.test.ts` | done | API-key 账号选择 bundled 时走 provider projection；已发现同名模型复用服务商记录；订阅账号跳过重复编译 |
| 4 | 将 bundled 模型写入 Codex 账号目录并处理冲突/刷新提示 | account-model-catalog、bridge | `account-model-catalog.test.ts`、桌面构建 | done | bundled 模型以 provider-neutral 候选进入全局目录；API-key 账号选择后投影到当前服务商，AUTH 账号保留内置绑定；模型页标记为自动同步且不可编辑/删除 |
| 5 | 运行完整桌面/网关检查并核对残余风险 | repo | `npm run desktop:build`、`npm run desktop:test`、`npm run gateway:test`、`git diff --check` | done | 桌面构建通过；桌面 527 项测试通过（1 skipped）；Gateway 138 项测试通过；旧 Resources 环境变量导致的能力断言已用无旧资源环境复验通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
