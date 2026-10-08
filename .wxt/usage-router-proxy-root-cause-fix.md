# Usage Router 代理转发根因修复

## Goal
- 修复开启路由后代理请求因手工 `Content-Length` 导致的转发失败。
- 让事件日志保留底层错误的 `cause/code`，下次可以直接定位是代理、网络、超时还是请求构造问题。
- 切换全局代理时清理旧的代理连接池，避免旧连接继续影响新配置。
- 保留直连、显式路由代理、全局代理和账号池的现有行为。

## Why Complex
- 同时涉及 Electron 路由服务、上游代理连接池、事件日志和回归测试。
- 需要验证请求构造、失败冷却和代理切换三个相互关联的行为。

## Scope
- 相关模块/类：`usage-router-service`、`upstream-proxy`、路由事件日志。
- 相关文件：
  - `apps/desktop/electron/usage-router-service.ts`
  - `apps/desktop/electron/upstream-proxy.ts`
  - `apps/desktop/electron/usage-router-service.test.ts`
  - `apps/desktop/electron/upstream-proxy.test.ts`
- 兼容要求：不改变本地路由地址、账号池选择策略、模型匹配规则和手动切换模式；错误日志不得泄露密钥。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 复核代理失败链路并固化修复方案 | usage-router-service、upstream-proxy | 已确认代理请求带手工 `Content-Length` 时底层返回 `UND_ERR_INVALID_ARG` | done | 受控 Electron fetch 已复现，去掉长度头后请求成功 |
| 2 | 移除代理转发的手工 `Content-Length` | usage-router-service、upstream-proxy | 路由和账号池请求回归测试 | done | `npx tsx --test ...upstream-proxy.test.ts ...usage-router-service.test.ts` 27/27 通过 |
| 3 | 补充底层错误 cause/code 日志和代理连接池刷新 | usage-router-service、upstream-proxy | 诊断单测、代理切换测试 | done | 诊断单测通过；代理切换继续清理健康状态，连接池变更时关闭旧 agent |
| 4 | 编译并运行相关测试，检查构建产物 | Electron router | `npx tsc -p apps/desktop/tsconfig.electron.json --noEmit`、相关测试 | done | TypeScript 通过；相关测试 27/27 通过；`git diff --check` 通过 |
| 5 | 对照公开 Magpie 源码和文档整理实现差异 | 交付说明 | 引用官方源码/文档 | done | 已核对统一本地网关、`/v1/models` 模型目录、provider/model 标识、routing group 与代理说明 |
| 6 | 过滤 Upgrade/HTTP2-Settings 等逐跳请求头 | usage-router-service | 代理请求头回归测试、TypeScript 检查 | done | 新增受保护头测试；相关测试 27/27 通过 |
| 7 | 为兼容协议和通用代理入口增加同等防护 | openai-chat-compat、upstream-proxy | 代理单测、TypeScript 检查 | done | 通用代理入口统一删除逐跳头；兼容请求转发列表同步收紧 |
| 8 | 禁用网关自定义模型的 WebSocket 偏好 | model-catalog-store、gateway-model-catalog | 模型目录单测、Electron TypeScript 检查 | done | `normalizeCustomModelInput` 强制写入 `prefer_websockets: false`；目录相关测试 18/18 通过；Electron TypeScript 检查和 `git diff --check` 通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
