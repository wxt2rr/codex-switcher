# 账号连接统一入口

## Goal

把账号页作为唯一的账号连接编辑入口；服务商页只做静态目录、连接统计和预选跳转；模型页继续负责逻辑模型与账号绑定，移除账号页的重复独立模型配置入口。

## Why Complex

- 同时涉及账号页、服务商页、应用级导航状态、Provider catalog 接口和模型配置入口。
- 现有 `nativeLogin` 与 `importProviderCredential` 两条保存链路需要保持兼容。
- 需要保留已有账号数据和运行时配置，不能通过删除字段破坏旧环境。

## Scope

- 账号页的服务商选项改为完整 Provider catalog，支持从服务商页预选打开。
- 账号页承担统一的账号连接表单；服务商页删除重复凭据表单。
- 服务商页详情只展示静态能力和已有环境账号，并提供“添加账号”跳转。
- 账号页的独立模型编辑入口移除；保留底层旧字段和桥接接口以兼容已有配置。
- 扩展 Provider catalog 返回默认 Base URL，供统一表单预填。

## Non-goals

- 本次不删除历史 `independentModel*` 数据字段，不做破坏性迁移。
- 本次不重写网关路由、模型绑定或凭据存储格式。
- 本次不改变 Codex AUTH、API Key、Sub2API、CPA 的既有后端保存协议。

## Task List

| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 统一 Provider catalog 契约并让账号页读取完整服务商 | `bridge.ts`, `electron/bridge.ts`, `accounts-page.tsx`, `react-app.tsx` | TypeScript build + account page tests | done | `npm run desktop:build` passed after the catalog and unified form changes. |
| 2 | 服务商页删除重复凭据表单，改为详情和统一入口跳转 | `providers-page.tsx`, `providers-page.test.ts`, `react-app.tsx` | Providers page tests + build | done | Provider page now has no credential import form and routes Add account to the Accounts page; production build passed. |
| 3 | 移除账号页独立模型编辑入口并保持旧数据兼容 | `accounts-page.tsx`, `react-app.tsx` | Desktop tests + model binding tests | done | Account page no longer renders or edits independent-model fields; legacy bridge/storage fields remain. |
| 4 | 完整验证并回写交付证据 | `.wxt` and desktop scripts | `npm run desktop:test`, `npm run desktop:build`, `git diff --check` | done | `npm run desktop:test`: 423 passed, 1 skipped, 0 failed. `npm run desktop:build` passed. `git diff --check` passed. |

## Rules

- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 不覆盖工作区已有的无关用户改动。
- 旧字段和旧桥接接口先保留，确认新入口稳定后再单独规划迁移。
