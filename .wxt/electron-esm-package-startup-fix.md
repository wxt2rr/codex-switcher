# Electron-ESM-打包启动修复

## Goal
- 修复 macOS 打包应用启动时 Electron CommonJS 主进程通过 `require()` 加载核心 ESM 文件导致的 `ERR_REQUIRE_ESM` 崩溃。
- 保持核心与网关包继续以 ESM 构建，由 Electron 运行时统一使用动态加载。

## Why Complex
- 命中 Electron 主进程、核心运行时、网关模型编译和打包验证多个模块。
- 需要同时处理主进程静态依赖图、动态运行时加载和发布包回归检查。

## Scope
- 相关模块：Electron bridge、网关模型绑定/目录、插件运行时、核心动态运行时、桌面打包测试。
- 兼容要求：保留当前 CommonJS Electron 入口与无签名 macOS 打包方式，不改变手动切换和网关业务行为。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立本次打包启动故障任务卡并确认静态 ESM 依赖图 | Electron bridge/runtime | 静态引用扫描 | done | 截图错误对应 `bridge.js:134`，已确认 `require()` 指向 core ESM |
| 2 | 移除生产 Electron 模块对 core/gateway ESM 的静态运行时导入 | bridge、模型绑定/目录、协议辅助 | TypeScript 构建 + 编译产物扫描 | done | `env -u CODEX_SWITCHER_DESKTOP_RESOURCES_PATH npm run desktop:build` 通过；生产模块扫描无静态 `require()` |
| 3 | 保留运行时校验能力并接入动态加载 | core-runtime、绑定校验 | desktop tests | done | 模型协议校验改由 `loadGatewayModelRuntime()` 动态加载 |
| 4 | 增加 CommonJS 启动依赖回归测试 | package.test.ts | desktop tests | done | `desktop:test` 通过，新增生产模块扫描通过；直接 `require(bridge.cjs)` 通过 |
| 5 | 构建、测试并重新生成 unsigned macOS arm64 包 | desktop build/package | package verify + artifact inspection | done | `desktop:package:mac` 成功生成 0.1.42 x64/arm64 DMG 与 ZIP；两套 `.app` 通过 `package:verify`；arm64 `app.asar` 内 `bridge.cjs` 静态 core/gateway `require()` 数量为 0 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 不修改与本次启动故障无关的用户工作区改动。
