# environment-direct-model-catalog-after-gateway

## Goal
- 关闭环境网关后，重建当前直连账号的模型目录。
- 直连目录只保留当前账号绑定/发现的模型和 Codex 内置模型，不残留其他账号的网关模型。
- 直连模型使用原始 upstream model id 和原始模型名，不生成 `账号:模型` 的网关展示格式。

## Why Complex
- 涉及模型目录生成、网关关闭生命周期、启动恢复迁移和现有模型目录兼容测试。

## Scope
- 相关文件：`apps/desktop/electron/account-model-catalog.ts`、`apps/desktop/electron/bridge.ts` 及对应测试。
- 兼容要求：网关目录继续使用 provider/account 命名；直连目录仅改变生成结果。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 直连目录只生成当前账号模型并移除网关命名 | account model catalog | catalog tests | done | 直连条目改用 upstream id/name；同名模型覆盖内置候选，网关目录逻辑未改变 |
| 2 | 关闭网关/启动恢复后重建直连目录 | bridge | bridge regression test | done | 关闭网关及启动时发现残留网关目录都会重建当前账号目录，并移除旧网关目录指针 |
| 3 | 全量验证并推送 | desktop/core | build/test/check | in_progress | `desktop:test` 630 项、`desktop:build`、`npm run check` 已通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
