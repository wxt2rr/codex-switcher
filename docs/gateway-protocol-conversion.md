# Gateway 协议转换内核

当前网关使用项目内独立实现的 TypeScript 转换内核，不引入 RelayKit 源码或 AGPL 运行时依赖。Electron 的真实入口是 `apps/desktop/electron/usage-router-service.ts`，请求经过路由和账号选择后，才按“入站协议 → 账号上游协议”转换；响应按反方向转换，路由、凭证、代理、重试和账号池仍由桌面服务负责。

支持四种协议：

- OpenAI Responses
- OpenAI Chat Completions
- Anthropic Messages
- Google Gemini

转换内核位于 `packages/gateway/src/conversion/`，包含请求、非流式响应、SSE 流状态、工具调用、推理、多模态、Usage、路径质量和诊断。默认支持文本、图片 URL/base64、文件 URL/base64、function/custom/namespace/web-search 工具映射，以及工具参数跨流式 chunk 拼接。

## 请求链路

```text
Codex/App 请求
  -> detectGatewayProtocol
  -> model/route/account 选择
  -> conversion request: ingress -> upstream protocol
  -> provider/account upstream
  -> conversion response: upstream protocol -> ingress
  -> Codex/App
```

同协议是 identity；Responses 与 Chat Completions 之间是直接高质量转换；其他协议按字段能力判定为 `fair`，Anthropic 与 Gemini 之间标记为 `discouraged`。不等价的 custom、namespace、web-search 工具或媒体处理会进入 `conversionDiagnostics`，不会静默丢弃。

## 日志和根因定位

路由事件文件默认位于环境 state 目录下的 `router-events.jsonl`，按 JSONL 追加写入，不按日期自动切分。转换相关事件字段包括：

- `conversionQuality`：`good`、`fair` 或 `discouraged`
- `conversionDiagnostics`：字段降级、默认值、媒体解析和 legacy 回退原因
- `ingressProtocol` / `upstreamProtocol`
- `requestedModel` / `routeId` / `accountName`

排查时先按 `requestId` 或 `gateway_route_attempt` / `pool_request_completed` 找到一次请求，再看协议、模型、账号、上游 HTTP 状态和转换诊断。`MODEL_NOT_FOUND` 属于路由/模型能力选择阶段；`400/405` 且有转换诊断时，再检查上游路径和协议 body；流断开时检查最后一个转换事件及上游是否发出终态。

## 明确回退开关

默认使用共享转换内核。只有需要临时对比或回滚时，才设置：

```bash
CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION=1
```

该开关会在启动日志中明确记录，并将 `conversionDiagnostics` 写成 `legacy_conversion_forced`。未设置时，如果打包资源缺失，服务才会记录 `conversion_runtime_unavailable` 并临时使用旧兼容适配器；发布构建必须包含 `packages/gateway/dist/conversion/**`，因此正常发布不会触发该回退。

旧适配器仅用于这个显式兼容场景，不再承载新协议能力。新增协议字段、工具类型或流事件时，应先更新 `packages/gateway/src/conversion/**`、golden fixture 和矩阵测试，再更新 Electron 入口；这样开发环境、打包应用和日志诊断使用同一套转换契约。

## 验证

```bash
npm run gateway:build
npm run gateway:test
npx tsc -p apps/desktop/tsconfig.electron.json --noEmit
npx tsx --test apps/desktop/electron/usage-router-service.test.ts
npm run desktop:test
npm run desktop:build
npm run desktop:package:mac:dir
```

测试覆盖四协议 request/response golden、工具/推理/Usage/媒体诊断、四协议流式方向、Responses→Chat→Responses 的真实桌面 SSE 链路，以及账号池转换诊断落盘。发布前还应检查 macOS `.app/Contents/Resources/packages/gateway/dist/conversion/index.js` 存在；这证明打包资源包含共享转换内核。
