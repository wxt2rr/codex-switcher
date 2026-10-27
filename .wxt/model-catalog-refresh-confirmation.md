# 模型目录-刷新确认

## Goal
- 模型目录或账号模型绑定发生变化时，先完成网关与配置文件同步，但不立即重启正在运行的 Codex App。
- 由界面提示用户确认，确认后再重启 Codex App 刷新内存中的模型列表；取消则保留配置并允许稍后刷新。

## Why Complex
- 跨 Electron bridge、IPC/preload、模型页、账号模型暴露面板和全局确认交互。

## Scope
- 相关模块/类：模型目录同步、Codex App 生命周期、模型页、账号模型暴露面板、桌面桥接。
- 相关文件：`apps/desktop/electron/bridge.ts`、`main.ts`、`preload.ts`、`apps/desktop/src/bridge.ts`、模型/账号页面及测试。
- 兼容要求：不改变模型目录数据和网关路由编译结果；无运行中的托管 App 时不弹出确认；浏览器预览桥接保持可用。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 将模型目录变更后的自动重启改为返回刷新需求元数据 | Electron bridge/model types | Electron bridge tests | done | `ModelCatalogMutationResult` 返回 `appRefresh`；变更流程不再传入 `restartRunningApp` |
| 2 | 增加“确认后刷新 Codex App”IPC 与 preload/前端桥接 | main/preload/src bridge | TypeScript/build | done | 新增 `desktop:refreshCodexAppModelCatalog`，桌面构建通过 |
| 3 | 增加全局确认弹框并接入模型页、账号模型暴露面板 | React pages/components | UI/type tests | done | 模型保存、删除、发现、账号绑定都会进入确认弹框；取消不重启 |
| 4 | 更新测试并执行桌面构建与相关测试 | tests/build | Test/build commands | done | smoke/UI/模型目录测试 39/39；`npm run desktop:build` 通过；未再运行会触碰真实 App 生命周期的 bridge 集成测试 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
