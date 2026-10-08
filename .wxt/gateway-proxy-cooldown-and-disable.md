# Gateway Proxy Cooldown and Disable

## Goal
- 代理地址变更后立即清理网关路由冷却状态，使请求使用新代理重新尝试。
- 在设置页区分“恢复自动检测”和“关闭代理”：前者清除手动覆盖，后者强制关闭代理。

## Why Complex
- 同时涉及 Electron 路由服务、代理状态同步、React 设置页和前端回归验证。
- 需要覆盖运行时状态清理和用户界面行为两个独立职责。

## Scope
- 相关模块/类：Usage Router Service、Desktop Operations、Operations Page、React App proxy handler。
- 相关文件：
  - `apps/desktop/electron/usage-router-service.ts`
  - `apps/desktop/electron/usage-router-service.test.ts`
  - `apps/desktop/src/pages/operations-page.tsx`
  - `apps/desktop/src/react-app.tsx`
  - 必要时补充相关测试文件。
- 兼容要求：保留现有手动设置代理、自动检测和路由级代理优先级；恢复自动检测后仍允许环境变量或系统代理生效。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 代理变更时清理网关冷却状态 | `usage-router-service.ts`, service tests | 核心代理测试、路由服务测试 | done | `gatewayHealth.clear()` 仅在全局代理值变化时执行；核心 159 项测试全部通过 |
| 2 | 设置页接入真正的关闭代理操作 | `operations-page.tsx`, `react-app.tsx` | 前端 TypeScript 与相关测试 | done | 新增“恢复自动检测/关闭代理”语义和按钮，Electron IPC、核心服务及 26 项定向 UI/Bridge 测试通过 |
| 3 | 完整回归与差异检查 | 相关模块 | 测试、`tsc`、`git diff --check` | done | 核心测试 159 项、桌面测试 401 项、定向 UI/Bridge 26 项通过；Web/Electron `tsc --noEmit` 和 `git diff --check` 通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
