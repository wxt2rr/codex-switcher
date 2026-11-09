# model-catalog-self-healing-migration

## Goal
- 自动识别并整理旧版本把本地 Gateway 地址写入 provider identity 的模型记录，避免模型页出现重复服务商。
- 迁移前保留可恢复备份，无法唯一确认的记录不删除。

## Why Complex
- 改动模型目录持久化、Electron 读取/发现入口和回归测试，且需要兼容已有账号绑定与手动模型。

## Scope
- 相关模块：模型目录存储、桌面 bridge 的模型列表与发现流程。
- 相关文件：`apps/desktop/electron/model-catalog-store.ts`、`apps/desktop/electron/bridge.ts` 及对应测试。
- 兼容要求：不改变真实上游模型 ID；不删除无法确认归属的手动模型；迁移保留账号绑定、绑定选项和发现快照。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 增加可幂等的旧 Gateway provider identity 迁移和安全备份 | model catalog store | targeted model catalog tests | complete | `npx tsx --test apps/desktop/electron/model-catalog-store.test.ts`（29 passed）；覆盖合并绑定/选项/发现快照、历史备份、幂等执行和安全保留规则 |
| 2 | 在模型列表读取和发现成功入口调用迁移 | desktop bridge | bridge/model catalog tests | complete | `npx tsc -p apps/desktop/tsconfig.electron.json --noEmit`；`npx tsx --test apps/desktop/electron/model-catalog-store.test.ts apps/desktop/electron/bridge-core-ops.test.ts`（60 passed），最终 `bridge-smoke + model-catalog-store`（67 passed）；读取和发现成功均接入，且无法唯一映射时跳过 |
| 3 | 完成桌面测试、构建和 diff 检查 | desktop | `npm run desktop:test`, `npm run desktop:build`, `git diff --check` | complete | `npm run desktop:test`（626 passed、1 skipped、0 failed）；`npm run desktop:build` 成功；`git diff --check` 通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 迁移只处理可证明的本地 Gateway 历史身份
- 不输出或备份任何凭证原文到日志
