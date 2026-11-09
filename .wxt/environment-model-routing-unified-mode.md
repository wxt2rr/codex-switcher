# environment-model-routing-unified-mode

## Goal
- 为每个环境增加“按服务商区分 / 统一模型自动路由”模式。
- 保留非网关直连行为，避免 Plus 原生模型 ID 被改成 provider-qualified 别名。
- 网关开启时提供基于真实编译路由配置的模型路由预览面板。
- 完成配置迁移、旧模型 ID 兼容、能力安全合并、确定性路由、运行时同步、国际化、测试与构建验证。

## Why Complex
- 跨环境配置持久化、模型目录编译、网关路由、运行状态 IPC、React 环境页和多语言文案。
- 需要兼容已有 Plus 原生 `gpt-6.1-sol`、CKT provider-qualified 模型 ID，以及正在运行的网关。
- 需要同时覆盖网关和非网关模式，预计修改超过 4 个模块和 150 行代码。

## Scope
- 相关模块/类：环境配置、模型目录、Gateway route groups、路由状态/预览 IPC、环境卡片、路由预览 UI、国际化、测试。
- 相关文件：`apps/desktop/electron/*`、`packages/core/*`、`packages/gateway/*`、`apps/desktop/src/pages/environments-page.tsx`、相关组件/桥接类型/样式/文案。
- 兼容要求：默认保持现有按服务商行为；Plus 保持原生模型 slug；旧 provider-qualified slug 可继续解析；关闭网关时不影响直连账号。
- 不在范围：不伪造 Codex 内部 `additional_tools` 协议，不改动上游 provider 的认证语义，不删除现有诊断与转换能力。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 盘点现有环境、模型目录和路由编译边界，锁定持久化字段与兼容策略 | `packages/core`, `apps/desktop/electron`, existing tests | `rg`, targeted tests, type inspection | done | `routeGroups` 已支持 exposed model、能力、会话亲和性和故障切换；Plus 使用 bundled `gpt-6.1-sol`，CKT 当前使用 provider-qualified slug；环境元数据文件可扩展且不影响旧文件 |
| 2 | 增加环境级模型身份模式配置、schema 校验、默认值与迁移 | core model/config types, state persistence, bridge contracts | migration tests, invalid config tests | done | 缺省字段保持旧文件形状；业务层默认 `account`；legacy meta 支持读写 `unified`，非法值归一到 `account`；core 173 项测试通过 |
| 3 | 实现统一模式模型目录编译、路由组生成、能力安全合并和旧 ID 兼容 | model catalog, gateway compiler, router | catalog/compiler/router tests | done | unified route group 按逻辑 upstream 合并 Plus/自定义 provider；能力取安全交集；provider-qualified ID 通过 nested compatibility group 兼容；编译测试通过 |
| 4 | 实现路由预览 DTO、后端从真实编译配置生成预览、刷新与同步状态 | usage-router manager, bridge, preload, renderer bridge | IPC/DTO tests, stale state tests | done | 新增 redacted preview IPC；预览读取环境 gateway、运行 routes、provider/credential 状态；模式切换会持久化并重新编译运行网关；无密钥返回 |
| 5 | 实现环境卡片模式入口和网关路由预览面板，覆盖网关/非网关/异常/空状态与国际化 | `environments-page.tsx`, components, styles, copy/i18n | component tests, responsive checks, build | done | 环境卡片提供按服务商/统一自动路由入口；新增实际模型/服务商/账号/上游/协议/能力/健康/默认/故障切换预览；网关关闭显示直连警告；中英文/日文布局复用现有组件 |
| 6 | 完善运行时切换、网关同步、旧配置回退、会话亲和性和能力不匹配错误 | gateway runtime, sync lifecycle, route engine | integration tests, failure/fallback tests | done | 已复用现有 gateway rebuild/sync 生命周期；模式变更只更新网关路由，不重启 Codex App；关闭网关保留偏好但恢复直连；既有 235 项 Gateway 与环境路由集成测试通过 |
| 7 | 完成全量验证、文档、变更审查和交付报告 | tests, build, typecheck, `git diff` | desktop/gateway tests, build, `git diff --check` | done | core 173 项、gateway 235 项、desktop 601 项（600 passed、1 skipped）通过；desktop build 与 web/electron typecheck 通过；`git diff --check` 通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
- 不覆盖工作树中与本任务无关的已有改动。
- 没有真实验证证据不得标记 done 或宣称完成。
