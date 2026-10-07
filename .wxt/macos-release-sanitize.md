# macOS 双架构发布与提交内容清理

## Goal
- 完成 macOS Intel（x64）与 Apple Silicon（arm64）的构建、产物校验和兼容回归。
- 清理待提交文件、日志和新增文档中的外部项目名称及参考性文案，确保提交内容只使用本项目自身术语。

## Why Complex
- 同时覆盖 Electron 构建、双架构产物、兼容回归、发布校验和仓库文本审计。
- 需要区分本机可验证的构建证据与仍需签名/公证环境的发布证据。

## Scope
- 相关模块：Desktop build/package、compatibility E2E、发布文档、开发追踪文档。
- 相关文件：`apps/desktop`、`docs`、`.wxt`、本次新增的验证日志。
- 兼容要求：保留手动切换和 Gateway 模式；不加入 Prompt 分析或意图路由。

## Task List

| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | macOS x64/arm64 构建与产物校验 | `apps/desktop`, `release` | 双架构 dir package、artifact verify | complete | x64 主程序为 `Mach-O x86_64`，arm64 主程序为 `Mach-O arm64`；两套 `.app` 均通过 `package:verify`。本机构建无 Developer ID 证书，未宣称正式签名/公证。 |
| 2 | macOS 兼容回归 | Desktop tests、已安装 CLI E2E | 387/388 + E2E 1/1 | complete | Desktop 默认 387/388，已安装 Codex 兼容 E2E 1/1；Core 157/157，Agent/CLI 定向测试通过。 |
| 3 | 提交内容术语审计与清理 | `.wxt`、`docs`、新增日志、变更文件 | 禁止词扫描、diff check、自动化门禁 | complete | 非 `.git`、依赖和发布输出目录的工作树扫描为 0；所有变更/新增文件扫描为 0；计划与追踪文件已使用中性名称，导入结果字段为 `provider_gateway`；`scripts/submission-content.test.ts` 已接入跨平台回归，后续提交若重新引入禁用术语会直接失败。 |
| 4 | 结果回写与剩余外部证据登记 | tracker、发布文档 | 证据边界清晰，无误报 | complete | 根级回归通过；macOS 双架构产物重新构建并通过校验；源文件、变更文件和 macOS release 内容的禁词扫描均为 0；正式签名/公证仍按事实记录为外部环境要求。 |

## Latest Verification (2026-10-07)

- Desktop 设置页日志展示和自动刷新功能加入后，重新执行 macOS x64/arm64 directory package；两套 `.app` 均通过 `package:verify`，主程序分别为 `Mach-O x86_64` 与 `Mach-O arm64`。
- `npm test` 通过 Core 157/157、Gateway 79/79、脚本/工作流 33/33、legacy-bash 1/1；`npm run desktop:test` 通过 388/389（1 项显式 Codex E2E skip），`npm run desktop:build` 和 `npm run lint` 通过。
- 最终重打包后，x64 与 arm64 两套 `.app` 均再次通过 `package:verify` 和本地嵌套签名校验；本机运行态检查确认二进制架构正确，但独立启动进程停留在 macOS 原生启动阶段，未形成业务窗口启动证据，因此不将其误记为包运行态通过。
- 工作树源文件、变更文档和生成的 macOS release 内容均通过禁用术语扫描；本次变更准备提交并推送，未宣称正式 Developer ID 签名或公证。
- 启动阻塞修复：Provider Plugin Runtime 不再静态引用工作区 Gateway 入口，改由 `core-runtime` 按打包资源路径懒加载 Manager、Market 和签名模块；重新打包后通过 `open -n` 分别启动 x64/Rosetta 与 arm64，两个窗口均加载到业务页面，x64/Rosetta 与 arm64 各有 Electron 子进程运行。
- 新增启动回归门禁：`package.test.ts` 检查资源加载边界，`provider-plugin-runtime.test.ts` 检查 Manager、Market 和签名实现可由运行时解析。

## Rules
- 同时只能有一个 `in_progress`。
- 所有新增或修改的提交内容不得出现外部项目名称、比较性参考文案或相关品牌文案。
- 不修改既有 Git 历史，不伪造签名、公证或真机运行证据。
- 不实现意图路由；路由只使用显式模型、Provider/Credential、RouteGroup、协议和受控元数据。
- 每完成一项立刻回写状态和验证证据。
