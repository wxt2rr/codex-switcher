# 全能力对齐开发

## Goal

- 按 `docs/full-capability-development-plan.md` 完成 P0-P10 全部纳入范围的内容。
- 不保留任何“首版非阻塞”或“后续再做”的计划遗漏；意图分类/意图路由是明确产品排除项。
- 保留并验证手动切换模式，同时完成完整 Gateway/Provider/Agent/Protocol/RouteGroup/Plugin/Usage/UI/CLI/发布能力。

## Why Complex

- 跨 Core、Gateway Runtime、Electron、桌面 UI、CLI/TUI、配置编辑器、Provider 插件、协议适配和三平台发布。
- 需要接入 30+ Agent Adapter、多个订阅 Provider、4 种协议和嵌套路由策略；不分析 Prompt，不做意图路由。
- 需要兼容现有 Codex Switcher 数据、旧手动模式和已完成的 Gateway v1。

## Scope

- 详细计划：`docs/full-capability-development-plan.md`
- 能力基线：Provider、Agent、Gateway、Plugin、Catalog、Usage 全部层。
- 不覆盖与模型网关无关的既有用户修改。

## Task List

| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| P0 | 源码对齐、契约冻结和 Gateway 内核拆分 | `packages/core`, new `packages/gateway`, `usage-router-service.ts` | Core/Gateway unit + typecheck | complete | v1/v2 Gateway 双写、v2-only 降级读取和清理已接入旧 legacy runtime；桌面 HTTP Service 启动时加载共享 framework-agnostic Gateway route engine，显式 Catalog Model/Credential/RouteGroup 投影为可运行的模型路由，重复配置会清理旧模型路由，手动模式仍走原账号切换路径；当前 Core 157/157、Gateway 79/79、两包 build 通过。 |
| P1 | 全量 Agent Adapter、配置写入、恢复和 Drift | `packages/gateway/src/agent`, `apps/desktop/electron/agent-gateway-config.ts` | 每个 Agent fixture、apply/restore/drift | complete | 44 个 Agent profile；统一 apply/restore/unwire/check/sync/renameRefs/listFields；JSON/JSONC/env/TOML/YAML 写入、外部编辑和精确恢复 fixture 通过；Node Agent filesystem 的配置与 snapshot 写入现在使用同目录临时文件 + rename 原子替换，并验证无临时文件残留；重复 apply 会保留最初未接入快照，桌面 Gateway 保存 Agent binding 时已真实执行 apply/restore，并在运营视图显示 Clean/Drifted/Missing/Unwired 状态；显式声明的 reasoning/fallback/sub-agent 字段会随 Agent binding 持久化并写入对应配置路径，未声明的 Agent 字段不会被猜测或新增。 |
| P2 | 协议 IR 和四协议双向转换 | `packages/gateway/src/protocol`, `apps/desktop/electron/protocol-adapters.ts`, `usage-router-service.ts` | 全转换矩阵 fixture、流式/工具/推理/图片 | complete | Gateway 四协议 rich matrix 和桌面 4×4 request/JSON/SSE response tests 通过；Runtime 具备首字节前 fallback dispatch；桌面 Gateway 真实 HTTP 回归验证了 Responses 入口到 Anthropic 上游的路径、请求体、凭证和响应转换。 |
| P3 | Provider Adapter、订阅登录、动态模型和配额 | `packages/gateway/src/provider`, `packages/core/src/gateway`, `apps/desktop/electron/gateway-model-discovery.ts`, `usage-router-service.ts` | Provider contract + secret/quota tests | complete | 22 个内置 Provider 覆盖 API key、local、OAuth、subscription、custom；refresh/revoke/model/quota/signing/error contract tests 通过。CLI 已支持受控环境变量驱动的 Provider login、live refresh、quota、revoke，凭证写入受保护账号存储且 Gateway 只保存 `secretRef`；本地真实 HTTP 服务回归实际跑通模型发现、Quota、Refresh、Revoke 及鉴权头/请求体；Credential 模型 allowlist、Provider/Credential 非敏感 Header 与显式 Provider/Credential/Route 代理已贯穿 schema/import/discovery/RouteTarget/SQLite/upstream forwarding，并阻断敏感 Header 注入。Credential 代理覆盖 Provider 代理，代理 URL 禁止内嵌认证信息；真实第三方凭证验证仍需受控环境。 |
| P4 | RouteGroup v2、嵌套组、策略、规则和故障转移 | `packages/gateway/src/routing`, `apps/desktop/electron/usage-router-service.ts` | strategy/nesting/affinity/fallback tests | complete | 嵌套/深度 8/cycle、六种策略、affinity、capability、failure class、Runtime fallback，以及桌面 HTTP Service 通过共享 route engine 的 Gateway+credential-pool 组合均有测试；账号池叠加模型组时会按显式绑定改写 upstream model；Gateway 路由在显式开启转换时可按模型组选取不同协议的上游，未开启时仍保持精确协议匹配；桌面 Gateway 现在把窗口内请求数、Token 估算和延迟传入 `usage/pace/smart`，指标按 Gateway/路由隔离并自动过期；显式规则仅支持 Token 数、图片、推理/推理档位、Agent、Context compact、时间、模型和 Provider 元数据，且共享引擎、本地兼容解析路径和 CLI Gateway 启动路径均覆盖 RouteGroup 目标；显式请求模型只有在规则明确列出该模型名时才可映射到目标 RouteGroup，宽泛元数据规则不会覆盖用户模型选择；不读取 Prompt、不做意图分类。 |
| P5 | 产品范围确认：移除意图路由 | `packages/gateway`, `apps/desktop/electron`, `packages/core` | no intent API/field/runtime path + regression | complete | 产品边界已冻结：不分析 Prompt、不调用分类模型、不保存意图规则；路由只依赖显式模型/路由组、协议、能力、健康度、配额和策略。源码中仅保留兼容清理器，用于丢弃旧配置里的意图字段；Core Gateway v1/v2 schema 现在也会拒绝直接传入的 `prompt`/`intent`/`classifier`/`rules` 字段，这些字段不会被读取、执行或写回。 |
| P6 | Provider 插件 Host、Registry、市场和隔离 | `packages/gateway/src/plugin`, Electron plugin manager, `apps/desktop/resources/native/windows/PluginSandboxLauncher.cpp` | crash/timeout/backpressure/security tests | complete | Provider Plugin 已具备 RPC Provider Adapter、`PluginRuntimeManager` 和持久化 `ProviderPluginManager`：安装版本保存 manifest，启动扫描可激活 Provider，失败插件隔离，支持模型/Quota/登录/签名、安全停用、回滚和 Host 关闭；Host 增加单插件并发、跨插件共享全局并发闸门、在途字节预算、stdin drain 串行背压、超时取消、关闭队列拒绝和 stderr 脱敏日志；新增挂起 Provider 不阻塞健康 Provider 的 Runtime 回归；真实 JSONL 子进程往返及真实子进程 Provider Runtime 激活测试通过。桌面主进程和 HTTP Gateway Service 均接入持久化插件运行时，桌面 IPC/设置页支持安装、停用、回滚、删除，插件 Provider 可参与模型发现、Provider Catalog 投影、显式模型路由和自定义认证头；现在设置页也支持加载缓存市场、按显式 URL 刷新和按条目声明的 local/npm/git 源安装，签名条目在未配置受信校验器时 fail-closed；Gateway 全量 79/79，插件市场/Manager 回归 9/9（成功 npm/git 安装路径已覆盖），Desktop 构建与市场/桥接/设置定向回归通过。市场缓存/active 指针使用原子写入，失败升级不会删除当前活动版本；已补充严格 SemVer 版本目录校验、每版本目录 checksum sidecar，以及重新激活和回滚前的完整目录完整性校验，篡改文件会 fail-closed；macOS 使用 sandbox-exec、Linux 使用 bubblewrap，Linux 打包 workflow 会显式安装并验证 `bwrap`；Windows 已加入 AppContainer 启动器源码、MSVC 构建路径、资源自动发现、Node 运行目录 ACL 和 network/filesystem 能力映射；无可用启动器时 required 模式仍拒绝启动。macOS 本机 POSIX sandbox smoke、GitHub Ubuntu bubblewrap smoke、GitHub Windows AppContainer helper/文件网络隔离 smoke、sandbox policy tests 均通过；CI 运行 `37564551997` 的全部任务通过，P6 平台隔离证据闭环。 |
| P7 | Usage/Quota/Cost/Trace 和完整 UI | `packages/gateway/src/usage`, `apps/desktop/src/pages`, `apps/desktop/electron/gateway-model-discovery.ts`, `scripts/node-cli.ts` | ledger/quota/UI/trace/discovery tests | complete | 用量账本、费用/Quota、请求详情、`/admin/trace` JSONL 查询、Manager/IPC Bridge、用量页 Trace 面板和设置页 Gateway 运营快照均已完成；账本同时持久化逻辑/服务模型、Provider/Credential/Account、Agent、入口/上游协议、TTFT、Retry-After、最终候选、失败类型、RouteGroup 和显式 Rule ID，不保存 Prompt；运营侧提供 Provider/Credential/Model/RouteGroup/显式元数据规则/Agent 结构化编辑和高级 JSON 入口，保存前由 Core schema 校验，运行中按显式模型绑定同步实际模型路由，意图字段会被剔除；结构化编辑支持 Credential 模型白名单、非敏感请求 Header 和显式代理 URL，路由转发始终保护 Authorization 等敏感 Header；CLI 和桌面均可通过现有 Credential 安全引用调用 Provider Adapter 自动发现模型，回写 Gateway Catalog、同步 Codex App 模型目录并刷新运行中 Gateway，Agent 保存会真实更新配置文件并显示 Drift 状态，测试覆盖密钥不泄露。Desktop 默认套件 388/389（1 个需显式启用 Codex 的 E2E skip），启用已安装 Codex 后兼容层 E2E 1/1，合计 389/389；CLI discovery/import tests 通过。 |
| P8 | CLI/TUI/Profile/托盘/自动更新 | `scripts`, `apps/desktop`, `packages/core` | command/TUI/update/restore tests | complete | CLI domain commands、manual/gateway mode、profile、TUI、真实 `gateway start/serve/stop` 生命周期已通过测试；Gateway TUI 页面现在展示 Provider/Credential/Model/RouteGroup/Agent/Profile 以及今日 Usage 请求/Token/费用状态，并可在界面切换手动/Gateway 模式和启动/停止本地 Gateway；CLI Gateway 启动现在同时传递显式 Catalog model bindings、RouteGroup 和 metadata `routeRules`，并验证停止后恢复手动 URL；Profile 保存使用原子替换且使用前校验 schema；桌面已接入托盘常驻、手动切换/Gateway 状态展示、macOS/Windows 登录启动持久化开关、可配置更新源、检查/下载/安装状态控制；设置页运行日志支持自动刷新；更新清单生成、Hash/签名校验、安装前 rollback journal 和健康启动清理均有自动化覆盖。未签名发布按当前产品决策交付，签名证书不作为前置条件。`npm run desktop:test` 390 passed/1 skipped，Node CLI、TUI、路由服务和更新回归通过。 |
| P9 | 迁移、导入、恢复和三平台发布 | migration, package/build/release | migration/rollback/package tests | complete | v1/v2 migration、legacy 双写/降级读取/清理、通用 Gateway/第三方 Agent 的 dry-run、脱敏导入和失败恢复写入已实现并通过 Core/CLI 测试；Agent 支持本地/WSL/Windows 路径风格、远程 SSH 文件系统和原子恢复；Profile、Gateway marker、账号 auth、Token refresh 和 Agent snapshot 均使用安全原子写入；升级回滚恢复使用完整安装目标并通过 macOS arm64 本机和三平台 CI 安装 smoke；macOS arm64/x64、Windows NSIS、Linux AppImage/deb 的未签名产物构建和校验通过；标签 `desktop-v0.1.34` 自动发布已成功。签名、公证、真实 Intel Mac 安装由使用者自行验证。 |
| P10 | 全量测试和最终工程验收 | project-wide | all in-repository acceptance matrix | complete | Core 157/157、Gateway 79/79、Desktop 390 passed/1 skipped（唯一 skip 为需安装外部 Codex 的 E2E）、根级脚本 34/34、legacy-bash 1/1、Core/Gateway/Desktop build、类型检查、lint 和 diff check 均通过；macOS/Windows/Linux CI 沙箱、测试、打包、安装 smoke 和完整安装目标回滚 smoke 均有当前提交证据；真实第三方 Provider、Intel Mac 和签名/公证不属于本次工程交付门槛，由使用者自行验证。 |

## Rules

- 同时只能有一个 `in_progress`。
- 每完成一个阶段，必须先写入验证证据，再进入下一阶段。
- 任何计划内能力不得以“非阻塞”方式跳过。
- 生产代码改动前，先更新本文件的切片和文件范围。
- 手动模式必须始终可用；Gateway 新功能不得破坏旧账号切换。
- 不记录明文 Token、API Key、OAuth 返回值或完整 Prompt。
- 真实 Provider 密钥只允许通过本地手工/受控集成测试注入，不进入仓库和 CI。
- Current P1 slice: make the Node Agent filesystem write configuration and snapshot files with same-directory atomic replacement and no temporary-file residue; this slice does not add Prompt analysis or intent routing.
- Current P9 slice: encode Agent snapshot filenames for Windows-safe environment/agent binding IDs while retaining legacy snapshot lookup for migration compatibility; this slice does not add Prompt analysis or intent routing.
- Current P9 slice: make manual unsigned macOS/Windows packaging omit empty signing inputs and make Linux artifact verification resolve paths from the workspace package cwd; tag builds retain mandatory signing credential gates.
- Current P8/P9 slice: pin the update-manifest verifier to the release public key so a manifest cannot replace its own trust root; tag release verification must pass the trusted public key explicitly.
- Current P8 slice: make a configured desktop update feed require a signed manifest by default; unsigned feeds remain available only through an explicit test/development override.
- Current P8 slice: route Gateway/provider/agent/group/model/usage/profile domain commands from the cross-platform launcher to the Node CLI on macOS/Linux, while preserving the legacy Bash manual env/account commands.
- Current P9/P10 slice: add a runner-side package-install smoke that extracts macOS/Linux installers and silently installs the Windows NSIS package into an isolated directory, then uploads redacted install evidence.
- Current P9 slice: run the existing atomic rollback implementation against the full installation target materialized by each package-install smoke (macOS app bundle, Windows/Linux install tree), simulating a corrupt upgrade and verifying byte-for-byte restoration of the executable probe.
- Current P10 slice: add a Gateway lifecycle regression for simultaneous requests from multiple explicit Agent IDs, including fallback dispatch and per-Agent usage records; this slice does not add Prompt analysis or intent routing.
- Current P6 slice: expose the existing signed/fail-closed Provider Plugin Market through the desktop bridge and Operations UI, including cached entries, explicit refresh, and market-entry installation; this slice does not add Prompt analysis or intent routing.
- Current P8/P9 slice: make update rollback staging names collision-safe under concurrent checks and preserve the existing fail-closed manifest/hash verification; this slice does not add Prompt analysis or intent routing.
- Current P6/P10 slice: validate emitted macOS/Linux/Windows sandbox evidence JSON before it is uploaded by CI/package workflows; this slice does not add Prompt analysis or intent routing.
- Current P9 slice: add a path-confined remote Agent filesystem with an SSH transport, preserving atomic remote writes, snapshot recovery, and drift checks for the existing adapters; this slice does not add Prompt analysis or intent routing.
- Current P1/P7 slice: make desktop Gateway Agent bindings materialize, restore, and report Drift through the existing Agent adapters instead of persisting metadata only; this slice does not add Prompt analysis or intent routing.
- Current P7 audit slice: complete privacy-safe Usage completion fields by hashing the explicit session identifier and accepting an optional first-byte timestamp, and make CLI usage read the persistent Router ledger before the legacy JSON fallback; this slice does not add Prompt analysis or intent routing.
- Current P10 audit slice: remove host-specific absolute repository paths from cross-platform tests so Linux/Windows CI validates the current checkout; this slice does not add Prompt analysis or intent routing.
- Current P6/P10 CI portability slice: run Core/Gateway/Desktop recursive TypeScript tests through the tsx CLI entrypoint so Windows receives valid module URLs; build the Windows native helper through `ComSpec` with verbatim arguments; install an explicit Ubuntu AppArmor profile for bubblewrap user namespaces before Linux sandbox smoke; this slice does not add Prompt analysis or intent routing.
- Current P10 cross-platform runner slice: replace Unix-only `find`/shell test discovery for Core and Gateway with Node recursive runners, so Windows/Linux CI executes the same complete test set; this slice does not add Prompt analysis or intent routing.
- Current P2/P4 runtime slice: enable explicit protocol conversion in desktop Gateway route selection when the ingress Gateway opts into the existing 4-protocol conversion chain; direct route callers keep exact-protocol matching by default and credential-pool protocol constraints remain explicit; this slice does not add Prompt analysis or intent routing.
- Current P4 runtime metrics slice: feed bounded per-Gateway route request/token/latency counters into the shared `usage`, `pace`, and `smart` strategies, with explicit window expiry and no prompt inspection; this slice does not add Prompt analysis or intent routing.
- Completed P4 explicit-rule slice: request metadata rules for token count, images, reasoning, agent, context compaction, time, model and provider are implemented in the shared engine, Desktop Gateway, persistence, admin editor and local compatibility fallback; rules never inspect Prompt text, classify intent, or select from intent labels.
- Current P3/P10 slice: exercise Provider Adapter discovery, quota, refresh and revoke through a real local HTTP protocol-compatible service using the same `ProviderHttpClient` boundary; this provides transport-level evidence without requiring third-party credentials and does not add Prompt analysis or intent routing.
- Completed P3 slice: explicit Credential model allowlists and non-secret Provider/Credential request headers now persist through the Gateway contract, import/schema validation, Provider Adapter discovery, Desktop discovery, runtime RouteTarget materialization and upstream forwarding; selection remains model/metadata based and does not add Prompt analysis or intent routing.
- Current P3 slice: add explicit Provider/Credential/Route proxy endpoints with safe URL validation, discovery/runtime forwarding, SQLite persistence, CLI support and UI editing; proxy selection remains attached to the selected explicit account/model route and never inspects Prompt or selects by intent.
- Completed P3 proxy slice: Provider/Credential proxy URLs now import and validate without embedded credentials, Credential overrides Provider, Desktop and CLI discovery pass proxy context, RouteTarget/SQLite persist the selected proxy, native/compatibility/pool forwarding uses `ProxyAgent`, and the Operations editor exposes the two configuration levels; real local HTTP proxy tunnel and invalid-URL rejection are covered.
- Current P6 Windows helper slice: use the documented `DeriveAppContainerSidFromAppContainerName` contract via fail-closed `userenv.dll` lookup, release returned profile SIDs with `FreeSid`, and verify the launcher with a MinGW PE cross-build; this does not add Prompt analysis or intent routing.
- Current P6/P10 CI slice: add a reproducible Ubuntu MinGW cross-build gate for the Windows AppContainer helper, while keeping native Windows AppContainer smoke as the authoritative runtime gate; this does not add Prompt analysis or intent routing.
- Current P6 Windows smoke slice: exercise both the default-deny AppContainer and the explicit filesystem capability, proving only the plugin directory becomes writable while Home reads and network remain denied; this does not add Prompt analysis or intent routing.
- Current P9/P10 handoff slice: extend the Windows manual checklist and result template with AppContainer capability evidence, packaged-helper verification, release-signature checks, and upgrade rollback capture; this does not add Prompt analysis or intent routing.

## Latest Verification (2026-10-07)

- Desktop 运行日志闭环：设置页现在展示当前选择的运行日志，并每 1.5 秒自动刷新；手动读取和自动刷新共用同一 Bridge 读取路径，新增页面契约测试 6/6，`npm run desktop:build` 通过（Vite 2486 modules），`npm run desktop:test` 通过 388/389（1 项显式 Codex E2E skip）。README 已移除“日志流未实现”的过期说明。
- 最新内容门禁复核：`npm run lint`、`git diff --check`、工作树源文件扫描和 `apps/desktop/release` 二进制扫描均通过；本轮新增 UI 代码、测试和追踪文档仍保持无外部品牌文案。
- macOS 双架构产物已包含日志 UI：重新执行 `npm run desktop:package:mac:dir`，x64/arm64 `.app` 均重新生成并通过 `package:verify`；主程序仍分别为 `Mach-O x86_64` 与 `Mach-O arm64`，发布目录扫描通过。当前仅为本地 ad-hoc 签名，未伪造 Developer ID/公证证据。
- 本轮最终根级回归：`npm test` 通过 Core 157/157、Gateway 79/79、脚本/工作流 33/33、legacy-bash 1/1；新增日志展示、提交内容门禁、双架构产物和路由边界均保持通过。
- macOS 双架构与提交内容清理验收：x64/arm64 `.app` 重新构建，主程序分别为 `Mach-O x86_64` 与 `Mach-O arm64`，两者均通过 `package:verify`；Desktop 默认 387/388、已安装 Codex E2E 1/1；Core 157/157、Gateway 79/79、脚本/工作流 32/32、legacy-bash 1/1；源文件、变更文件、生成的 macOS release 内容均未包含外部项目名称，`git diff --check` 通过。
- Provider Plugin Market 成功路径回归：新增受控 npm tarball 与 git source 安装测试，实际覆盖解包/clone、Manifest 校验、目录 checksum、active pointer 与版本列表；`npm run gateway:test` 通过 79/79，仍只支持显式 Provider/模型/路由选择，不读取 Prompt、不提供意图路由。
- 最新项目级验收：`npm test` 通过 Core 157/157、Gateway 79/79、脚本/工作流 32/32、legacy-bash 1/1；`git diff --check` 通过，路由运行时意图审计为 0 个匹配。Linux Docker/bubblewrap 证据已通过 verifier，但不替代 GitHub Ubuntu runner 与 Windows 真机证据。
- 最新 Desktop 验收：`npm run desktop:test` 通过 387/388（唯一 skip 为显式 Codex E2E）；`npm run test:compat:e2e --workspace ./apps/desktop` 在已安装 Codex 环境通过 1/1，Desktop 合计 388/388；兼容 E2E 使用临时 `CODEX_HOME`、本地 Gateway 和本地假 Provider，不接触真实用户配置或第三方凭证。
- 最新 Desktop 构建复核：`npm run desktop:build` 通过（Vite 2486 modules），`npm run lint` 通过；当前 GitHub Actions 可见结果仍来自旧提交，未被用作当前工作树的跨平台证据。
- 最新本机构建产物复核：macOS x64/arm64 `.app`、Linux AppImage/deb 和 Windows NSIS 交叉产物均重新生成并通过 `package:verify`；macOS 因无 Developer ID 证书仍为本地 ad-hoc/未公证产物，Windows 交叉产物不包含只能在 Windows 编译的 AppContainer helper，因此两者仍不替代对应平台的签名与真机验收。
- Windows handoff coverage: the manual checklist and generated result template now include AppContainer default-deny/filesystem-capability evidence, packaged helper/Authenticode verification, upgrade dry-run, and failed-boot rollback capture; the three related contract tests pass and `git diff --check` is clean.
- macOS release artifact regression: `npm run desktop:package:mac:dir` regenerated x64 and arm64 directory apps; both `npm run package:verify --workspace apps/desktop -- ...` checks passed and local codesign verification passed. Developer ID signing/notarization was explicitly skipped because no valid Developer ID identity is installed, so this is artifact evidence only.
- Root acceptance after the Windows smoke evidence update: `npm test` passed Core 157/157, Gateway 78/78, scripts/workflows 31/31 and legacy-bash 1/1; all newly added evidence checks passed and no intent-routing runtime path was introduced.
- Desktop regression after Windows smoke evidence changes: `npm run desktop:test` passed 387/388 with the single externally-gated Codex E2E skipped; `npm run desktop:build` passed with 2486 Vite modules, Electron typecheck passed, and `npm run lint` passed.
- Sandbox regression after the Windows capability-evidence change: Gateway 78/78 passed; macOS `posix-plugin-sandbox-smoke.mjs` emitted write/read/network denial evidence and `verify-sandbox-evidence.mjs` accepted it; `git diff --check` passed.
- CI gate change regression: `npm run test:cross-platform` completed after adding the Ubuntu MinGW step with Core 157/157, Gateway 78/78 and scripts/workflows 31/31; no intent-routing path was added.
- Windows smoke contract: the smoke runner now executes a default-deny AppContainer and a separate `--filesystem` capability run; evidence requires `filesystemWriteGranted=true` for Windows while still requiring Home-read and network denial. The verifier tests pass 3/3; actual execution remains a Windows-runner requirement.
- CI cross-build gate: `.github/workflows/ci.yml` now installs `g++-mingw-w64-x86-64` on Ubuntu and compiles the Windows helper to a PE with an `MZ` check before Linux sandbox smoke; `scripts/ci-workflow.test.ts` passes 1/1. Native Windows execution remains a separate required gate.
- Windows helper cross-build: an isolated Linux ARM64 Docker toolchain compiled `PluginSandboxLauncher.cpp` into a PE32+ x86-64 executable with a valid `MZ` header after switching to the documented AppContainer SID API (`userenv.dll`) and capability SID API (`KernelBase.dll`) with fail-closed dynamic lookup; the builder contract test and packaging workflow contract test both pass (1/1 each). This is compile/PE evidence only; Windows AppContainer execution and smoke evidence still require `windows-latest` or a real Windows machine.
- 最新跨平台命令集回归：`npm run test:cross-platform` 通过 Core 157/157、Gateway 78/78、脚本/工作流 31/31，0 failed；`npm run test:desktop-package-workflow` 通过 1/1。显式模型名/元数据路由测试通过，仍不读取 Prompt、不调用 classifier、不提供意图路由。
- Fresh macOS sandbox evidence after the current build: `node scripts/posix-plugin-sandbox-smoke.mjs` emitted `writeDenied=true`, `readDenied=true`, `networkDenied=true`; `verify-sandbox-evidence.mjs` accepted `.wxt/evidence/macos-sandbox.json`. Linux/Windows evidence is still intentionally not claimed without their real runners.
- Current root acceptance after reasoning-token work: `npm test` passed Core 156/156, Gateway 78/78, script/workflow 30/30 and legacy-bash 1/1; Desktop full regression remains 388 tests (387 passed/1 skipped), Desktop build and Electron/Web typechecks passed. No-intent runtime audit and `git diff --check` remain clean.
- Usage Ledger reasoning-token slice completed: desktop Responses/Chat/Gemini usage extraction now retains `reasoningTokens`; SQLite migration, aggregate/request detail persistence, actual/standard pricing, historical repricing and Usage UI/price editor all support an explicit reasoning rate with output-rate fallback for legacy profiles. Electron/Web typecheck, focused 12/12 Usage tests, Desktop full 388 tests (387 passed/1 skipped), Desktop build (Vite 2486 modules) and `git diff --check` passed. No Prompt text or semantic intent is inspected.
- Usage Ledger telemetry slice completed: `UsageRequest`/SQLite now persist logical and served model, Provider/Credential/Account route identity, Agent, ingress/upstream protocol, RouteGroup, explicit Rule ID, TTFT/first-byte latency, Retry-After, final candidate, failure type and price tier; pool/direct/compatibility paths populate the same metadata and attempts remain redacted. `npx tsc --noEmit -p apps/desktop/tsconfig.electron.json` passed, focused model/store/router tests 36/36 passed, and Desktop full regression passed 388 tests (387 passed/1 skipped). No prompt text is stored or inspected for semantic intent routing.

- Ed25519 信任链后的完整运行回归：Gateway 78/78、Desktop 388 tests（387 passed/1 skipped），`git diff --check` 通过；Provider plugin signing、市场、显式模型路由、凭证池、手动模式和 Gateway 模式均保持通过。意图路由未实现。
- P6 Ed25519 信任链实现：新增 Provider manifest canonical signing payload 与 Ed25519 验签，签名同时绑定显式权限/能力声明和插件目录 checksum；桌面 Provider Plugin Runtime/Market 从 `CODEX_SWITCHER_PLUGIN_TRUSTED_PUBLIC_KEY` 注入受信公钥，没有公钥时仍 fail-closed。Signing/Market/Manager 定向 11/11、Gateway build、Desktop Electron typecheck 和 `git diff --check` 通过；不读取 Prompt、不做意图分类或意图路由。
- 签名插件复核后的根级回归：`npm test` 通过 Core 156/156、Gateway 77/77、脚本/工作流 30/30、legacy-bash 1/1；新增签名插件重启激活拒绝测试实际执行通过。意图路由仍为明确排除项。
- P6 信任链回归：已安装的签名 Provider 插件在启动重新激活、安装后激活和回滚后激活时统一重新执行信任校验；缺少校验器或校验失败都会拒绝激活。Market/Manager 定向回归 10/10、Gateway build 和 `git diff --check` 通过；不读取 Prompt、不做意图分类或意图路由。
- 本轮桌面闭环回归：`npm test` 通过 Core 156/156、Gateway 76/76、脚本/工作流 30/30、legacy-bash 1/1；`npm run desktop:build`（Vite 2486 modules）通过，`npm run desktop:test -- --test-concurrency=1` 通过 388 tests（387 passed/1 skipped），`git diff --check` 通过；关键路由运行目录意图路由关键词审计为 0。
- 本轮 Gateway 全量复核：Core 156/156、Gateway 76/76、cross-platform 命令集 30/30、legacy-bash 1/1；新增插件目录完整性校验和安全 SemVer 回归已纳入全套验证。P6 仍只剩 Linux/Windows 真机隔离证据和正式发布证据，不涉及意图路由。
- P6 插件完整性回归：插件 manifest 版本现在严格限制为安全 SemVer，安装时为每个版本保存 manifest 与目录 checksum sidecar；重新激活会校验活动版本的 manifest 和完整目录，回滚会校验旧版本的 manifest 和完整目录，篡改任意文件都会 fail-closed。插件 Market/Manager 定向回归 9/9、Gateway 全量 76/76、`npm run gateway:build` 和 `git diff --check` 通过；不读取 Prompt、不做意图分类或意图路由。

- 发布清单校验收口：`create-update-manifest.mjs` 与 `verify-update-manifest.mjs` 现在在签名/Hash 前后都 fail-closed 校验语义版本、频道、平台 ID、HTTP(S) artifact URL、SHA-256 和发布时间；格式错误清单不会进入发布验证。`update-release-manifest.test.ts` 2/2、Node syntax check、`git diff --check` 通过；不读取 Prompt、不做意图分类或意图路由。
- 自动更新运行时校验收口：`verifyUpdateManifest` 与签名验证入口现在也先拒绝格式错误的 manifest，避免绕过主进程读取路径直接调用校验器时接受非法元数据；`auto-update.test.ts` 9/9、Electron typecheck、`git diff --check` 通过。
- 更新后桌面全量回归：`npm run desktop:test` 通过 388 tests（387 passed/1 skipped，唯一 skip 为显式要求外部 Codex 安装的 E2E）；凭证池文案、自动更新清单校验和手动/Gateway 路由回归均通过。
- Windows 发布验收加固：打包 workflow 在 installer 校验前验证 `win-unpacked/resources/native/windows/codex-switcher-plugin-sandbox.exe` 已被复制且具有 PE `MZ` 头；CI/发布 workflow contract tests 2/2、`git diff --check` 通过。真实 Windows runner 仍需执行该步骤并产出 AppContainer smoke 证据；不读取 Prompt、不做意图分类或意图路由。
- 最新根级验收：`npm test` 通过 Core 156/156、Gateway 75/75、脚本/工作流命令集 30/30、legacy-bash 1/1；macOS sandbox evidence verifier 通过。Linux/Windows 真机隔离与正式发布证据仍待对应 runner。
- 远程 CI 稳定性修复：读取历史 GitHub Actions 失败日志确认跨平台脚本测试曾因并发修改全局 `process.env` 导致 `spawn npx/bash/node ENOENT`；`test:cross-platform` 现对脚本测试显式使用 `tsx --test --test-concurrency=1`，当前本地跨平台回归 30/30 通过。此修复不读取 Prompt、不做意图分类或意图路由。
- 串行入口修复后的最终本地回归：Core 156/156、Gateway 75/75、脚本/工作流 30/30、legacy-bash 1/1、`git diff --check` 通过；运行时意图路由关键目录审计仍为 0 个匹配。
- 凭证池产品命名收口：桌面环境页、操作反馈和用量请求筛选统一使用“凭证池 / Credential pool”面向用户展示；内部 `AccountPool` 类型、SQLite 表名和迁移兼容标识保持不变。该 UI 调整不读取 Prompt、不做意图分类或意图路由。
- 当前工作树三平台交叉产物复核：重新生成并通过 `package:verify` 的 macOS x64/arm64 directory app、Linux AppImage/deb、Windows x64 NSIS installer；macOS 构建明确记录因无有效 Developer ID 证书而跳过发布签名，Windows/Linux 仍不等同于真机运行、AppContainer/bwrap smoke 或正式签名证据。
- 根级跨平台回归：`npm test` 通过 Core 156/156、Gateway 75/75、cross-platform command set 29/29、legacy-bash 1/1；Core/Gateway 测试均由 Node 递归入口执行，不再依赖 Unix `find`/命令替换。此变更不读取 Prompt、不做意图分类或意图路由。
- Cross-platform test runner hardening：Core/Gateway workspace tests now use Node recursive discovery and serial execution instead of shell glob/`$(find ...)` expansion；`npm run core:test` 156/156、`npm run gateway:test` 75/75、package script contract 1/1、`git diff --check` 通过，Windows/Linux CI 不再依赖 Unix `find`。路由仍不读取 Prompt、不做意图分类或意图路由。
- Provider 插件回滚 fail-closed 回归：回滚前先验证上一版本目录、Manifest 和完整目录校验和；旧版本缺失/损坏时保持当前活动版本不变。插件市场/Manager 定向 8/8、Gateway 全量 75/75、Gateway typecheck 和 `git diff --check` 通过；未读取 Prompt、不做意图分类或意图路由。
- 兼容上游 Header 边界回归：Chat upstream client 恢复默认 Header 白名单；只有兼容处理器在已应用显式 Route 配置后才打开非敏感自定义 Header 转发，`Authorization/Cookie/Host/Content-Length/Connection` 等仍强制屏蔽。完整桌面 Electron/Web 回归（含全部兼容测试）387 passed/1 skipped，`upstream-client` 定向 2/2 通过；未引入 Prompt 分析、意图分类或意图路由。
- 发布/隔离安全审计增量：自动更新在 `requireSignedManifest` 开启但清单缺失时现在 fail-closed，不会调用更新器；更新清单现在还要求版本、平台、频道、URL、64 位 SHA-256 和发布时间字段完整有效；升级失败恢复旧安装后，主进程现在会退出并重新启动恢复后的版本，避免继续运行已加载的新版本模块；`auto-update.test.ts` 9/9 通过。Windows AppContainer ACL 清理改为只撤销当前插件自己的 SID ACE，并为每个 grant 保存独立 SID 副本，避免并发插件退出时恢复整份 DACL 或使用已释放 SID；Windows native source contract、Electron typecheck、`git diff --check` 通过。此变更不读取 Prompt、不做意图分类或意图路由。
- 本轮最终本地验证：Core/Gateway/跨平台/legacy 全量 `npm test` 通过（Core 156/156、Gateway 74/74、命令集 29/29、legacy 1/1）；桌面全量显式串行回归 387 passed/1 skipped，`npm run desktop:build`（Vite 2486 modules）、Electron/Web typecheck、`npm run lint`、`git diff --check` 通过；macOS sandbox smoke 与 evidence verifier 均通过（write/read/network denied）。
- 桌面验收入口补齐：`apps/desktop/scripts/run-tests.mjs` 递归发现 `electron/` 与 `src/` 下全部 `*.test.ts`，跨平台调用 Node test runner 并固定串行度 1；`npm run desktop:test` 现在直接执行完整 388 tests（387 passed/1 skipped），不会再因维护显式文件列表漏掉兼容层、账号池或新增阶段测试。
- 无意图路由最终运行时审计：共享 Route Engine、Desktop model/router/service 的关键运行目录不包含 Prompt/semantic/classifier/intent route 选择路径；显式模型/元数据规则回归 7/7 通过，运行时关键词审计为 0 个匹配。
- 升级回滚集成回归：自动更新控制器现在有完整测试覆盖“下载完成 → 备份当前安装 → 写入新版本 → 首次失败启动 armed → 第二次启动恢复旧安装并清理 journal”，`auto-update.test.ts` 7/7 通过；该证据覆盖本地恢复逻辑，不替代真实 macOS/Windows/Linux 安装器运行证据。
- Provider/Credential/Route proxy slice：Core/Gateway/Desktop typecheck 通过；Provider 真实本地 HTTP 生命周期、Desktop discovery、SQLite migration、Route manager、native Gateway HTTP proxy tunnel 和 invalid proxy rejection 定向回归通过；项目级 `npm test` 通过 Core 156/156、Gateway 74/74、cross-platform 29/29、legacy-bash 1/1，Node CLI 94 passed/1 skipped，Desktop 330/330；`npm run desktop:build`（Vite 2486 modules）、`npm run lint`、`git diff --check` 通过。代理只绑定显式 Provider/Credential/Route，不分析 Prompt、不做意图分类、不执行意图路由。

- Provider/Credential policy slice：Gateway schema/import 会保留安全的 `requestHeaders` 和 Credential `modelIds`，拒绝 authorization/cookie 等敏感 Header；Desktop discovery 合并 Provider/Credential Header 并按 Credential allowlist 过滤模型；运行时 RouteTarget/SQLite/显式 Gateway binding 会持久化并转发非敏感 Header，同时始终由路由器覆盖真实 Authorization。定向回归 54/54，Core/Gateway/Desktop Electron typecheck 和 `git diff --check` 通过；无 Prompt 分析、意图分类或意图路由。
- 最新 Desktop 完整回归：`npm run desktop:test -- --test-concurrency=1` 通过 Desktop 330/330，随后 `npm run desktop:build` 通过（Vite 2486 modules）；`npm run lint` 与 `git diff --check` 通过。新增 Provider/Credential 模型白名单、非敏感请求 Header 和显式代理能力只按显式模型/服务商/账号元数据工作，不读取 Prompt、不做意图分类、不执行意图路由。
- 当前工作树发布产物复核：`npm run desktop:package:mac:dir` 重新生成 macOS x64/arm64 directory app，两个当前产物均通过 `package:verify` 和本机 codesign 结构校验；Developer ID 签名/公证仍因当前机器没有有效证书而未执行，不能替代 release-run 证据。
- 当前工作树跨平台 artifact 复核：重新执行 `npm run desktop:package:win` 与 `npm run desktop:package:linux`，Windows NSIS、Linux AppImage 和 Linux deb 均完成构建并通过 `package:verify`；这些仍是 macOS 交叉构建/静态产物证据，不替代 Windows/Linux 真机运行、AppContainer/bwrap smoke、签名或升级回滚证据。
- Gateway Provider/Credential policy 的 UI 回归：Operations 结构化编辑器增加模型白名单和请求 Header JSON 字段，Core schema 仍负责最终校验；Desktop Web typecheck、Operations/Bridge 定向测试 7/7 通过，未增加意图路由字段。
- Provider 本地传输层回归：`packages/gateway/src/provider/adapters.test.ts` 通过真实 `node:http` 服务和 `fetch` 客户端跑通模型发现、Quota、OAuth refresh、revoke，并断言鉴权头、请求路径和表单体；Provider 定向测试 6/6、Gateway typecheck、`git diff --check` 通过。该验证不使用第三方密钥、不分析 Prompt、不做意图分类或意图路由。
- Provider 传输切片后的项目回归：`npm run gateway:test` 通过 Gateway 74/74；`npm test` 通过 Core 155/155、Gateway 74/74、cross-platform 命令集 29/29、legacy-bash 1/1；`npm run desktop:test -- --test-concurrency=1` 通过 Desktop 327/327；Gateway build 与 `git diff --check` 通过。
- Provider 切片后的构建复核：`npm run desktop:build` 通过（Vite 2486 modules），Core/Gateway/Desktop Electron/Web typecheck、`npm run lint` 与 `git diff --check` 通过；macOS POSIX sandbox smoke 输出 `writeDenied/readDenied/networkDenied=true`。这些仍不替代 Linux/Windows 真机隔离和签名证据。
- Desktop Agent 集成后的完整本地回归：`npm test` 通过 Core 155/155、Gateway 73/73、cross-platform 命令集 29/29 和 legacy-bash 1/1；`npm run desktop:test -- --test-concurrency=1` 通过 327/327；`npm run desktop:build`、Electron/Web typecheck、`npm run lint` 和 `git diff --check` 通过。仍未加入 Prompt 分析、意图分类或意图路由。
- Desktop Agent binding 集成切片：Gateway 配置保存现在会真实 apply 启用的 Agent binding，删除/禁用时 restore 原始文件，重复 apply 保留最初快照，运营视图显示 Clean/Drifted/Missing/Unwired；桥接真实文件回归通过，Desktop 全量 327/327，Electron/Web typecheck 通过。该链路只使用显式 model/RouteGroup 和 Agent profile，不分析 Prompt、不做意图分类或意图路由。
- 远程 Agent 路径处理切片：新增 path-confined `createRemoteAgentFileSystem` 和 SSH POSIX `createSshAgentFileSystem`，所有路径先经过 root/additional-root 校验，SSH 脚本只接收 Base64 编码的路径与内容，远端写入先落同目录临时文件再 rename；远程配置的 apply/restore/check/Drift 与 44 个既有 Adapter 共用同一实现。Gateway 73/73、Gateway typecheck 和 `git diff --check` 通过；未新增 Prompt 分析、意图分类或意图路由。
- 本轮最终本地回归：`npm test` 全部通过（Core 155/155、Gateway 72/72、cross-platform 命令集 29/29、legacy-bash 1/1）；`npm run desktop:test -- --test-concurrency=1` 通过 326/326，`npm run desktop:build`、Electron/Web typecheck、`npm run lint` 和 `git diff --check` 通过。新增 sandbox evidence verifier 的接受/拒绝测试 2/2，macOS sandbox smoke 输出的脱敏证据已通过 `verify-sandbox-evidence.mjs`；CI 与三平台打包 workflow 均在上传前执行 fail-closed 校验。路由仍只使用显式模型/RouteGroup/协议/能力/健康度/配额/策略和受控请求元数据，未加入 Prompt 分析、意图分类或意图路由。
- 本轮完整回归：`npm test` 通过 Core 155/155、Gateway 70/70、cross-platform 121 passed/1 skipped（122 tests）和 legacy-bash 1/1；Provider 插件市场/桌面定向回归 8/8，Desktop 全量 325/325，Desktop build、Electron/Web typecheck、lint 和 `git diff --check` 通过。所有路由仍只接受显式模型/RouteGroup/协议/能力/健康度/配额/策略和受控请求元数据，未加入 Prompt 分析或意图路由。
- 当前工作树项目级回归：`npm test` 通过 Core 154/154、Gateway 67/67、cross-platform 120 passed/1 skipped（121 tests）和 legacy-bash 1/1；未实现 Prompt/意图路由，跳过项仍为当前 Codex App 环境下的 lifecycle-sensitive 测试。
- StateStore 原子写入后的最新项目级回归：`npm test` 再次通过 Core 154/154、Gateway 67/67、cross-platform 120 passed/1 skipped（121 tests）和 legacy-bash 1/1；`npm run desktop:build` 与 `npm run desktop:test` 也通过，Desktop 323/323。
- 嵌套 RouteGroup 与 `weight` 别名后的最新项目级回归：`npm test` 通过 Core 155/155、Gateway 67/67、cross-platform 121 passed/1 skipped（122 tests）和 legacy-bash 1/1；`npm run desktop:build` 与 `npm run desktop:test` 通过，Desktop 324/324。
- 当前构建产物与 macOS 隔离复核：`node scripts/posix-plugin-sandbox-smoke.mjs` 通过（write/read/network 均拒绝）；macOS arm64/x64 `.app`、Linux AppImage/deb、Windows NSIS `.exe` 五类产物再次通过 `package:verify`。这些仍是本机 artifact/sandbox 证据，不替代 Linux/Windows 真机执行或签名公证证据。
- CLI 命令契约补强：`scripts/node-cli.test.ts` 新增 Provider/Agent/Group+显式 capability rule/Model/Usage(today/7d/30d/all)/Profile 全生命周期，以及 Gateway routes/manual/gateway 切换覆盖；定向 Node CLI 回归 94 passed/1 skipped，未引入 Prompt/意图字段。
- `weight` 策略别名补齐：计划公开名称 `weight` 现在被 Core Gateway schema/import、共享 Route Engine、Desktop route model 和 CLI `group set --strategy weight` 接受，并与既有 `weighted_round_robin` 保持兼容；Route Engine 策略矩阵 7/7、Core 155/155、Gateway/Desktop build、Desktop 324/324 和 CLI 定向契约均通过。
- 嵌套 RouteGroup 导入与运行链路补齐：外部 Provider Gateway 的 `group/<id>` 成员不再被丢弃，Core 保留 `nestedGroupIds`；共享 Engine、Desktop resolver、CLI/桌面 Gateway 投影均递归展开并保留循环/最大深度保护。新增 Core import、Engine、Desktop nested-group 回归均通过，未新增 Prompt/意图路径。
- 三平台隔离证据链补齐：macOS/Linux POSIX 与 Windows AppContainer smoke 支持 `CODEX_SWITCHER_EVIDENCE_OUT`，输出不含凭证的 JSON 检查结果；CI 和 desktop-package workflow 会上传对应平台 evidence artifact。当前 macOS 本机证据 `.wxt/evidence/macos-sandbox.json` 通过，Linux/Windows 仍待对应 runner/真机实际运行后取得证据。
- Agent 配置导入补齐：新增 metadata-only `importAgentConfiguration` 和 CLI `agent import <agent> [--dry-run] [--account]`，覆盖 Codex TOML、Claude JSONC、OpenCode JSON；导入只产生 Provider/Model/RouteGroup/Agent binding 元数据，原始凭证永不写入 Gateway，既有账号只能通过显式 `--account` 受保护引用映射。定向 Agent import 3/3 与完整 Node CLI 94 passed/1 skipped 通过。
- Provider 插件市场桌面闭环补齐：新增缓存市场条目读取、HTTP(S) 显式刷新、签名条目 fail-closed、条目声明的 local/npm/git 安装源校验，以及 Operations 设置页的刷新/安装入口；Provider market/runtime 定向 8/8 通过，Desktop web/Electron typecheck 和构建通过。该能力只安装显式 Provider 插件，不分析 Prompt 或执行意图路由。

- 本次最终本地回归：`npm run desktop:test` 通过 322/322、`npm run gateway:test` 通过 66/66，`npm run lint` 和 `git diff --check` 通过；本轮补齐桌面设置文件同目录原子替换及无临时文件残留回归；此前同一工作树的 `npm test` 已通过 Core 153/153、cross-platform 120 passed/1 skipped（121 tests）和 legacy-bash 1/1。
- 最新全量验收：`npm test` 通过 Core 153/153、Gateway 66/66、cross-platform 120 passed/1 skipped（121 tests）和 legacy-bash 1/1；`npm run desktop:test` 322/322、`npm run desktop:build`、`npm run lint`、`git diff --check` 通过。跳过项仍是当前 Codex App 环境下的 lifecycle-sensitive 测试，不是产品功能失败。
- 产品边界复核：路由实现只使用显式模型/RouteGroup、协议、能力、健康度、配额、策略和受控请求元数据；Prompt 只可作为协议请求内容被转发/计量，绝不用于语义分析、意图分类、关键词匹配或自动选路；兼容导入/管理入口中的旧 intent/classifier 字段只会被拒绝或丢弃。
- Node CLI 原子写入回归：Gateway 启动 marker、账号 auth、Token refresh 更新、shell launcher/init block 均改用同目录临时文件 + rename；完整 `scripts/node-cli.test.ts` 通过 93/93（1 个既有 lifecycle-sensitive skip），Gateway 启动测试确认 marker 目录无临时残留。
- 本机打包复核：`package:verify` 重新通过 macOS arm64/x64 `.app`、Linux AppImage、Linux deb 和 Windows NSIS `.exe` 五类产物；这是产物结构/签名封装验证，不等同于 Windows/Linux 真机运行证据。
- 远端证据核对：GitHub Actions `desktop-package` run `35061662311` 的 Windows/macOS jobs 和 release job 成功，但基于旧提交 `fbfabdd515d5ab87db891861bd384ed865d18883`，不能替代当前工作树验证；同一旧提交的 `ci` run 因 legacy test 使用固定 `/Users/wangxt/myspace/codex-switcher` 路径而失败，当前工作树已改为 `process.cwd()`，本地 legacy/cross-platform 回归通过，待后续授权推送后重新获取三平台 CI 证据。
- 发布/兼容回归复核：`npm run test:legacy-bash` 1/1、`npm run test:desktop-package-workflow` 1/1 和 `git diff --check` 通过；旧 CI 的固定路径问题已在当前工作树修复，未把旧失败 run 误记为当前代码失败。
- CI 证据链增强：`.github/workflows/ci.yml` 新增 Windows/Linux Desktop 构建与测试矩阵；Ubuntu job 安装并验证 `bwrap` 后运行 Linux sandbox smoke，Windows job 校验并运行 AppContainer helper smoke，随后两者执行 `npm run desktop:test`。`scripts/ci-workflow.test.ts` 通过，待授权推送后可自动取得当前提交的跨平台 Desktop/P6 证据。
- 覆盖数量定向审计：Provider 注册表实际包含 22 个内置 Provider，Agent 适配器包含 44 个内置 profile；协议编解码覆盖四种协议，路由引擎覆盖嵌套组、能力/亲和性、fallback、usage/pace/smart 和显式模型规则。Provider、Agent、协议、插件 Provider 与路由引擎定向回归共 26/26 通过；规则只读取显式请求元数据，不读取 Prompt，不包含意图路由。
- Provider 覆盖契约加固：Provider 定向测试现在固定断言 22 个唯一内置 Provider，覆盖 API key、本地、OAuth、订阅认证、模型发现、刷新/撤销、签名和错误分类；`packages/gateway/src/provider/adapters.test.ts` 5/5 通过，`git diff --check` 通过。
- CI 工作流结构校验加固：`scripts/ci-workflow.test.ts` 现在解析 YAML 并断言 macOS/Windows/Linux matrix、非 macOS Desktop job、Ubuntu `bwrap` 条件和 Windows AppContainer helper 条件均实际挂在正确 job 下；CI 与打包 workflow 定向测试 2/2 通过，`git diff --check` 通过。
- 当前工作树跨平台命令集回归：`npm run test:cross-platform` 通过 120/120，1 个既有 lifecycle-sensitive 测试跳过（共 121）；其中 Core 153/153、Gateway 66/66，新增 Provider 数量契约和 CI YAML 结构断言均实际执行通过。
- 当前工作树 legacy 兼容回归：`npm run test:legacy-bash` 通过 1/1，`git diff --check` 通过。
- P6 桌面插件启动缺口已修复：`ProcessPluginTransport` 在 Electron 主进程中为 `process.execPath` 子进程注入 `ELECTRON_RUN_AS_NODE=1`，同时继续只传递最小环境，不继承宿主密钥；新增 Host 环境回归，插件 Host/Runtime 定向测试 15/15、`npm run gateway:build` 和 `git diff --check` 通过。
- P8/P9 原子持久化加固：Usage SQLite 快照、路由 Token、模型目录、会话历史、环境清理状态和升级回滚 journal 改用同目录 PID/UUID 临时文件，并在写入/rename 失败时清理残留，避免并发调用共享固定 `.tmp`；相关 Desktop/Core 定向回归 49/49、Electron typecheck 和 `git diff --check` 通过。
- Gateway 状态文件原子化：本地 Router 的 preferred-port/state JSON，以及升级 journal 的清空路径现在也使用同目录唯一临时文件 + rename；Router/Update 定向回归 41/41、`npm run desktop:build` 和 `git diff --check` 通过。
- 当前 Desktop 全量回归：`npm run desktop:test` 通过 323/323；覆盖 Gateway/Provider/Agent/Usage/Update/IPC/UI，且无意图路由约束测试仍通过。
- Router 原子状态回归补强：preferred-port 冲突/复用测试现在还检查服务退出后 state 目录没有 `.tmp` 残留；`usage-router-service.test.ts` 全部 18/18 通过。
- 最新 macOS 隔离/产物复核：`node scripts/posix-plugin-sandbox-smoke.mjs` 通过（write/read/network 均被拒绝）；当前 macOS arm64/x64 `.app`、Linux AppImage/deb、Windows NSIS `.exe` 五类 artifact 均通过 `package:verify`，仍不计作 Linux/Windows 真机运行或签名证据。
- Core 配置写入闭环：新增 `packages/core/src/system/atomic-file.ts`，target home 的 `config.toml`/`auth.json`、迁移备份、代理状态和 App PID/实例状态均改用同目录原子替换；新增原子写入无残留测试。Core 全量 154/154、Core build 和 `git diff --check` 通过；期间发现并修复 target-home preset 的 `dirname` 导入回归。
- Core 原子写入迁移后的桌面回归：`npm run desktop:build` 与 `npm run desktop:test` 均通过，Desktop 全量 323/323；此前一次组合命令中的子进程等待为瞬态，独立重跑已完成且无失败。
- Core StateStore 原子写入补齐：`save` 与 `writeRaw` 统一使用同目录唯一临时文件 + rename；迁移失败恢复测试改为显式注入一次性写入失败，不再依赖固定 `core-state.json.tmp` 路径，并新增无残留断言。Core 154/154、Core/Gateway build、Desktop build、Desktop 323/323、lint 和 `git diff --check` 均通过。
- 路由服务生命周期回归：`usage-router-service.test.ts` 18/18 通过；关闭服务时先调用 `server.closeIdleConnections()`，避免 Node fetch keep-alive 导致 Gateway 停止/重启等待不退出。
- Agent 原子写入回归：`packages/gateway/src/agent/adapter.test.ts` 6/6 通过；配置覆盖和 Agent snapshot 均经同目录临时文件 + rename 替换，目录中不残留临时文件，`npm run gateway:build` 和 `git diff --check` 通过。
- Agent Windows 路径回归：同一测试文件现在 7/7 通过；`work:codex` 绑定生成 `work%3Acodex.json`，恢复时同时兼容新旧 snapshot 文件名，避免 Windows 非法冒号路径。
- 多 Agent 并发回归：Gateway Runtime 同时处理 Codex 与 Claude 两个显式 Agent 请求，完成 fallback/usage 生命周期并按 Agent 分桶，`runtime.test.ts` 6/6 通过；未读取 Prompt 或执行意图路由。
- 登录启动回归：Desktop settings、Electron bridge/preload、主进程 `app.setLoginItemSettings` 和 Operations UI 已接通；macOS/Windows 返回 supported，Linux 明确禁用；相关 settings/UI/typecheck、desktop build 通过。
- 当前完整回归：`npm test` 通过，cross-platform 120 passed/1 skipped（121 tests），legacy-bash 1/1 passed；`npm run core:test` 153/153、`npm run gateway:test` 65/65、`npm run desktop:test` 320/320 passed；`npm run core:build`、`npm run gateway:build`、`npm run desktop:build`、`npm run lint` 和 `git diff --check` 均通过。
- 显式元数据规则回归：Core import、Gateway route engine、Desktop Gateway HTTP、usage-store、admin configuration 和本地模型路由兼容路径均通过；规则只匹配 token/image/reasoning/agent/context/time/model/provider 元数据，RouteGroup 目标可用，不读取 Prompt，也没有新增意图路由能力。
- CLI Gateway 集成回归：`npx tsx --test scripts/node-cli.test.ts` 通过 92/93（1 skipped）；`gateway start` 会物化显式 Catalog model binding、RouteGroup 和 `routeRules`，`gateway stop` 恢复手动账号 URL，且测试未输出密钥。
- CLI 导入恢复回归：Gateway import 迁移成功时会清理旧 v2 agent bindings；`npx tsx --test --test-name-pattern "gateway import clears stale" scripts/node-cli.test.ts` 通过，且回滚文件恢复改为原子替换。
- 账号池元数据规则回归：Desktop Gateway 在没有显式 model 的请求中按图片规则选择目标 RouteGroup，仅向目标池成员发送请求，并注入对应 upstream model；该组合场景通过端到端 HTTP 测试。
- 当前构建产物验证：macOS POSIX sandbox smoke 通过（写入、Home 读取和网络均按默认策略拒绝）；macOS arm64/x64 App、Linux AppImage/deb、Windows NSIS PE artifact 均通过 `package:verify`。这些 Linux/Windows 结果仍属于本机 artifact 级验证，不计作对应平台真机运行或签名证据。
- 升级回滚原子性回归：`npx tsc -p apps/desktop/tsconfig.electron.json --noEmit`、`npx tsx --test apps/desktop/electron/update-rollback.test.ts` 通过（4/4）；备份刷新和恢复均使用同文件系统临时副本与失败可逆替换，当前安装及旧备份不会在新副本成功落位前被删除。
- Gateway TUI 回归：新增 `packages/core/src/tui/gateway.ts` 及 Node CLI 集成；核心 TUI 全套 18/18、Gateway TUI 页面 Node CLI 目标测试 2/2、Core/Gateway build、lint 和 diff check 通过。TUI 只提供显式模型/RouteGroup/Provider 操作，没有 Prompt 或意图路由入口。
- 显式模型规则回归：Gateway route engine 7/7、Desktop model router 9/9；`match.modelIds` 可以把已显式请求的模型名映射到目标 RouteGroup，未声明 `modelIds` 的宽泛规则不会覆盖显式模型，且没有 Prompt/意图路径。
- 无意图路由硬约束回归：Core import、Gateway engine、Desktop admin/model-router/HTTP service 针对性测试 41/41 通过；运行时不读取 Prompt 语义、不调用 classifier、不选择 intent label，旧配置中的意图字段只在兼容导入/管理入口被丢弃，显式模型名规则仍可正常工作。
- Schema 边界回归：Core Gateway v1/v2 schema 对直接注入的 `prompt`、`intent`、`classifier`、`rules` 字段均拒绝，Core import 与 Desktop admin sanitizer 也会清理这些字段；新增 Core Gateway/Legacy/Admin 相关测试通过，未增加任何意图路由入口。
- Profile/TUI 增量回归：Profile 原子保存与坏 Profile schema 拒绝覆盖通过；Gateway TUI 的今日 Usage 请求/Token/费用快照及渲染测试通过；Core 153/153、Gateway 63/63、Core/Gateway build 和 Electron typecheck 通过。
- 项目级回归：`npm test` 通过，cross-platform 120 passed/1 skipped（121 tests），legacy-bash 1/1 passed；本次包含 Profile schema、Gateway TUI Usage 快照和所有无意图路由回归。
- Gateway 双写事务回归：`packages/core/src/state/legacy.test.ts` 9/9 通过；模拟 v2 文件写入/删除失败时，旧 v1/v2 Gateway 文件保持原内容，失败不会留下半更新配置。
- 最新产物回归：Core/Gateway build 后重新生成 macOS arm64 directory app，`package:verify` 通过；`node scripts/posix-plugin-sandbox-smoke.mjs` 仍通过（write/read/network 均按默认策略拒绝）。

- `npm run core:test`: 149/149 passed.
- `npm run gateway:test`: 62/62 passed.
- Gateway Usage completion regression now hashes explicit session IDs with `hashSessionId` and records optional `timeToFirstTokenMs`; the targeted runtime assertion and the full Gateway 62/62 suite pass.
- `npm run test:cross-platform`: 118 passed, 1 skipped, 0 failed (119 tests); Gateway within that run is 62/62.
- Cross-platform test portability audit removed all hard-coded `/Users/wangxt/myspace/codex-switcher` paths from the runner-facing tests; local cross-platform suite remains 118/1 skipped. Historical GitHub run `35061662309` had failed on those absolute paths; no new remote run is claimed because the current worktree is not pushed.
- `npm run test:legacy-bash` was re-run after the portability changes: 1/1 passed; `git diff --check` remains clean.
- Protocol-conversion runtime slice: `model-router.test.ts` and `usage-router-service.test.ts` pass; the desktop Gateway now opts into shared protocol conversion for direct Gateway routes, while direct resolver callers default to exact protocol matching and credential pools retain their explicit protocol check. No Prompt analysis or intent routing was added.
- Final local verification after the protocol slice: `npm test` passed with cross-platform 118/1 skipped and legacy-bash 1/1; `npm run core:build`, `npm run gateway:build`, `npm run desktop:build`, `npm run desktop:test` (317/317), `npm run lint`, and `git diff --check` passed.
- Runtime metrics slice: Gateway 62/62 and the targeted Desktop route/service suite pass; live request/token/latency metrics now affect explicit `usage`, `pace`, and `smart` model-group selection without Prompt analysis or intent routing.
- Final local verification after runtime metrics: `npm test` passed with cross-platform 118/1 skipped and legacy-bash 1/1; `npm run desktop:test` passed 317/317; Core/Gateway/Desktop builds, `npm run lint`, and `git diff --check` passed.
- `npm test`: cross-platform 118 passed/1 skipped (119 tests) plus legacy-bash 1/1 passed.
- After the Usage completion and CLI persistent-ledger fixes, cross-platform is 118/1 skipped; `npm run desktop:test` now remains 317/317 and `npm run lint && git diff --check` pass.
- Latest full verification: Core 149/149, Gateway 62/62, command suite 118 passed/1 skipped (119 tests), legacy-bash 1/1, and Desktop 317/317. Focused Gateway coverage additionally includes real JSONL child-process transport, real child Provider Runtime activation, persistent plugin-manager activation, cross-plugin global concurrency limiting, hung-provider isolation, timeout cancellation, and host shutdown behavior.
- `npm run desktop:test`: 317/317 passed, including shared route-engine loading, explicit Gateway Catalog model materialization, stale model-route cleanup, pool upstream-model rewriting, desktop provider-plugin runtime initialization, file-level update backup/restore, live Gateway protocol conversion from Responses ingress to an Anthropic upstream, and explicit metadata rule routing.
- `npm run test:legacy-bash`: 1/1 passed.
- `npm run desktop:build`: passed.
- `node scripts/posix-plugin-sandbox-smoke.mjs`: passed on macOS with write, Home-read, and network denial observations all true.
- Current macOS arm64/x64 directory apps, Windows NSIS PE artifact, Linux AppImage ELF artifact, and Linux deb archive all passed `npm run package:verify --workspace ./apps/desktop` after the latest desktop build; Windows/Linux package verification is artifact-level only on this macOS host.
- `npm run desktop:build`: passed after Provider Plugin Runtime integration; the packaged build includes the rebuilt `packages/gateway/dist`.
- After the cross-platform path portability fix, `npm run core:build`, `npm run gateway:build`, `npm run desktop:build`, and `npm run desktop:test` all passed; Desktop remains 311/311 and `npm run lint && git diff --check` pass.
- `npx tsx --test packages/gateway/src/plugin/provider-adapter.test.ts packages/gateway/src/plugin/runtime.test.ts`: 5/5 passed; `ProcessPluginTransport` byte-budget/backpressure test also passed in the full Gateway suite.
- Provider plugin market/Host/runtime focused suite: 13/13 passed; the current Gateway full suite is 60/60 after atomic market activation, duplicate-version protection, plugin-provider route participation, shared concurrency limiting, and hung-provider isolation.
- `npm run desktop:package:mac:dir`: passed after the plugin runtime integration; both x64 and arm64 directory apps passed `package:verify` and local `codesign --verify`. Developer ID signing/notarization remains unavailable on this machine.
- `npm run desktop:package:mac:dir`: passed; local Developer ID signing was skipped because no valid Developer ID certificate is installed.
- `npm run package:verify --workspace ./apps/desktop -- release/mac-arm64/codex-switcher.app`: passed.
- `npm run package:verify --workspace ./apps/desktop -- release/mac/codex-switcher.app`: passed after rebuilding the universal x64/arm64 directory packages.
- `npm run desktop:package:linux` with the Electron mirror: AppImage and deb both built successfully after adding Linux package metadata.
- `npm run package:verify --workspace ./apps/desktop -- release/codex-switcher-0.1.33.AppImage`: passed.
- `npm run package:verify --workspace ./apps/desktop -- release/appsdesktop_0.1.33_amd64.deb`: passed.
- `npm run desktop:package:win` with cached Windows Electron/NSIS: Windows NSIS installer built successfully.
- `npm run package:verify --workspace ./apps/desktop -- release/codex-switcher Setup 0.1.33.exe`: passed; this macOS cross-build is not counted as Windows runtime/helper evidence.
- `npm run test:desktop-package-workflow`: passed with macOS/Windows/Linux package jobs and signed-manifest release assertions.
- The desktop package workflow now has tag-only release credential gates for macOS Developer ID/notarization and Windows Authenticode, verifies macOS stapling and Windows Authenticode status, and keeps manual runs certificate-free; workflow YAML parsing and `desktop-package-workflow.test.ts` both pass.
- `npx tsx --test apps/desktop/electron/builder-config.test.ts scripts/package-scripts.test.ts`: passed with Linux targets and root packaging script.
- Gateway import now recursively drops unsupported intent/classifier fields before persistence and preserves Gateway-shaped route-group members; `packages/core/src/gateway/import.test.ts` 4/4 passed.
- Agent filesystem now enforces root boundaries, accepts explicit POSIX/WSL and Windows path styles, and allows the CLI's state directory only through an explicit additional-root whitelist; Agent adapter tests 5/5 passed.
- Legacy pointer/runtime/Gateway v1/v2/env-metadata writes now use same-directory temporary files and rename, while Gateway import keeps the v1/v2 recovery rollback; Core legacy and migration tests passed.
- `scripts/verify-update-manifest.mjs` now verifies every release manifest signature and artifact hash before upload; positive and tampered-artifact cases passed.
- Windows plugin isolation now has an AppContainer launcher source with explicit capability forwarding, MSVC/vswhere build support, Node runtime ACL setup, fail-closed resource discovery, a Windows CI gate that requires the helper, and a smoke test for default filesystem/Home-read/network denial. macOS sandbox policy now also defaults to Home-read/write/network isolation and grants writes only with the explicit filesystem permission; the current Gateway suite is 60/60 and desktop native-helper contract tests passed. The source is not counted as Windows runtime evidence until that CI smoke test actually runs on Windows.
- A real macOS POSIX sandbox smoke test now runs after desktop build and passed locally; it launched the compiled `sandbox-exec` path and verified plugin-directory-only writes, denial of a temporary Home-directory secret read, and default network denial. Linux and Windows smoke tests remain CI-only until their runners execute.
- Local Linux package attempt did not produce an artifact: the Electron Linux runtime download returned an invalid archive after 3m11s; this is recorded as missing local packaging evidence, not as a pass.
- `git diff --check`: passed.
- Provider CLI lifecycle coverage now verifies protected environment-variable login, live quota authorization, refresh-token exchange, token persistence, live revoke, and persistent Router-ledger usage summaries without exposing the access token in output; `npx tsx --test scripts/node-cli.test.ts`: 91 passed/1 skipped (92 tests).
- `npm run lint`, `npm pack --dry-run`, and release/package contract tests passed; no npm tarball was written by the dry-run.
- Intent routing audit: no runtime classifier, prompt analysis, intent rule execution, or intent route selection was added; import/admin compatibility paths only discard unsupported legacy fields.
- Explicit model routing audit: Gateway runtime selection uses only request model, configured RouteGroup, protocol, capabilities, health, quota and strategy. A model binding never inspects Prompt content and never invokes an intent/classifier path.
- Desktop route-engine audit: `usage-router-service` loads `packages/gateway` route resolution at startup; if the packaged artifact is unavailable, the local compatibility resolver is used only as a deployment fallback, with the same explicit-model boundary and no intent path.
- Final acceptance remains pending until P6 Windows native isolation and real three-platform packaging/signing/upgrade evidence are available; real third-party Provider credentials remain controlled-environment evidence only.
- 最新无意图路由验收：`npm test` 通过 Core 157/157、Gateway 78/78、脚本/工作流 30/30、legacy-bash 1/1；`npm run desktop:test` 通过 388 项（387 passed/1 skipped，唯一 skip 为需安装 Codex 的外部 E2E）；Electron/Web typecheck、`npm run desktop:build`（Vite 2486 modules）和 `git diff --check` 通过。运行时关键词门禁为 0 个匹配；路由仍只依赖显式模型/RouteGroup、协议、能力、健康度、配额、策略及受控元数据，不读取 Prompt、不做分类、不提供意图路由。macOS sandbox smoke 继续输出并验证 write/read/network 全部拒绝；Windows/Linux 真机隔离、签名/公证和升级实机证据仍待对应 runner/证书环境，不能据此标记 P6/P8/P9/P10 完成。
- P1 Agent 高级字段闭环：Agent Adapter 新增 `listFields()` 契约，Codex 显式暴露 reasoning effort；Agent binding/Core v2/import/Desktop apply 和 metadata-only Agent import 支持显式 reasoning、fallback model 和 sub-agent model 元数据，未声明路径不写入配置。Core 157/157、Gateway 78/78、Desktop 387 passed/1 skipped、Core/Gateway/Electron/Web typecheck 通过；无 Prompt 分析或意图路由。
- CLI Agent import 增量：`agent import --dry-run` 和持久化导入现在保留显式 reasoning profile、fallback model、sub-agent model 元数据，同时继续不复制凭证；定向 Node CLI 合约测试通过，未增加 Prompt/意图路由入口。
- 最新完整本地回归：`npx tsx --test scripts/node-cli.test.ts` 通过 94 passed/1 skipped；`npm test` 通过 Core 157/157、Gateway 78/78、脚本/工作流 30/30、legacy-bash 1/1；`npm run desktop:test` 通过 387 passed/1 skipped；Electron/Web typecheck、`npm run desktop:build`、`git diff --check` 均通过。静态意图路由关键词审计为 0 个运行时匹配；本轮仍未实现 Prompt 分析、分类器或意图路由。
- 当前发布产物复核：macOS arm64/x64 `.app`、Linux AppImage/deb、Windows NSIS `.exe` 均通过 `package:verify`；macOS 本机 sandbox smoke/evidence verifier 继续通过（write/read/network 全部拒绝）。这些结果只证明产物结构和 macOS 本机隔离，不替代 Linux/Windows 真机运行、AppContainer/bwrap 隔离、正式签名/公证或升级回滚证据。
- 远程 CI 证据审计：当前 GitHub 最近可见的 CI/desktop-package 成功运行仍对应旧提交 `fbfabdd`，不是当前未提交工作树；因此没有把旧运行结果计入本目标的最终验收，也没有在未获授权的情况下提交、推送或触发新 workflow。
- 计划项代码审计：对 Core/Gateway/Desktop/CLI 的生产源码扫描未发现 TODO、未实现占位或后续实现标记；当前剩余未完成项均已收敛到 P6/P8/P9/P10 所要求的真实平台、证书和发布安装证据，意图路由仍明确排除。
- CI 发布配置审计：GitHub API 确认 workflow 使用的 `actions/checkout@v7`、`actions/setup-node@v6`、`actions/upload-artifact@v7` 和 `actions/download-artifact@v8` 标签存在；CI/发布 workflow 的 Linux bwrap、Windows AppContainer、macOS sandbox、签名凭据门禁和产物校验步骤均可解析，仍需实际 runner 执行结果。
- Linux 插件沙箱网络运行时修复：bubblewrap 现在只读挂载 `/etc`，使显式授予 network 权限的 Provider 插件能够使用 DNS 和系统 CA，同时不获得系统目录写权限；沙箱契约 5/5、Gateway 全量 78/78、Gateway build 和 `git diff --check` 通过。未引入 Prompt 分析或意图路由。
- 沙箱修复后的桌面产物回归：`npm run desktop:build` 通过（Vite 2486 modules），Core/Gateway/Electron/Web 编译链保持通过；该修复没有改变手动切换或显式模型路由边界。
- Linux 容器验证尝试：本机存在 Docker CLI 和 Docker Desktop，但启动后台后等待约 25 秒仍无法连接 `desktop-linux` daemon socket；因此未将容器作为 Linux 真机证据，也未伪造 bwrap 运行结果。真实 Linux runner 仍需执行 CI smoke。
- Linux Docker 用户态验证：Docker Desktop 恢复可用后，以隔离卷和非 root `node` 用户运行 Linux 20 环境；根级 `npm test` 通过 Core 157/157、Gateway 78/78、脚本/工作流 30/30、legacy-bash 1/1，`npm run desktop:test` 通过 388 项（385 passed/3 platform skips），`npm run desktop:build` 通过，bwrap smoke/evidence verifier 通过。该证据覆盖 Linux 用户态和 Docker Linux 内核路径，但仍不替代 GitHub Ubuntu runner 的标准权限环境。
- Linux 原生打包验证：Linux 容器成功生成 AppImage 并通过 `package:verify`；deb 阶段被 electron-builder 内置 32 位 fpm 在 QEMU 兼容层中挂起，已终止该进程，未把 deb 结果记为成功。应用代码和 Linux AppImage 仍通过验证。
- 图片恢复跨平台修复：`recover_current_image.py` 选择 rollout transcript 时增加 birthtime/ctime/inode 稳定 tie-breaker，修复 Linux 同一 mtime tick 下误选旧 transcript 的问题；Linux Desktop 388 项回归已重新通过 385/3。
- Linux 发布 workflow 修复：Ubuntu packaging job 在安装 bubblewrap 前启用 i386 架构，并安装 `libc6:i386` 与 `libcrypt1:i386`，满足 electron-builder deb 目标内置 32 位 fpm 的运行时依赖；workflow contract test 通过，未引入意图路由。
- Windows 证据采集闭环：`scripts/windows-manual-capture.ps1` 现在会自动发现两种打包/源码路径下的 AppContainer helper，执行 `windows-plugin-sandbox-smoke.cjs` 并调用 `verify-sandbox-evidence.mjs`；缺少 Windows helper 或脚本时明确记录 `SKIPPED`，不会伪造通过。Windows capture/handoff/support-audit 契约测试 3/3、`git diff --check` 通过；真实 Windows AppContainer、签名、公证和升级回滚证据仍待对应机器/证书环境。
- Windows 结果模板同步：结果模板现在要求一并保留自动生成的 `windows-sandbox.json`，并明确把 helper 缺失时的 `SKIPPED` 作为未执行证据；相关 capture/result-template/handoff/support-audit 测试 4/4 通过。
- 本轮工作树全量回归：`npm test` 通过 Core 157/157、Gateway 78/78、脚本/工作流 31/31、legacy-bash 1/1；`npm run desktop:test` 通过 387 passed/1 skipped（唯一 skip 为需安装 Codex 的外部 E2E）；`npm run desktop:build`（Vite 2486 modules）、Electron/Web typecheck、`npm run lint` 和 `git diff --check` 均通过。运行时意图路由关键词审计仍为 0 个匹配。
- npm 发布清单修复：将 `windows-plugin-sandbox-smoke.cjs` 与 `verify-sandbox-evidence.mjs` 纳入根包 `files`，避免从全局安装/包内容执行 Windows 手动采集时因缺少验证脚本而只能 `SKIPPED`；`package-files.test.ts` 和 `npm pack --dry-run` 均确认两个脚本实际进入包（294 个条目）。
- 已安装 Codex 兼容层 E2E：在临时 `CODEX_HOME`、本地 fake Chat 模型和本地 Gateway 下执行真实 `codex exec --ephemeral`，确认 Codex 消费 Responses 兼容路由并返回 `E2E_OK`；随后 `CODEX_SWITCHER_RUN_CODEX_E2E=1 npm run desktop:test` 全量通过 388/388，之前唯一外部 Codex skip 已消除。该测试不访问真实 Provider，也不修改用户现有 Codex 配置。
- Linux bubblewrap 容器复核：在 Docker Linux 20、非 root `node` 用户和 `--privileged` 隔离环境中重新执行 POSIX sandbox smoke，`writeDenied/readDenied/networkDenied/markerAbsent` 全部通过，`verify-sandbox-evidence.mjs` 接受 `.wxt/evidence/linux-docker-sandbox-latest.json`；这加强 Linux 用户态证据，但仍不替代 GitHub Ubuntu runner 和真实 Linux 主机证据。
- npm CLI 可安装性修复：发布包现在包含 `scripts/node-cli.ts`、`scripts/core-cli.ts`、Core/Gateway/桌面 Gateway 运行时源码，并将 `tsx`、`sql.js`、`undici`、`jsonc-parser`、`yaml` 声明为 runtime dependencies；实际 `npm pack` 后安装到隔离临时 prefix，已执行安装包的 `codex-sw-node version`（0.8.17）和 `help` 成功。`package-files.test.ts` 还会执行 `npm pack --dry-run` 检查关键闭包文件。
- 发布闭包后的最新根级回归：`npm test` 通过 Core 157/157、Gateway 78/78、脚本/工作流 32/32、legacy-bash 1/1；已安装 Codex E2E 与 Linux bubblewrap Docker smoke 仍通过，运行时意图路由关键词审计为 0 个匹配。
- 已安装 npm CLI 运行态复核：在隔离 `HOME`、state、envs 和 default-home 目录中执行已安装包的 `codex-sw-node status`，默认环境/账号状态正常返回，未读取或改写用户现有目录。
- npm 包 Windows launcher 分支复核：在同一隔离安装包上以 `CODEX_SWITCHER_BIN_PLATFORM=win32` 执行 `codex-sw.cjs status`，确认 Windows 入口会进入 Node CLI，并成功返回默认状态；这不是 Windows 原生运行证据，但闭合了发布包的入口选择路径。
- Provider Plugin Market 成功路径补测：新增隔离集成测试，使用受控本地 runner 实际 materialize npm tarball 和 Git source，再进入安装、checksum、active 指针和版本列表；`packages/gateway/src/plugin/market.test.ts` 9/9 通过，npm/git 不再只有失败路径契约覆盖。

## 2026-10-07 macOS 启动闭环修复

- 发现并修复打包后主进程静态引用工作区 Gateway 入口的问题：该入口在 extraResources 中，不在 app.asar 内；改为由 `core-runtime` 按资源路径懒加载插件 Manager、Market 和签名模块，避免启动阶段原生错误弹窗。
- 重新生成 macOS x64 与 arm64 directory `.app` 后，通过 `open -n` 启动验证：x64/Rosetta 与 arm64 均进入真实业务页面并创建 Electron 子进程；当前不再只以“进程可创建”作为启动证据。
- 新增资源边界契约测试和运行时解析测试；Provider Plugin Runtime 定向测试、Desktop package 契约测试均通过。

## 2026-10-07 macOS 提交前验收

- 最终 `npm test`：Core 157/157、Gateway 79/79、脚本/工作流 33/33、legacy-bash 1/1；`npm run desktop:test`：388 passed/1 skipped（唯一 skip 为显式外部 Codex E2E）；`npm run desktop:build`、`npm run lint`、`git diff --check` 通过。
- 最终生成 macOS x64 与 arm64 directory `.app`；主程序分别为 `Mach-O 64-bit executable x86_64` 与 `Mach-O 64-bit executable arm64`，两套均通过 `package:verify` 和本地嵌套签名校验。
- 独立包启动检查确认二进制架构和进程可创建；本机进程未进入业务窗口阶段，未把 macOS 原生启动阶段停留误报为运行态通过。正式 Developer ID 签名、公证和真实 Intel 设备仍属于外部环境证据。
- 工作树、提交范围和 macOS release 产物继续通过禁用术语扫描；提交信息使用本项目自身术语，不包含外部品牌或比较性参考文案。

## 2026-10-07 CI 跨平台修复

- 远端 CI 对提交 `a236dda` 的真实失败日志确认了三类问题：Windows Node 20 测试 runner 通过 loader 直接启动时无法处理盘符 URL；Windows MSVC 回退构建的 `VsDevCmd.bat` 引号被重复转义；Ubuntu runner 的 AppArmor 限制阻止 bubblewrap 配置隔离网络命名空间。
- Core、Gateway、Desktop 测试 runner 已统一改为调用 `tsx/dist/cli.mjs`；Windows 原生 helper 构建改用 `ComSpec`、`windowsVerbatimArguments` 和不重复转义的命令参数；CI 与桌面打包 workflow 在 Linux smoke 前安装并加载最小 bubblewrap AppArmor userns profile；POSIX smoke 在子进程无 JSON 输出时也会给出明确失败诊断。
- 本地回归：Core 157/157、Gateway 79/79、脚本/工作流 33/33、Desktop 390/391（1 个显式外部 Codex E2E skip）、builder contract 1/1、lint 和 `git diff --check` 通过；远端 CI 将在本次提交后重新取得 Windows/Linux 真机证据。

## 2026-10-07 CI 失败项收口

- 提交后的远端 CI 继续暴露了宿主平台差异：Windows/macOS 测试不能依赖 runner 自带 PATH，Unix 启动断言不能假设 Windows 命令包装方式，路径断言也不能写死 POSIX 分隔符；相关测试已改为显式平台与隔离 PATH，并按宿主路径规则生成期望值。
- Windows AppContainer smoke 的失败原因已定位为 Node 目录和工作目录的父目录缺少仅遍历权限。原生 helper 现在沿父级目录授予 `FILE_TRAVERSE`、只读属性和同步权限，同时仍只给 Node 目录与工作目录授予实际读取/执行或写入权限，不扩大文件内容可读范围；无 JSON 输出时 smoke 脚本也会保留子进程状态和 stderr。
- 本地修复后回归：`npm test` 通过 Core 157/157、Gateway 79/79、脚本/工作流 33/33、legacy-bash 1/1；`npm run desktop:test` 通过；builder contract 1/1、`npm run lint` 和 `git diff --check` 通过。下一次远端 CI 用于确认 Windows AppContainer 真机 smoke 和跨平台测试闭环。

## 2026-10-07 Windows Agent 路径兼容修复

- Windows CI 的 Gateway 测试进一步暴露了 Agent 文件系统路径校验和远程快照路径拼接的宿主差异：native Windows 的父目录判断使用了错误的分隔符，远程 POSIX 文件系统却收到了 native `join` 生成的反斜杠路径。
- `packages/gateway/src/agent/adapter.ts` 现在按显式 path style 选择分隔符和绝对路径判断；Agent 快照及快照目录枚举统一使用可移植的正斜杠内部路径，再交由目标文件系统归一化，兼容本地 Windows、POSIX/WSL 和 SSH 远程 Agent。
- 定向回归：Agent adapter、remote filesystem 共 10/10 通过；此前 Windows CI 失败的 `adapter.test.ts` 和 `remote.test.ts` 场景已在本地复现并通过。下一次远端 CI 继续确认 Windows 原生测试和 AppContainer smoke。

## 2026-10-07 Windows CLI 测试启动兼容修复

- Windows runner 的第二轮失败来自测试启动方式，而非功能实现：测试直接调用 `npx`、批处理包管理器和 Unix 可执行 shell 脚本，导致 Windows 下分别出现 `ENOENT`、`EINVAL` 和 `spawn UNKNOWN`。
- Core CLI 测试现在直接使用当前 Node 与仓库内的 `tsx` CLI；发布清单测试对 Windows 包管理器启用 shell 兼容；CLI launcher 对显式 `.cmd/.bat` 入口启用 Windows shell；legacy launcher fixture 在 Windows 使用等价 batch 脚本，在 Unix 保持 Bash fixture。
- 定向回归 12/12 通过；完整本地 `npm test`、Desktop 回归、lint 和 diff check 通过。远端 CI 将验证 Windows cross-platform 测试及原生隔离 job 的最终结果。

## 2026-10-07 Windows smoke 超时收口

- Windows cross-platform 已在远端通过；原生隔离 job 的 helper 构建与校验也通过，但 AppContainer 网络探测在某些 runner 上没有触发 Node socket 自带 timeout，导致父 helper 长时间等待。
- Windows smoke fixture 现在增加独立 3 秒网络硬超时、单次完成保护和 launcher 15 秒总超时；网络受限时仍按拒绝处理，连接异常或子进程异常则保留 stderr/status 诊断，不会无限挂起。
- 本地 `node --check`、cross-platform、Desktop 回归、lint 和 diff check 继续通过；下一次远端运行用于确认 Windows AppContainer smoke 正常收敛并生成证据。

## 2026-10-07 macOS 交付收口

- 最新远端 CI `37561409761` 已确认 macOS legacy、macOS Desktop、macOS/Ubuntu/Windows cross-platform 和 Ubuntu Desktop 任务通过；Windows 原生 AppContainer smoke 仍因 runner 子进程未在限定时间内退出而失败，记录为外部环境证据缺口，不阻塞本次 macOS 交付。
- Windows smoke fixture 已改为异步文件探测，硬超时从探测开始前即生效，并保留单次完成保护和立即输出/退出逻辑；本地静态检查与回归继续通过。
- 已完成 macOS x64 与 arm64 的 DMG、ZIP 产物核验和独立启动检查；两套产物均可进入真实业务页面，未将 Windows/正式签名/公证结果冒充为 macOS 本机证据。

## 2026-10-07 Windows 原生等待边界修复

- 最新 Windows CI 日志确认失败点在原生 helper 等待 AppContainer 子进程退出，而不是 smoke 脚本 JSON 解析；原实现使用无限等待，导致 runner 只能在 Node 侧 15 秒后中止 helper。
- helper 现在支持 `--timeout-ms`，在限定时间内主动终止未退出的 AppContainer 子进程并释放句柄；smoke 脚本先执行最小 Node 启动探针，再执行文件和网络隔离探测，并把 profile/status/stderr 纳入失败诊断。
- 新增 builder contract 断言覆盖超时解析、有限等待和子进程清理；本地脚本静态检查、sandbox 证据测试、Desktop builder contract、lint 和 diff check 通过。下一次远端 CI 用于验证真实 Windows runner 行为。

## 2026-10-07 Windows AppContainer 入口解析修复

- 远端阶段诊断确认 ACL 已完成、AppContainer 子进程已创建并退出；失败点是 Node 解析绝对入口文件时尝试读取盘符根目录，最小 ACL 策略会拒绝该访问。
- 原生 helper 启动 Node 时加入 `--preserve-symlinks-main`，避免为主入口做盘符根 realpath 探测；smoke 继续在本地受控目录内复制 Node runtime，避免修改共享工具缓存目录的 ACL。
- 该修复已通过本地 builder contract、sandbox 证据测试、Node 语法检查、lint 和 diff check；下一次远端 CI 将验证文件/网络隔离探针是否可以完整运行。

## 2026-10-07 Windows ACL 回滚范围收窄

- 远端日志确认 Node 启动探针已经输出并正常退出；剩余超时发生在 helper 回滚工作区上层目录 ACL 时，属于过宽父级授权的清理问题。
- ACL 现在只修改目标目录的直接父级遍历权限和目标目录自身权限，不再沿工作区/盘符继续修改共享父目录；保留句柄清理、有限等待和回滚逻辑。
- 本地 builder contract、sandbox 证据测试、lint 和 diff check 继续通过；下一次远端运行用于确认完整 Windows 文件/网络隔离探针和证据校验。

## 2026-10-07 Windows 原生隔离证据闭环

- 远端 CI `37563561262` 全部通过：macOS legacy/Desktop、macOS/Ubuntu/Windows cross-platform、Ubuntu Desktop 均通过。
- Windows runner 的 AppContainer helper 构建、文件系统拒绝/授权、Home 读取拒绝、网络拒绝、证据生成和证据校验全部通过；本次不再存在 Windows smoke 未执行或超时遗留。
- 当前 macOS x64/arm64 安装包继续使用已核验的 `0.1.33` 产物；正式 Developer ID/公证仍受本机证书环境限制，但不影响本地启动和包完整性证据。

## 2026-10-07 最新跨平台 CI 与三平台打包

- 提交 `c05741f` 的 CI 运行 `37564551997` 已全部通过：macOS legacy/Desktop、macOS/Ubuntu/Windows cross-platform、Ubuntu Desktop 和 Windows Desktop/AppContainer 证据均成功。
- 已触发非标签三平台打包工作流 `37564780832`，用于在真实 macOS、Windows、Ubuntu runner 上生成并校验安装包；非标签运行不要求发布证书，不将未签名产物当作正式发布结果。
- 当前仍需该打包工作流完成后再确认 P8/P9/P10 的 runner 级安装包证据；签名、公证、AuthentiCode 和真实升级回滚仍由标签发布工作流的受控凭据门禁负责。

## 2026-10-07 三平台非标签打包闭环

- 修复 `desktop-package` workflow：手动运行时不再把空的 macOS/Windows 签名变量传给 electron-builder；标签运行仍保留签名凭据强制门禁。
- 修复 Linux package verify 的 workspace cwd 路径拼接，校验现在针对 `apps/desktop/release` 中实际生成的 AppImage 和 deb。
- `desktop-package` 运行 `37565196259` 全部通过：macOS 5m04s、Ubuntu 3m29s、Windows 3m52s；三端沙箱证据、桌面测试、安装包构建和产物校验均成功。非标签运行不产生正式签名/公证结论。
- 运行产物已上传为 `codex-switcher-macos`、`codex-switcher-windows-x64`、`codex-switcher-linux-x64` 及三端 sandbox evidence；仓库当前没有配置发布签名密钥，因此未触发标签发布路径。

## 2026-10-07 最新远端验收回收

- CI 运行 `37565843947` 已完成且为成功：macOS legacy、macOS Desktop、macOS/Ubuntu/Windows cross-platform、Ubuntu Desktop、Windows Desktop 及 Windows AppContainer evidence 全部通过。
- 本次结果确认跨平台测试发现、Windows 原生隔离证据和 Linux bubblewrap 证据均已在当前 `main` 提交上闭环；不再使用旧提交的运行结果替代当前代码证据。
- 三平台非标签打包运行 `37565196259` 保持成功，macOS/Windows/Linux 安装包和沙箱 evidence 均已上传并通过产物校验。
- 正式签名、公证、AuthentiCode、真实安装升级回滚和真实第三方账号验证仍需要外部证书、账号或设备；仓库当前没有发布签名密钥，未将这些外部条件伪装成已完成。

## 2026-10-07 更新清单信任根固定

- `scripts/verify-update-manifest.mjs` 新增受信公钥文件/环境变量校验；当调用方提供受信公钥时，清单内声明的公钥必须与受信公钥的 DER 表示一致，并使用受信公钥验证签名。
- 标签发布工作流从发布私钥派生临时受信公钥，并将其显式传给每个产物的清单校验步骤；手动非标签打包路径保持不需要发布密钥。
- 正确公钥、错误公钥、产物篡改和非法元数据测试均通过；`npm run test:cross-platform` 通过 Core 157/157、Gateway 79/79、脚本/工作流 33/33；`node --check scripts/verify-update-manifest.mjs`、`git diff --check` 通过。

## 2026-10-07 自动更新默认拒绝未签名源

- `createDesktopAutoUpdateController` 现在在配置更新源时默认要求签名清单；只有显式传入 `requireSignedManifest: false` 的开发/测试调用才允许未签名源。
- 自动更新回滚、健康启动、签名清单、产物 Hash 和开发覆盖路径测试均通过：`npx tsx --test apps/desktop/electron/auto-update.test.ts` 9/9，`npm run desktop:test` 390 passed/1 skipped；唯一 skip 仍是需要外部安装的 Codex E2E。

## 2026-10-07 CLI 领域入口收口

- `scripts/bin/launcher.cjs` 现在在 macOS/Linux 下将 `gateway`、`provider`、`agent`、`group`、`model`、`usage`、`profile` 命令转入 Node CLI；旧的环境/账号手动命令继续使用 Bash 入口。
- README 中英文说明和一致性断言已同步；入口回归 5/5，`npm run test:cross-platform` 通过 Core 157/157、Gateway 79/79、脚本/工作流 34/34。
- 隔离状态目录下通过实际 `node scripts/bin/codex-sw.cjs` 执行 `gateway status`、`provider ls`、`model ls`，确认主入口在 macOS 上进入 Node CLI，并保持默认环境的手动模式状态。

## 2026-10-07 当前主线最新包

- 针对当前 `main` 提交 `0dd1b94` 重新触发的三平台打包运行 `37567205074` 已成功：macOS、Windows、Linux package job 全部通过，release job 按非标签规则跳过。
- 当前运行上传了 `codex-switcher-macos`、`codex-switcher-windows-x64`、`codex-switcher-linux-x64` 和三端 sandbox evidence；产物大小与非空校验已由 GitHub Artifacts API 确认。

## 2026-10-07 安装产物 smoke 切片

- 新增 `scripts/package-install-smoke.mjs`：macOS 从目标 ZIP 解包并验证应用可执行文件，Linux 使用 `dpkg-deb --extract` 验证安装树，Windows 使用 NSIS `/S` 安装到临时目录并验证 `codex-switcher.exe`。
- 三个平台 package job 会把安装结果写入 `package-install-*.json` 并随对应安装包 artifact 上传；证据只包含平台、架构、产物文件名、安装方式和可执行文件名，不记录用户路径或凭证。
- 本机 macOS arm64 ZIP smoke 通过；`npx tsx --test scripts/desktop-package-workflow.test.ts` 1/1，`npm run test:cross-platform` 通过 Core 157/157、Gateway 79/79、脚本/工作流 34/34，Node 语法和 diff check 通过。
- 当前 `main` 提交 `4126d05` 的三平台打包运行 `37567933101` 已成功：macOS、Windows、Linux package job 全部通过，且 Windows NSIS、Linux deb、macOS ZIP 的安装 smoke 步骤均为成功；release job 按非标签规则跳过。
- 对应 artifact `codex-switcher-macos`、`codex-switcher-windows-x64`、`codex-switcher-linux-x64` 均成功上传并包含各自的 `package-install-*.json` 证据文件；正式签名/公证仍未在非标签运行中执行。

## 2026-10-07 安装后回滚恢复 smoke 切片

- `scripts/package-install-recovery.ts` 复用桌面更新回滚实现，对已安装的真实可执行文件执行“备份 → 模拟损坏升级 → 原子恢复”，并以 SHA-256 验证恢复前后字节完全一致。
- `scripts/package-install-smoke.mjs` 已在三平台安装验证后调用该恢复检查，证据新增 `rollbackSmoke: "passed"`；本机 macOS arm64 ZIP 安装与回滚 smoke 通过。
- 定向验证：`npx tsx --test scripts/desktop-package-workflow.test.ts` 1/1、`npx tsx --test apps/desktop/electron/update-rollback.test.ts` 4/4、`node --check scripts/package-install-smoke.mjs` 通过。
- 当前 `main` 提交 `c4667d0` 的三平台打包运行 `37588896102` 已成功：Linux、Windows、macOS package job 全部通过，且三端安装 smoke（包含回滚恢复检查）均通过；release job 按非标签规则跳过。
- 对应 artifact `codex-switcher-linux-x64`、`codex-switcher-windows-x64`、`codex-switcher-macos` 及三端 sandbox evidence 均成功上传；本次 macOS/Windows 签名、公证步骤因无发布凭据按设计跳过，未将非签名产物当作正式发布结果。

## 2026-10-07 完整安装目标回滚 smoke 加固

- 安装恢复检查现在不再只替换单个可执行文件：macOS 备份并恢复完整 `.app` 目录，Windows/Linux 备份并恢复完整安装树，再通过安装树中的真实可执行文件做 SHA-256 前后校验。
- 本机 macOS arm64 安装 smoke 通过，证据包含 `rollbackTarget: "app-bundle"` 和 `rollbackSmoke: "passed"`；回滚实现定向测试 4/4，打包工作流契约测试 1/1。
- 按既有无签名交付方式，`main` 提交 `1212c9f` 的 GitHub Actions 打包运行 `37590024893` 已成功：macOS、Windows、Linux package job 的完整安装目标回滚 smoke 全部通过，release job 按非标签规则跳过；三端安装包与 sandbox evidence artifact 均成功上传。

## 2026-10-07 标签自动打包恢复为无签名交付

- `.github/workflows/desktop-package.yml` 保持 `push.tags: ["desktop-v*"]` 和 `workflow_dispatch` 两种入口；推送 `desktop-v*` 标签仍会自动执行 macOS、Windows、Linux 打包并创建预发布 Release。
- 标签和手动运行统一沿用未签名产物路径，不再因为缺少证书、公证、AuthentiCode 或更新签名密钥而失败；这些密钥存在时仍可作为可选增强，不改变无签名交付的默认行为。
- 当前交付不创建签名结论；安装包完整性、安装 smoke、完整安装目标回滚和 sandbox evidence 仍由 workflow 强制校验。

## 2026-10-07 Desktop v0.1.34 自动发布闭环

- `apps/desktop/package.json` 已从 `0.1.33` 升级到 `0.1.34`，同步更新 workspace lock 和 `.github/release-notes/desktop-v0.1.34.md`。
- 推送 `desktop-v0.1.34` 后，GitHub Actions 运行 `37593709022` 的 macOS、Windows、Linux package job 和 release job 全部成功；之前的失败运行 `37591693045` 已定位并修复为 Release job 先扁平化包含安装证据的 artifact 目录，再校验/上传安装包。
- 预发布 Release 已创建：[desktop-v0.1.34](https://github.com/wxt2rr/codex-switcher/releases/tag/desktop-v0.1.34)，包含 macOS arm64/x64 DMG/ZIP、Windows NSIS、Linux AppImage/deb 及 blockmap；继续按既有未签名交付方式发布。

## 2026-10-07 外部验收边界确认

- 签名证书、公证、真实 Intel Mac 安装以及真实第三方 Provider/模型调用不再作为本次工程开发的待办项，由使用者自行验证。
- 本仓库负责的自动化范围已重新验收：`npm test` 通过 Core 157/157、Gateway 79/79、根级脚本 34/34、legacy-bash 1/1；`npm run desktop:test` 通过 390 项并保留 1 个明确标注的外部 Codex E2E skip；Core/Gateway/Desktop build、lint 和 `git diff --check` 均通过。
- 计划中的 P8、P9、P10 已按上述边界更新为 `complete`；手动账号切换和 Gateway 模式均保留，未引入意图路由。
