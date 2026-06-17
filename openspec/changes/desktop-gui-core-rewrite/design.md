## Context

`codex-switcher` 当前由单个 Bash 脚本承载大部分产品能力，包括状态模型、配置写入、账号切换、TUI 交互、系统命令桥接、App 拉起、token refresh 和诊断修复。这种结构在 CLI/TUI 时代可接受，但已经出现三个结构性问题：

1. 核心业务逻辑与终端交互耦合，无法稳定复用到桌面 GUI。
2. 命令结果以文本输出为主，缺少结构化 API，前端难以可靠消费。
3. 状态迁移、长任务进度、错误分类和系统集成分散在脚本中，测试与演进成本过高。

这次变更的目标不是在现有 Bash 上包一层 GUI，而是先重写一个结构化本地 core，再让 CLI/TUI/GUI 共用能力。桌面应用是目标交付形态，但 core 是先决条件。

约束条件：
- 现有用户状态目录、env/account 数据和 `CODEX_HOME` 布局必须可迁移。
- 现有 CLI/TUI 在迁移窗口内不能直接失效。
- 登录流程仍依赖外部 `codex` CLI / App 行为，无法完全内建重写。
- 项目当前发布形态是 npm 包，新增桌面应用后仍需保留脚本安装与 CLI 入口。

## Goals / Non-Goals

**Goals:**
- 建立独立于 CLI/TUI 的本地 core，负责状态、配置、切换、迁移、任务执行和错误模型。
- 为 core 提供稳定的结构化命令/IPC 接口，供 CLI、TUI 和桌面 GUI 共用。
- 为桌面 GUI 提供足够完整的能力覆盖，包括 env/account 管理、状态查看、proxy、token refresh、日志和 App 控制。
- 将登录桥接和系统级任务统一收口到 core 的任务执行层。
- 提供从现有 Bash 状态模型迁移到新 core 状态模型的安全机制与回滚路径。

**Non-Goals:**
- 一次性移除现有 Bash CLI/TUI。
- 重写外部 `codex` 登录协议或桌面 App 内部认证实现。
- 首个版本支持跨平台所有系统服务差异；首发以 macOS 为主，后续再扩展。
- 在第一阶段做云同步、团队共享配置、远程控制或插件市场能力。

## Decisions

### Decision 1: 先建立结构化 core，再让所有入口复用
- **Choice:** 新增独立 core 模块，负责所有状态读写、切换逻辑、配置注入、任务执行和错误归类；CLI/TUI/GUI 只是不同 front-end。
- **Why:** 只有这样，桌面 GUI 才不会绑定在 Bash 文本输出和交互提示上，也能让测试集中在核心语义而不是终端表现。
- **Alternatives considered:**
  - 继续扩展 Bash，并为 GUI 增加命令桥接。Rejected，因为 GUI 会长期受制于脚本文本协议，演进空间差。
  - 直接重写桌面 GUI，同时保留 Bash 为唯一真实实现。Rejected，因为核心能力仍无法复用，问题只是被包起来而不是解决。

### Decision 2: 采用“Core Service + Adapters”分层
- **Choice:** 架构分为 `domain core`、`system adapters`、`front-end adapters` 三层。
- **Why:** domain 层只表达业务状态与规则；system adapters 封装文件系统、进程、launchd、Codex CLI/App；front-end adapters 提供 CLI、TUI、GUI 或 IPC。
- **Alternatives considered:**
  - 以 GUI 进程为唯一宿主，把所有逻辑写进桌面应用。Rejected，因为 CLI/TUI 仍需要共用能力。
  - 继续脚本式“命令即实现”。Rejected，因为无法形成稳定的内部 API。

### Decision 3: Core 技术栈采用 TypeScript/Node
- **Choice:** 用 TypeScript/Node 重写 core，并让桌面应用使用 Tauri。
- **Why:** 当前项目已有 npm 发布链路，Node 生态更容易复用现有安装与测试基础；TypeScript 对结构化状态、IPC 协议和桌面前后端共享类型更合适。Tauri 负责桌面外壳与系统集成，减小包体并保持本地能力。
- **Alternatives considered:**
  - Go core + Tauri GUI。Rejected，因为会引入双语言复杂度，第一阶段收益不足。
  - Rust core + Tauri GUI。Rejected，因为会让重写成本显著上升，不利于尽快替换现有 Bash 逻辑。
  - Electron。Rejected，因为本项目不是富渲染型桌面应用，Tauri 更适合本地工具。

### Decision 4: 状态模型从脚本散落文件提升为版本化 store
- **Choice:** 定义版本化 core state，显式管理 env、account、target pointers、runtime settings、task metadata 和 migration version。
- **Why:** 现有状态分散在多个文件与目录约定中，缺少统一 schema。版本化 store 能支持迁移、校验、回滚和未来扩展。
- **Alternatives considered:**
  - 保持现有目录布局不变，仅在代码层抽象。Rejected，因为无法可靠区分历史数据和新数据语义。
  - 切换到数据库。Rejected，因为当前数据规模小，文件型 store 更符合本地工具特征，也更利于兼容旧状态。

### Decision 5: 兼容层保留现有目录语义，但新增受管元数据
- **Choice:** 复用现有 env/account 目录结构与 `auth.json`/`runtime.json` 语义，同时引入由 core 管理的 manifest 和 schema version 文件。
- **Why:** 最大化兼容现有用户数据与手工排障方式，降低迁移成本。
- **Alternatives considered:**
  - 全量迁移到全新目录结构。Rejected，因为风险过高，用户无法无损回退。

### Decision 6: 登录与系统级动作统一抽象为任务执行器
- **Choice:** core 不直接把登录、App 拉起、proxy 测试、token refresh、doctor/recover 视为“命令输出”，而是视为可跟踪任务，包含输入、进度、结果和错误分类。
- **Why:** 这能让 GUI、CLI 和 TUI 共享相同的任务生命周期和日志视图，也便于支持长任务和失败恢复。
- **Alternatives considered:**
  - 每个前端各自调用系统命令。Rejected，因为会造成行为分叉和排障困难。

### Decision 7: CLI/TUI 分阶段迁移，而不是一次替换
- **Choice:** 第一阶段保留现有 CLI 命令面，但逐步改为调用新 core；TUI 后续可先桥接再重构。
- **Why:** 用户已在使用现有命令，先稳定 core 和状态迁移，再统一入口，风险更低。
- **Alternatives considered:**
  - 一次性删除 Bash CLI/TUI。Rejected，因为迁移风险和回归范围太大。

### Decision 8: GUI 第一阶段覆盖主流程，不强求替代全部原生命令行交互
- **Choice:** GUI 原生覆盖 env/account/status/proxy/token refresh/logs/App control/diagnostics；对于依赖外部 `codex` 交互的登录流程，用任务桥接 + 日志/终端视图承载。
- **Why:** 用户目标是桌面化管理，不是彻底消灭外部认证行为。把不能内建控制的部分明确桥接，比伪装成完全 GUI 化更稳。
- **Alternatives considered:**
  - 强行把所有登录体验嵌入 GUI。Rejected，因为依赖外部 `codex` 行为，稳定性不可控。

## Risks / Trade-offs

- [Risk] 重写 core 期间，旧 Bash 与新 core 的行为可能短期不一致。 -> Mitigation: 为关键命令建立行为回归测试，迁移期通过 golden cases 对齐输出与状态变化。
- [Risk] 状态迁移错误可能破坏用户现有登录态或 env/account 指针。 -> Mitigation: 迁移前自动备份，迁移后做完整校验，失败自动回滚。
- [Risk] 外部 `codex` 登录行为变化会影响桥接层稳定性。 -> Mitigation: 将登录桥接隔离在 adapter 中，允许按版本添加兼容分支并暴露诊断信息。
- [Risk] 引入 Tauri 与 Node core 后，构建发布链路明显复杂化。 -> Mitigation: 先保留 npm CLI 发布，桌面应用单独构建，待 core 稳定后再整合发布流程。
- [Risk] TUI 迁移收益低，短期可能形成三套前端并存。 -> Mitigation: 把 TUI 视为兼容入口，优先让它调用 core，避免继续在 Bash 中增加新逻辑。
- [Risk] launchd、App 启动、shell 初始化等系统动作跨平台差异大。 -> Mitigation: 第一阶段明确定义 macOS 主支持，adapter 设计保留平台分支。

## Migration Plan

1. 定义新的 core state schema、version 和 manifest。
2. 实现 state loader，支持读取现有目录并映射为内存模型。
3. 在首次运行新 core 时创建迁移备份，并写入 schema version。
4. 先实现读兼容，再实现写兼容，确保新 core 能安全管理旧数据。
5. 为 CLI 增加 core-backed 命令路径，保留旧 Bash 路径作为回退。
6. 在 core 行为稳定后接入 Tauri GUI。
7. 逐步把现有 Bash 命令改为薄封装或兼容包装。

Rollback:
- 若 core 迁移或写入逻辑出现严重问题，恢复到备份状态目录并切回旧 Bash 命令路径。
- 若 GUI 出现问题，不影响 core 与 CLI/TUI 的继续使用；GUI 可独立回退版本。

## Open Questions

- core 是以可执行命令集暴露给前端，还是以本地 daemon + IPC 暴露？当前更偏向命令集，后续是否需要常驻服务仍待定。
- TUI 是否需要长期保留，还是在 GUI 稳定后降级为维护模式？
- `sub2api` 模式在新 core 中是作为通用 provider profile 处理，还是继续保留独立登录模式？
- 桌面应用首发是否只支持 macOS，还是在需求定义里预留 Windows/Linux 的能力边界说明？
