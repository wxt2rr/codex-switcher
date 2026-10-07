# 模型页面网关绑定接通

## Goal

- 让现有“模型”页面维护的环境/账号绑定成为网关模型目录和模型路由的唯一配置来源。
- 网关模式下聚合当前环境所有已绑定模型；手动模式继续按当前账号切换。
- 不引入意图识别或意图路由，不覆盖工作区已有无关修改。

## Why Complex

- 跨桌面模型目录存储、模型页面、Electron bridge、核心网关编译和 Codex 配置同步。
- 现有绑定数据与网关状态存在两条未接通的链路，需要兼容旧版绑定格式和旧账号运行时配置。

## Scope

- 模型定义和账号绑定：`apps/desktop/electron/model-catalog-store.ts`、桌面桥接类型与模型页面。
- 网关编译：`packages/core/src/gateway/legacy-adapter.ts` 及 Electron 网关同步链路。
- Codex App 目录：`apps/desktop/electron/gateway-model-catalog.ts`、`account-model-catalog.ts`。
- 验证：模型存储、网关编译、目录同步、桌面类型和相关回归测试。

## Task List

| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 锁定并扩展模型绑定契约，兼容旧 `accountBindings` | model catalog store、bridge 类型 | 存储迁移和读写测试 | done | 新增可选的上游模型、启用状态、优先级和权重；旧 `accountBindings` 无需迁移即可读取；`npm run core:build` 和模型存储专项 5/5 通过。 |
| 2 | 从模型页面绑定编译当前环境 Gateway models/routeGroups | legacy adapter、bridge gateway enable/reload | 多账号同模型、不同模型、跨环境隔离测试 | done | 新增 `gateway-model-bindings.ts`，网关启用、配置读取、保存、活动网关重同步和应用重启恢复均接入模型页面绑定；编译器专项 2/2、桥接专项 28/28 通过。 |
| 3 | 网关模式同步聚合模型目录并处理内置模型冲突 | gateway catalog、account catalog、target-home | gateway `model_catalog_json` 同步测试 | done | 网关模型目录跳过已被路由组承载的内部模型，只暴露环境模型名；目录专项和网关目录专项通过。 |
| 4 | 调整模型页面绑定交互和环境筛选，账号页只显示摘要 | ModelsPage、bridge contracts | Web 类型检查和页面静态测试 | done | 模型绑定面板增加环境筛选、上游模型名、优先级和权重；桥接类型、IPC/preload 同步；桌面构建和模型页测试通过。 |
| 5 | 完成手动模式回归、全量专项验证并更新证据 | desktop/core/gateway tests | 相关测试命令 | done | 最新 `desktop:build` 通过；`desktop:test` 396 项（395 通过、1 个受控跳过），此前 `core:test` 157/157、`gateway:test` 79/79、lint、core/gateway build 和 `git diff --check` 全部通过。 |

## Rules

- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 旧绑定默认将模型 slug 作为上游模型名。
- 网关只按显式模型名路由，不实现意图识别或意图路由。
- 不修改根目录现有未跟踪的三个 JavaScript 文件。
