# 网关账号服务商同步修复

状态：complete

## 目标

修复账号已切换到新服务商（例如 `openai` → `qwen`）但持久化网关仍保留旧 provider/credential 元数据，导致模型发现直接报“没有启用 credential”，以及发现成功后路由仍绑定旧 provider 的问题。

## 范围

1. 模型发现前，用当前账号运行时配置生成一致的 discovery gateway 视图，确保 provider、credential 和账号引用一致。
2. 发现成功后，同步活动网关中的 provider/credential 元数据，并迁移该账号从旧 provider 记录到新 provider 记录的模型绑定与绑定选项。
3. 发现失败时不发布半成品网关状态，保留上一次可用路由，同时记录清晰的失败原因。
4. 对服务商切换、模型绑定迁移、发现失败保护补充自动化回归测试。

## 验收标准

- 当前账号 runtime 的 `providerId`、网关 credential 的 `providerId`、网关模型/路由成员的 `providerId` 一致。
- `test/阿里云` 从旧 `openai` 切换到 `qwen` 后，下一次发现使用 Qwen 内置 adapter，成功后 qwen 模型可编译成可用网关路由。
- 发现失败不会把活动网关写成缺 provider/credential 的不可用状态。
- 多账号共用模型、其他账号仍绑定旧 provider 时不被误迁移。
- 现有测试、类型检查和构建通过。

## 执行切片

- [x] 切片 1：实现账号与网关元数据同步/发现视图，并覆盖纯函数测试。
- [x] 切片 2：接入模型发现链路；仅成功后重新编译活动网关。
- [x] 切片 3：在模型目录保存成功发现结果时迁移当前账号旧 provider 绑定。
- [x] 切片 4：运行定向测试、类型检查、构建，审查残余风险。

## 验证记录

- 定向网关/模型测试：29/29 通过。
- 桌面端完整测试：445 个测试中 444 通过、1 个按环境变量跳过的 E2E；失败数为 0。
- `tsc -p apps/desktop/tsconfig.electron.json --noEmit`：通过。
- `npm run build --workspace ./apps/desktop`：通过。
- `git diff --check`：通过。

## 日志诊断字段

`account_model_discovery` 事件额外记录：

- `providerId`：账号运行时本次实际使用的 provider。
- `gatewayCredentialFound`：网关是否找到对应账号 credential。
- `gatewayCredentialId`：持久化网关找到的账号 credential。
- `gatewayProviderIdBeforeSync`：发现前网关 credential 的 provider。
- `gatewayProviderMismatch`：两者不一致时为 `true`。

因此后续只看 `switcher.log` 就能区分“账号配置变更未同步到网关”和“上游服务商请求失败”，不需要再猜测 Codex 是否携带模型。

## 非目标

- 不复制或改写 API key、token 等秘密内容。
- 不删除旧 provider 或其他账号的模型记录；旧记录只在当前账号绑定范围内迁移。
- 不在本次修改 provider adapter 的实际 HTTP 协议实现。
